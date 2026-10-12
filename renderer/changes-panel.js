/* Pannello «cosa ha cambiato» (docs/plans/32-pannello-modifiche.md): il
   collegamento con le schede, il main e il menu. Le scelte stanno in
   changes-model.js, il disegno in changes-view.js.

   - Si legge solo la sessione in primo piano, ogni CHANGES_POLL_MS e solo a
     finestra visibile: alimenta la linguetta anche a pannello chiuso.
   - Il diff di un file si legge solo quando lo si apre, e si rilegge quando
     cambiano i suoi contatori.
   - Una risposta che arriva dopo un cambio di scheda si butta: parlerebbe
     di un'altra cartella.
   - I contatori sulle righe dei worktree (changes-cache.js) non hanno un
     giro loro: si leggono quando un worktree compare, quando una sua
     sessione finisce, al ritorno della finestra, e dalla lettura del
     pannello se la sessione in primo piano sta in un worktree.
   - «Unisci» di un worktree (worktree-actions.js, `review`) apre lo stesso
     pannello sul diff del branch contro la base, con la conferma in fondo:
     finché è aperto parla di quel worktree, qualunque sia la scheda attiva.
   - Commenti sul diff (docs/plans/44): stanno sulla scheda (`tab.reviewNotes`),
     così sopravvivono al pannello chiuso e al cambio di modo, e se ne vanno
     con la scheda. «Invia» li incolla nel terminale come un incolla vero
     (term.paste): l'Invio lo dà l'utente.
   - Stage, unstage e commit (docs/plans/45): solo in «Da committare», una
     scrittura alla volta, poi si rilegge. Spenti mentre la sessione (o
     un'altra nello stesso repository) lavora: quando una parte o si ferma
     (signals.js) il pannello aperto si ridisegna. Il messaggio a metà sta
     sulla scheda (`tab.commitMessage`), come i commenti. */

const CHANGES_POLL_MS = 3000;
const CHANGES_WIDTH_KEY = 'aisess.changesWidth';
/* «Dall'ultimo commit», «Ultimo giro» o «Da committare»: la scelta del selettore si ricorda */
const CHANGES_MODE_KEY = 'aisess.changesMode';
const CHANGES_MODES = ['commit', 'turn', 'staging'];
const CHANGES_MIN_WIDTH = 320;
/* Al terminale resta sempre almeno questo, anche col pannello allargato */
const CHANGES_MIN_TERMINAL = 160;
const CHANGES_SHORTCUT = navigator.platform.startsWith('Mac') ? '⌘⇧M' : 'Ctrl+Shift+M';
const ChangesModel = window.AisessChangesModel;
const ReviewNotes = window.AisessReviewNotes;

let changesView = null;
const changesCache = window.AisessChangesCache.createChangesCache({
  read: (cwd, base) => window.aisess.gitChanges(cwd, base),
  onChange: () => renderSidebar(),
});

/** Tutti i worktree noti, di tutti i progetti in sidebar */
function knownWorktrees() {
  return Object.values(worktreeCache.snapshot()).flat();
}

/**
 * Quello che l'utente digita in una sessione agente (tabs.js): un prompt
 * inviato apre un «giro», e i file si fotografano adesso, prima che l'agente
 * li tocchi. La fotografia resta sulla scheda e sulla sessione tmux.
 */
function noteTurnInput(tab, data) {
  if (!tab.turnCapture || !tab.cwd) return;
  let line = null;
  try { line = tab.turnCapture.feed(data); } catch { return; }
  if (line) takeTurnSnapshot(tab).catch((e) => console.warn('[modifiche] fotografia non riuscita', e));
}

async function takeTurnSnapshot(tab) {
  // Due prompt di fila: vale la fotografia dell'ultimo, anche se arriva prima
  const seq = (tab.turnSeq || 0) + 1;
  tab.turnSeq = seq;
  const snap = await window.aisess.gitSnapshot(tab.cwd);
  if (tab.turnSeq !== seq) return;
  if (!snap || !snap.ok) {
    // Fuori da un repository non c'è niente da fotografare, e va bene così
    if (snap && snap.error) console.warn('[modifiche] fotografia non riuscita:', snap.error);
    return;
  }
  tab.turnTree = snap.tree;
  tab.turnAt = snap.at;
  if (tab.session) window.aisess.setMeta(tab.id, { turnTree: snap.tree, turnAt: snap.at });
  if (tab.id !== activeId) return;
  // Subito: il selettore si accende anche se la lettura non cambia niente
  // (a pannello aperto, finché i file restano uguali, non si ridisegnava)
  renderChanges();
  refreshChanges().catch(() => {});
}

