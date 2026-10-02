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
     finché è aperto parla di quel worktree, qualunque sia la scheda attiva. */

const CHANGES_POLL_MS = 3000;
const CHANGES_WIDTH_KEY = 'aisess.changesWidth';
/* «Dall'ultimo commit» o «Ultimo giro»: la scelta del selettore si ricorda */
const CHANGES_MODE_KEY = 'aisess.changesMode';
const CHANGES_MIN_WIDTH = 320;
/* Al terminale resta sempre almeno questo, anche col pannello allargato */
const CHANGES_MIN_TERMINAL = 160;
const CHANGES_SHORTCUT = navigator.platform.startsWith('Mac') ? '⌘⇧M' : 'Ctrl+Shift+M';
const ChangesModel = window.AisessChangesModel;

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
  const snap = await window.aisess.gitSnapshot(tab.cwd);
  if (!snap || !snap.ok) {
    // Fuori da un repository non c'è niente da fotografare, e va bene così
    if (snap && snap.error) console.warn('[modifiche] fotografia non riuscita:', snap.error);
    return;
  }
  tab.turnTree = snap.tree;
  tab.turnAt = snap.at;
  if (tab.session) window.aisess.setMeta(tab.id, { turnTree: snap.tree, turnAt: snap.at });
  if (tab.id === activeId) refreshChanges().catch(() => {});
}

/** Una sessione ha finito (signals.js): se sta in un worktree, se ne rileggono i numeri. */
function noteWorktreeSessionDone(t) {
  const w = Groups.worktreeOf(t, worktreeCache.snapshot());
  if (w) changesCache.refresh(w).catch(() => {});
}
function readChangesMode() {
  try {
    return localStorage.getItem(CHANGES_MODE_KEY) === 'turn' ? 'turn' : 'commit';
  } catch {
    return 'commit';
  }
}

/* Stato del pannello: si sostituisce per intero, mai modificato sul posto */
let changesState = {
  open: false, target: null, result: null, signature: 'none', expanded: {}, seq: 0, merge: null, mode: readChangesMode(),
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
    ? result.error || (merge ? 'Non riesco a leggere il worktree: la cartella c\'è ancora?' : null)
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
    emptyText: ChangesModel.emptyText(result),
  });
}

function activeChangesTarget() {
  const { merge } = changesState;
  if (merge) return ChangesModel.targetFor({ type: 'worktree', cwd: merge.worktree.path }, merge.worktree);
  const t = activeTab();
  const worktree = t ? Groups.worktreeOf(t, worktreeCache.snapshot()) : null;
  // L'ultimo giro si guarda solo a pannello aperto: confrontarlo costa una
  // fotografia di adesso, e la linguetta parla sempre dall'ultimo commit
  const turn = changesState.open && ChangesModel.modeChoice(t, changesState.mode).current === 'turn';
  return ChangesModel.targetFor(t, worktree, { since: turn ? t.turnTree : null });
}

function setChangesMode(mode) {
  if (mode === changesState.mode) return;
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
  if (!sameTarget) setChangesState({ target, result: null, signature: 'none', expanded: {} });
  if (!target) return;
  const seq = changesState.seq + 1;
  changesState = { ...changesState, seq };
  let result;
  try {
    result = await window.aisess.gitChanges(target.cwd, target.base, target.since);
  } catch (e) {
    result = { ok: false, error: String((e && e.message) || e) };
  }
  if (seq !== changesState.seq) return; // nel frattempo è partita una lettura più nuova
  if (result && !result.ok && result.error) console.warn('[modifiche]', result.error);
  if (target.path && !target.since) changesCache.put(target.path, result);
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

async function loadFileDiff(path) {
  const target = changesState.target;
  if (!target) return;
  const token = (changesDiffTokens.get(path) || 0) + 1;
  changesDiffTokens.set(path, token);
  let diff;
  try {
    diff = await window.aisess.gitFileDiff(target.cwd, target.base, path, target.since);
  } catch (e) {
    diff = { ok: false, error: String((e && e.message) || e) };
  }
  // Scheda cambiata, file richiuso o riletto nel frattempo: la risposta non serve più
  if (changesDiffTokens.get(path) !== token) return;
  if (!changesState.target || changesState.target.key !== target.key || !isExpanded(path)) return;
  setChangesState({ expanded: { ...changesState.expanded, [path]: diff } });
}

function toggleChangesFile(path) {
  if (isExpanded(path)) {
    const rest = Object.fromEntries(Object.entries(changesState.expanded).filter(([p]) => p !== path));
    setChangesState({ expanded: rest });
    return;
  }
  setChangesState({ expanded: { ...changesState.expanded, [path]: { loading: true } } });
  loadFileDiff(path);
}

/**
 * La conferma di «Unisci» (worktree-actions.js, `review`): il pannello si
 * apre sul diff del worktree contro la base; la promessa si scioglie con la
 * scelta dell'utente. Chiudere il pannello in qualsiasi modo vale «Annulla».
 * @returns {Promise<boolean>}
 */
function reviewMerge(worktree, conf) {
  finishMerge(false); // una revisione rimasta aperta (un altro worktree) si annulla
  return new Promise((resolve) => {
    setChangesState({ open: true, merge: { worktree, conf, resolve } });
    refreshChanges().catch((e) => console.warn('[modifiche]', e));
  });
}

function finishMerge(confirmed) {
  const { merge } = changesState;
  if (!merge) return;
  setChangesState({ merge: null, open: false });
  merge.resolve(confirmed);
  // Si torna a parlare della scheda in primo piano
  refreshChanges().catch(() => {});
}

function toggleChangesPanel(force) {
  const open = typeof force === 'boolean' ? force : !changesState.open;
  if (!open && changesState.merge) { finishMerge(false); return; }
  setChangesState({ open });
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
    onFile: (path) => toggleChangesFile(path),
    onMerge: (confirmed) => finishMerge(confirmed),
    onMode: (mode) => setChangesMode(mode),
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
