/* ---------- Conflitti (docs/plans/69) ----------
 * Con un merge, rebase, cherry-pick o revert a metà il pannello delle
 * modifiche passa da sé alla modalità «Conflitti». La lettura parte solo a
 * pannello aperto e fuori da «Unisci»; le scritture una alla volta, come
 * quelle di staging (changes-panel.js, runCommitAction). */
const ConflictsModel = window.AisessConflictsModel;

/* I conflitti della cartella del pannello: l'oggetto se c'è un'operazione a
   metà, null se non c'è niente, { ok:false, error } se la lettura è fallita
   (es. index.lock di un'altra scrittura in corso). Un errore non è "niente
   conflitti": prima si restituiva null e il pannello cadeva in «da
   committare», che a sua volta falliva allo stesso modo e tornava in un
   giro di BUSY (fix round finale, docs/plans/69). */
async function readConflictsOf(target) {
  if (!target || !changesState.open || changesState.merge) return null;
  try {
    const r = await window.aisess.gitConflicts(target.cwd);
    if (r && r.ok) return r.op ? r : null;
    const error = (r && r.error) || 'gitConflicts ha rifiutato.';
    console.warn('[conflitti]', error);
    return { ok: false, error };
  } catch (e) {
    const error = String((e && e.message) || e);
    console.warn('[conflitti]', error);
    return { ok: false, error };
  }
}

function conflictsStateOf(tab) {
  const c = changesState.conflicts;
  if (!c || changesState.merge) return null;
  const block = ChangesModel.writeBlock(tab, [...tabs.values()], { root: c.root }, changesState.writing);
  return ConflictsModel.viewState(c, { block, outcome: changesState.conflictOutcome });
}

const CONFLICT_CALLS = {
  continue: (c) => window.aisess.gitOpContinue(c.root, c.op),
  abort: (c) => window.aisess.gitOpAbort(c.root, c.op),
};
const callFor = (c, a) => (CONFLICT_CALLS[a.how] ? CONFLICT_CALLS[a.how](c) : window.aisess.gitConflictResolve(c.root, a.path, a.how));

function handleConflict(action) {
  if (!action || !changesState.conflicts) return;
  if (action.how === 'open') {
    openConflictFile(action.path).catch((e) => console.warn('[conflitti] apri nell\'editor', e));
    return;
  }
  runConflictAction(action).catch((e) => console.warn('[conflitti]', e));
}

/* Si ricontrolla qui quello che la vista ha già spento: fra il disegno e il
   clic una sessione può essere ripartita */
async function runConflictAction(action) {
  const c = changesState.conflicts;
  const view = conflictsStateOf(activeTab());
  if (!c || !view || changesState.writing) return;
  if (action.how === 'continue' && !view.footer.canContinue) return;
  if (action.how !== 'continue' && action.how !== 'abort') {
    // Come continue e abort: fra il disegno e il clic una sessione può aver
    // rimesso il blocco (fix round finale, docs/plans/69)
    const file = view.files.find((f) => f.path === action.path);
    const fileAction = file && file.actions.find((a) => a.how === action.how);
    if (!fileAction || fileAction.disabled) return;
  }
  if (action.how === 'abort') {
    if (!view.footer.canAbort) return;
    const key = changesState.target && changesState.target.key;
    const sure = await closeConfirm.ask({
      anchor: action.anchor, title: `${view.footer.abortLabel}?`, confirmLabel: view.footer.abortLabel,
      text: 'Il lavoro di risoluzione fatto finora si perde: la cartella torna com\'era prima dell\'operazione.',
    });
    if (!sure) return;
    /* Il fumetto non è modale: nell'attesa può essere partita un'altra
       scrittura, una sessione nello stesso repository, o l'operazione può
       essere cambiata o conclusa. Si ricontrolla tutto da capo prima di
       annullare davvero. */
    const same = Boolean(changesState.target && changesState.target.key === key)
      && changesState.conflicts && changesState.conflicts.op === c.op;
    const recheck = same ? conflictsStateOf(activeTab()) : null;
    if (!recheck || changesState.writing || !recheck.footer.canAbort) {
      setChangesState({
        conflictOutcome: {
          ok: false,
          text: recheck ? (recheck.footer.abortReason || 'Adesso non si può più annullare.') : 'Nel frattempo è cambiato qualcosa: riprova.',
        },
      });
      return;
    }
  }
  const key = changesState.target && changesState.target.key;
  setChangesState({ writing: true, conflictOutcome: null });
  let res;
  try {
    res = await callFor(c, action);
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  const same = Boolean(changesState.target && changesState.target.key === key);
  setChangesState({ writing: false, conflictOutcome: same ? ConflictsModel.outcomeOf(action, res) : null });
  const tab = activeTab();
  if (res && res.ok && !['mark', 'ours', 'theirs', 'keep', 'delete'].includes(action.how) && tab && tab.type === 'git') {
    refreshGitTab(tab).catch((e) => console.warn('[conflitti] timeline', e));
  }
  await refreshChanges();
}

/* Come openChangedFile, ma sulla radice dei conflitti e col cursore al primo blocco */
async function openConflictFile(path) {
  const c = changesState.conflicts;
  if (!c || typeof c.root !== 'string') return;
  const target = window.AisessEditorRoute.editorTarget({
    repoRoot: c.root, file: path, tabs: Order.applyOrder([...tabs.values()], sessionOrder), activeId,
  });
  if (!target) return;
  let tab = target.tabId ? tabs.get(target.tabId) : null;
  if (tab) setActive(tab.id);
  else tab = await createTab('editor', { cwd: target.cwd });
  if (!tab || !tabs.has(tab.id)) return;
  if (changesState.open) toggleChangesPanel(false);
  // Stessi nomi del pannello (fix round finale, docs/plans/69): la barra
  // dell'editor non deve dire "nostro/loro" al contrario di un rebase.
  const sides = ConflictsModel.sides(c);
  await (typeof openEditorConflict === 'function' ? openEditorConflict(tab, target.rel, sides) : openEditorAt(tab, target.rel));
}

/* «Risolvi» da Unisci: una scheda sulla cartella col merge a metà (quella
   attiva se ci sta, poi la prima editor, altrimenti una nuova) e il pannello aperto */
async function openConflictsFor(root) {
  if (typeof root !== 'string' || !root) return;
  const inside = (t) => t && ChangesModel.insideRoot(t.cwd, root);
  const ordered = Order.applyOrder([...tabs.values()], sessionOrder);
  let tab = inside(activeTab()) ? activeTab()
    : ordered.find((t) => t.type === 'editor' && inside(t)) || null;
  if (tab) setActive(tab.id);
  else tab = await createTab('editor', { cwd: root });
  if (!tab || !tabs.has(tab.id)) return;
  toggleChangesPanel(true);
}