/** Una sessione ha finito (signals.js): se sta in un worktree, se ne rileggono i numeri. */
function noteWorktreeSessionDone(t) {
  const w = Groups.worktreeOf(t, worktreeCache.snapshot());
  if (w) changesCache.refresh(w).catch(() => {});
}
function readChangesMode() {
  try {
    const saved = localStorage.getItem(CHANGES_MODE_KEY);
    return CHANGES_MODES.includes(saved) ? saved : 'commit';
  } catch {
    return 'commit';
  }
}

/* Stato del pannello: si sostituisce per intero, mai modificato sul posto */
let changesState = {
  open: false, target: null, result: null, signature: 'none', expanded: {}, seq: 0, merge: null, mode: readChangesMode(),
  reviewError: null, writing: false, commitOutcome: null, discard: null,
};

/* L'ultima richiesta di diff per file: una risposta più vecchia (file chiuso
   e riaperto, due riletture di fila) non deve sovrascrivere quella nuova */
const changesDiffTokens = new Map();
/* Una lettura alla volta: in un repository grande un giro può durare più
   del periodo, e i processi git non devono accumularsi */
let changesInFlight = false;

const isExpanded = (path) => Object.prototype.hasOwnProperty.call(changesState.expanded, path);

function setChangesState(patch) {
  changesState = { ...changesState, ...patch };
  renderChanges();
}

/** Il piè di pagina di «Unisci»: cosa succede, e perché non si può ancora */
function mergeFooter(merge, result) {
  if (!merge) return null;
  if (merge.kind === 'branch') return ChangesModel.branchMergeFooter(merge.branch, result, [...tabs.values()]);
  const { worktree, conf } = merge;
  const loaded = Boolean(result && result.ok);
  const pending = loaded && result.uncommitted > 0 ? result.uncommitted : 0;
  const warning = pending
    ? `${pending === 1 ? '1 file non è' : `${pending} file non sono`} in un commit: non finirebbe nel merge, e Unisci `
      + 'verrebbe rifiutato. Committa nel worktree (o chiedilo all\'agente), poi riprova.'
    : loaded && !result.totals.files ? `Niente da unire: ${worktree.branch} non ha cambiato niente rispetto a ${worktree.base}.` : null;
  return { text: conf.text, confirmLabel: `Unisci in ${worktree.base}`, warning, canConfirm: loaded && !pending };
}

const activeTab = () => (activeId ? tabs.get(activeId) || null : null);

