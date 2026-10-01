/* Pannello «cosa ha cambiato» (docs/plans/32-pannello-modifiche.md): il
   collegamento con le schede, il main e il menu. Le scelte stanno in
   changes-model.js, il disegno in changes-view.js.

   - Si legge solo la sessione in primo piano, ogni CHANGES_POLL_MS e solo a
     finestra visibile: alimenta la linguetta anche a pannello chiuso.
   - Il diff di un file si legge solo quando lo si apre, e si rilegge quando
     cambiano i suoi contatori.
   - Una risposta che arriva dopo un cambio di scheda si butta: parlerebbe
     di un'altra cartella. */

const CHANGES_POLL_MS = 3000;
const CHANGES_WIDTH_KEY = 'aisess.changesWidth';
const CHANGES_MIN_WIDTH = 320;
/* Al terminale resta sempre almeno questo, anche col pannello allargato */
const CHANGES_MIN_TERMINAL = 160;
const CHANGES_SHORTCUT = navigator.platform.startsWith('Mac') ? '⌘⇧M' : 'Ctrl+Shift+M';
const ChangesModel = window.AisessChangesModel;

let changesView = null;
/* Stato del pannello: si sostituisce per intero, mai modificato sul posto */
let changesState = { open: false, target: null, result: null, signature: 'none', expanded: {}, seq: 0 };

function setChangesState(patch) {
  changesState = { ...changesState, ...patch };
  renderChanges();
}

function renderChanges() {
  if (!changesView) return;
  const { open, target, result, expanded } = changesState;
  const ok = Boolean(result && result.ok);
  // Fuori da un repository (o senza sessione) non c'è niente da aprire; un
  // errore di git invece si mostra, se il pannello era aperto
  const readable = ok || Boolean(result && result.error);
  changesView.render({
    label: ChangesModel.tabLabel(result),
    open: open && Boolean(target) && readable,
    title: ChangesModel.headerTitle(target, result),
    summary: ChangesModel.summary(result),
    error: result && !result.ok && result.error ? result.error : null,
    files: ok ? result.files : [],
    expanded,
  });
}

function activeChangesTarget() {
  const t = activeId ? tabs.get(activeId) : null;
  const worktree = t ? Groups.worktreeOf(t, worktreeCache.snapshot()) : null;
  return ChangesModel.targetFor(t, worktree);
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
    result = await window.aisess.gitChanges(target.cwd, target.base);
  } catch (e) {
    result = { ok: false, error: String((e && e.message) || e) };
  }
  if (seq !== changesState.seq) return; // nel frattempo è partita una lettura più nuova
  if (result && !result.ok && result.error) console.warn('[modifiche]', result.error);
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
  let diff;
  try {
    diff = await window.aisess.gitFileDiff(target.cwd, target.base, path);
  } catch (e) {
    diff = { ok: false, error: String((e && e.message) || e) };
  }
  // Scheda cambiata o file richiuso nel frattempo: la risposta non serve più
  if (!changesState.target || changesState.target.key !== target.key || !changesState.expanded[path]) return;
  setChangesState({ expanded: { ...changesState.expanded, [path]: diff } });
}

function toggleChangesFile(path) {
  const { [path]: wasOpen, ...rest } = changesState.expanded;
  if (wasOpen) { setChangesState({ expanded: rest }); return; }
  setChangesState({ expanded: { ...changesState.expanded, [path]: { loading: true } } });
  loadFileDiff(path);
}

function toggleChangesPanel(force) {
  const open = typeof force === 'boolean' ? force : !changesState.open;
  setChangesState({ open });
  // Aprendolo il fuoco resta al terminale: si può scrivere all'agente col
  // diff sotto gli occhi. Esc chiude quando il fuoco è nel pannello (un clic
  // su un file); chiudendolo il fuoco torna al terminale.
  if (open) {
    refreshChanges().catch((e) => console.warn('[modifiche]', e));
  } else {
    const t = activeId ? tabs.get(activeId) : null;
    if (t && t.term) t.term.focus();
  }
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
  });
  initChangesResize();
  try { window.aisess.onMenu('menu-changes', () => toggleChangesPanel()); } catch {}
  setInterval(() => {
    if (document.hidden) return;
    refreshChanges().catch((e) => console.warn('[modifiche]', e));
  }, CHANGES_POLL_MS);
  // Tornando alla finestra si rilegge subito: intanto l'agente ha lavorato
  window.addEventListener('focus', () => { refreshChanges().catch(() => {}); });
  renderChanges();
}