/** «16:42»: da quando conta l'ultimo giro */
function turnTimeOf(tab) {
  if (!tab || !tab.turnAt) return null;
  try {
    return new Date(tab.turnAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

function renderChanges() {
  if (!changesView) return;
  const { open, target, result, expanded, merge, mode } = changesState;
  const ok = Boolean(result && result.ok);
  // Fuori da un repository (o senza sessione) non c'è niente da aprire; un
  // errore di git invece si mostra, se il pannello era aperto. Per «Unisci»
  // il pannello si apre comunque: è lì che si annulla.
  const readable = ok || Boolean(result && result.error);
  const unreadable = result && !result.ok
    ? result.error || (merge ? 'Non riesco a leggere il branch da unire: la cartella c\'è ancora?' : null)
    : null;
  changesView.render({
    label: ChangesModel.tabLabel(result),
    // Mentre la prima lettura di una scheda arriva, il pannello aperto resta
    // aperto e dice che sta caricando (cambiare scheda non lo fa lampeggiare)
    open: open && Boolean(target) && (readable || Boolean(merge) || !result),
    loading: !result,
    title: ChangesModel.headerTitle(target, result, { turnTime: turnTimeOf(activeTab()) }),
    summary: ChangesModel.summaryParts(result),
    error: unreadable,
    files: ok ? result.files : [],
    expanded,
    heading: merge ? 'Stai per unire' : 'Modifiche',
    merge: mergeFooter(merge, result),
    // In modalità Unisci si guarda il branch contro la base, nient'altro
    modes: merge ? null : ChangesModel.modeChoice(activeTab(), mode),
    sections: ChangesModel.sections(result),
    emptyText: ChangesModel.emptyText(result),
    notice: ChangesModel.notice(result),
    review: reviewStateOf(activeTab(), merge),
    commit: commitStateOf(activeTab(), merge),
    discard: merge ? null : discardStateOf(activeTab()),
  });
}

/* ---------- Stage, unstage e commit (docs/plans/45) ---------- */
function commitStateOf(tab, merge) {
  if (!tab) return null;
  const message = tab.commitMessage || '';
  const choice = ChangesModel.commitChoice(tab, [...tabs.values()], changesState.result,
    { merging: Boolean(merge), writing: changesState.writing, message });
  return choice && { ...choice, key: tab.id, message, outcome: changesState.commitOutcome };
}

/** Una sessione è partita o si è fermata (signals.js): i pulsanti di scrittura cambiano */
function noteChangesRunning() {
  if (changesState.open && changesState.target && (changesState.target.staging || changesState.merge)) renderChanges();
}

const COMMIT_CALLS = {
  stage: (cwd, a) => window.aisess.gitStage(cwd, a.paths, false),
  unstage: (cwd, a) => window.aisess.gitUnstage(cwd, a.paths, false),
  'stage-all': (cwd) => window.aisess.gitStage(cwd, null, true),
  'unstage-all': (cwd) => window.aisess.gitUnstage(cwd, null, true),
  commit: (cwd, a, tab) => window.aisess.gitCommit(cwd, tab.commitMessage || ''),
};

function handleCommit(action) {
  const tab = activeTab();
  if (!tab || !action) return;
  if (action.type === 'message') {
    tab.commitMessage = String(action.text || '');
    changesView.renderCommit(commitStateOf(tab, changesState.merge));
    return;
  }
  if (Object.prototype.hasOwnProperty.call(DISCARD_ACTIONS, action.type)) {
    DISCARD_ACTIONS[action.type](tab, action);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(COMMIT_CALLS, action.type)) return;
  runCommitAction(tab, action).catch((e) => console.warn('[modifiche] scrittura', e));
}

function commitOutcomeOf(action, res) {
  if (!res || !res.ok) return { ok: false, text: (res && res.error) || 'git ha rifiutato l\'operazione.' };
  if (action.type !== 'commit') return null;
  return { ok: true, text: res.branch ? `Commit ${res.commit} su ${res.branch}` : `Commit ${res.commit}` };
}

/* Una scrittura alla volta; si ricontrolla qui quello che la vista ha già
   spento, perché fra il disegno e il clic la sessione può essere ripartita */
async function runCommitAction(tab, action) {
  const choice = commitStateOf(tab, changesState.merge);
  const target = changesState.target;
  if (!choice || !target || !(action.type === 'commit' ? choice.canCommit : choice.canWrite)) return;
  setChangesState({ writing: true, commitOutcome: null });
  let res;
  try {
    res = await COMMIT_CALLS[action.type](target.cwd, action, tab);
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  if (res && res.ok && action.type === 'commit') tab.commitMessage = '';
  // Scheda cambiata nel frattempo: l'esito parlerebbe di un'altra cartella
  const same = Boolean(changesState.target && changesState.target.key === target.key);
  setChangesState({ writing: false, commitOutcome: same ? commitOutcomeOf(action, res) : null });
  await refreshChanges();
}

/* ---------- Scartare un file (docs/plans/48) ---------- */
function discardStateOf(tab) {
  const choice = tab && commitStateOf(tab, null);
  return choice ? ChangesModel.discardFooter(changesState.discard, choice.canWrite) : null;
}

const canWriteNow = (tab) => {
  const choice = commitStateOf(tab, changesState.merge);
  return Boolean(choice && choice.canWrite && changesState.target);
};

function askDiscard(tab, action) {
  if (!canWriteNow(tab) || typeof action.path !== 'string') return;
  setChangesState({ discard: { phase: 'confirm', path: action.path, untracked: Boolean(action.untracked) }, commitOutcome: null });
}

function discardOutcomeOf(undo, discard, res) {
  if (!res || !res.ok) return { ok: false, text: (res && res.error) || 'git ha rifiutato l\'operazione.' };
  return undo ? { ok: true, text: `${discard.path} è tornato com'era.` } : null;
}

/* Scarto e Annulla: come runCommitAction, una scrittura alla volta e
   ricontrollando che la sessione non sia ripartita fra disegno e clic */
async function runDiscard(tab, undo) {
  const d = changesState.discard;
  const ready = d && (undo ? d.phase === 'done' && d.undo : d.phase === 'confirm');
  if (!ready || !canWriteNow(tab)) return;
  const target = changesState.target;
  setChangesState({ writing: true, commitOutcome: null });
  let res;
  try {
    res = undo ? await window.aisess.gitDiscardUndo(target.cwd, d.undo) : await window.aisess.gitDiscard(target.cwd, d.path);
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  const same = Boolean(changesState.target && changesState.target.key === target.key);
  const ok = Boolean(res && res.ok);
  // Se non è andata il piede resta com'era: un index.lock passeggero non
  // deve far sparire l'Annulla, il contenuto salvato è ancora in git
  let next = d;
  if (ok) next = undo ? null : { phase: 'done', path: d.path, untracked: d.untracked, undo: res.undo || null };
  setChangesState({ writing: false, discard: same ? next : null, commitOutcome: same ? discardOutcomeOf(undo, d, res) : null });
  await refreshChanges();
}

const DISCARD_ACTIONS = {
  'discard-ask': askDiscard,
  'discard-cancel': () => setChangesState({ discard: null }),
  discard: (tab) => runDiscard(tab, false).catch((e) => console.warn('[modifiche] scarto', e)),
  'discard-undo': (tab) => runDiscard(tab, true).catch((e) => console.warn('[modifiche] annulla scarto', e)),
};

/* ---------- Commenti sul diff (docs/plans/44) ---------- */
function reviewStateOf(tab, merge) {
  if (!ChangesModel.reviewAvailable(tab, Boolean(merge))) return null;
  return { enabled: true, key: tab.id, notes: tab.reviewNotes || [], error: changesState.reviewError };
}

function setReviewNotes(tab, notes, reviewError = null) {
  tab.reviewNotes = notes;
  setChangesState({ reviewError });
}

/** Le azioni della vista; per `save`, false se il commento è rifiutato */
function handleReview(action) {
  const tab = activeTab();
  if (!ChangesModel.reviewAvailable(tab, Boolean(changesState.merge))) return false;
  const notes = tab.reviewNotes || [];
  if (action.type === 'save') {
    const res = ReviewNotes.addNote(notes, action.anchor, action.body, { replaces: action.replaces || null });
    setReviewNotes(tab, res.notes, res.ok ? null : res.error);
    return res.ok;
  }
  if (action.type === 'remove') setReviewNotes(tab, ReviewNotes.removeNote(notes, action.id));
  else if (action.type === 'clear') setReviewNotes(tab, []);
  else if (action.type === 'send') return sendReview(tab, notes);
  return true;
}

/* Come un incolla dell'utente: passa da term.onData (pty, prompt-capture,
   «Ultimo giro»). Il pannello si chiude e il fuoco torna al terminale. */
function sendReview(tab, notes) {
  const bracketed = Boolean(tab.term && tab.term.modes && tab.term.modes.bracketedPasteMode);
  const res = ReviewNotes.pasteFor(notes, { bracketed });
  if (!res.ok) {
    setChangesState({ reviewError: res.error });
    return false;
  }
  try {
    tab.term.paste(res.text);
  } catch (e) {
    console.warn('[modifiche] incolla non riuscito', e);
    setChangesState({ reviewError: 'Non riesco a incollare nel terminale: i commenti restano qui.' });
    return false;
  }
  tab.reviewNotes = [];
  changesState = { ...changesState, reviewError: null };
  toggleChangesPanel(false);
  return true;
}

function activeChangesTarget() {
  const { merge } = changesState;
  if (merge && merge.kind === 'branch') return ChangesModel.incomingTarget(merge.branch);
  if (merge) return ChangesModel.targetFor({ type: 'worktree', cwd: merge.worktree.path }, merge.worktree);
  const t = activeTab();
  const worktree = t ? Groups.worktreeOf(t, worktreeCache.snapshot()) : null;
  // Ultimo giro e Da committare si guardano solo a pannello aperto: il primo
  // costa una fotografia di adesso, e la linguetta parla sempre dall'ultimo commit
  const current = changesState.open ? ChangesModel.modeChoice(t, changesState.mode).current : 'commit';
  return ChangesModel.targetFor(t, worktree, { since: current === 'turn' ? t.turnTree : null, staging: current === 'staging' });
}

function setChangesMode(mode) {
  if (mode === changesState.mode || !CHANGES_MODES.includes(mode)) return;
  try { localStorage.setItem(CHANGES_MODE_KEY, mode); } catch {}
  setChangesState({ mode });
  refreshChanges().catch((e) => console.warn('[modifiche]', e));
}

/** Il giro periodico: salta se la lettura di prima non è ancora tornata. */
async function pollChanges() {
  if (changesInFlight || document.hidden) return;
  changesInFlight = true;
  try {
    await refreshChanges();
  } finally {
    changesInFlight = false;
  }
}

/** Rilegge le modifiche della sessione in primo piano; ridisegna solo se è cambiato qualcosa. */
async function refreshChanges() {
  const target = activeChangesTarget();
  const sameTarget = Boolean(target && changesState.target && target.key === changesState.target.key);
  if (!sameTarget) setChangesState({ target, result: null, signature: 'none', expanded: {}, reviewError: null, commitOutcome: null, discard: null });
  if (!target) return;
  const seq = changesState.seq + 1;
  changesState = { ...changesState, seq };
  let result;
  try {
    result = target.staging
      ? await window.aisess.gitStaging(target.cwd)
      : await window.aisess.gitChanges(target.cwd, target.base, target.since, target.incoming || null);
  } catch (e) {
    result = { ok: false, error: String((e && e.message) || e) };
  }
  if (seq !== changesState.seq) return; // nel frattempo è partita una lettura più nuova
  if (result && !result.ok && result.error) console.warn('[modifiche]', result.error);
  if (target.path && !target.since && !target.staging) changesCache.put(target.path, result);
  const signature = ChangesModel.signature(result);
  if (signature === changesState.signature) return;
  const prev = changesState.result;
  const againstChanged = Boolean(prev && prev.ok && result.ok && prev.against !== result.against);
  const { reload, drop } = ChangesModel.diffsToReload(prev && prev.ok ? prev.files : [], result.ok ? result.files : [],
    Object.keys(changesState.expanded), { againstChanged });
  const expanded = Object.fromEntries(Object.entries(changesState.expanded).filter(([p]) => !drop.includes(p)));
  setChangesState({ result, signature, expanded });
  for (const p of reload) loadFileDiff(p);
}

/* `id` è il percorso, o «sezione:percorso» in «Da committare» (changes-model.js, itemId) */
function readFileDiffOf(target, id) {
  if (!target.staging) return window.aisess.gitFileDiff(target.cwd, target.base, id, target.since, target.incoming || null);
  const { side, path } = ChangesModel.splitItemId(target, id);
  return window.aisess.gitStagingDiff(target.cwd, path, side);
}

async function loadFileDiff(id) {
  const target = changesState.target;
  if (!target) return;
  const token = (changesDiffTokens.get(id) || 0) + 1;
  changesDiffTokens.set(id, token);
  let diff;
  try {
    diff = await readFileDiffOf(target, id);
  } catch (e) {
    diff = { ok: false, error: String((e && e.message) || e) };
  }
  // Scheda cambiata, file richiuso o riletto nel frattempo: la risposta non serve più
  if (changesDiffTokens.get(id) !== token) return;
  if (!changesState.target || changesState.target.key !== target.key || !isExpanded(id)) return;
  setChangesState({ expanded: { ...changesState.expanded, [id]: diff } });
}

function toggleChangesFile(id) {
  if (isExpanded(id)) {
    const rest = Object.fromEntries(Object.entries(changesState.expanded).filter(([p]) => p !== id));
    setChangesState({ expanded: rest });
    return;
  }
  setChangesState({ expanded: { ...changesState.expanded, [id]: { loading: true } } });
  loadFileDiff(id);
}

/**
 * La conferma di «Unisci» (worktree-actions.js, `review`): il pannello si
 * apre sul diff del worktree contro la base; la promessa si scioglie con la
 * scelta dell'utente. Chiudere il pannello in qualsiasi modo vale «Annulla».
 * @returns {Promise<boolean>}
 */
function reviewMerge(worktree, conf) {
  return openMergeReview({ kind: 'worktree', worktree, conf });
}

/**
 * La conferma di un merge dal selettore dei branch (docs/plans/46, git-tab.js):
 * il pannello mostra quello che `name` porta in `into`. Si scioglie con la
 * punta del branch che si è guardata (il merge la ricontrolla), o null.
 * @param {{cwd: string, name: string, into: string}} branch
 * @returns {Promise<{tip: string}|null>}
 */
function reviewBranchMerge(branch) {
  return openMergeReview({ kind: 'branch', branch })
    .then((answer) => (answer.confirmed && answer.result && answer.result.tip ? { tip: answer.result.tip } : null));
}

/* Una revisione rimasta aperta (un altro worktree o branch) si annulla */
function openMergeReview(merge) {
  finishMerge(false);
  return new Promise((resolve) => {
    setChangesState({ open: true, merge: { ...merge, resolve } });
    refreshChanges().catch((e) => console.warn('[modifiche]', e));
  });
}

function finishMerge(confirmed) {
  const { merge, result } = changesState;
  if (!merge) return;
  setChangesState({ merge: null, open: false });
  // Il worktree vuole sì/no; il branch anche la lettura confermata (`tip`)
  merge.resolve(merge.kind === 'branch' ? { confirmed, result } : confirmed);
  // Si torna a parlare della scheda in primo piano
  refreshChanges().catch(() => {});
}

function toggleChangesPanel(force) {
  const open = typeof force === 'boolean' ? force : !changesState.open;
  if (!open && changesState.merge) { finishMerge(false); return; }
  // Chiudendo il pannello l'Annulla dello scarto non si offre più
  setChangesState(open ? { open } : { open, discard: null });
  // Aprendolo il fuoco resta al terminale: si può scrivere all'agente col
  // diff sotto gli occhi. Esc chiude quando il fuoco è nel pannello (un clic
  // su un file); chiudendolo il fuoco torna al terminale.
  // Anche chiudendo: la linguetta torna a parlare dall'ultimo commit
  refreshChanges().catch((e) => console.warn('[modifiche]', e));
  // Il clic sulla linguetta lascerebbe il fuoco su un pulsante che sparisce
  const t = activeTab();
  if (t && t.term) t.term.focus();
}

/* ---------- Larghezza: si trascina il bordo sinistro, come la sidebar ---------- */
function clampChangesWidth(px) {
  const host = $('#terminals');
  const max = Math.max(CHANGES_MIN_WIDTH, (host ? host.clientWidth : 1200) - CHANGES_MIN_TERMINAL);
  return Math.min(max, Math.max(CHANGES_MIN_WIDTH, px));
}

function readChangesWidth() {
  try {
    const n = Number(localStorage.getItem(CHANGES_WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function initChangesResize() {
  const saved = readChangesWidth();
  if (saved) changesView.setWidth(clampChangesWidth(saved));
  changesView.resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const right = changesView.panel.getBoundingClientRect().right;
    const move = (ev) => changesView.setWidth(clampChangesWidth(right - ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('changes-resizing');
      try { localStorage.setItem(CHANGES_WIDTH_KEY, String(changesView.panel.getBoundingClientRect().width)); } catch {}
    };
    document.body.classList.add('changes-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function initChangesPanel() {
  changesView = window.AisessChangesView.createChangesView({
    doc: document,
    host: $('#terminals'),
    shortcut: CHANGES_SHORTCUT,
    onToggle: () => toggleChangesPanel(),
    onClose: () => toggleChangesPanel(false),
    onFile: (id) => toggleChangesFile(id),
    onMerge: (confirmed) => finishMerge(confirmed),
    onMode: (mode) => setChangesMode(mode),
    onReview: (action) => handleReview(action),
    onCommit: (action) => handleCommit(action),
  });
  initChangesResize();
  try { window.aisess.onMenu('menu-changes', () => toggleChangesPanel()); } catch {}
  setInterval(() => { pollChanges().catch((e) => console.warn('[modifiche]', e)); }, CHANGES_POLL_MS);
  // Tornando alla finestra si rilegge subito: intanto l'agente ha lavorato
  window.addEventListener('focus', () => {
    refreshChanges().catch(() => {});
    changesCache.refreshAll(knownWorktrees()).catch(() => {});
  });
  renderChanges();
}
