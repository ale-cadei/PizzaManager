/* Segnali sulle card: «l'assistente ha finito» (lampeggio) e «sta lavorando».
   Le regole stanno in attention.js e running.js; qui i timer e il render.
   Quando l'agente dice da sé in che stato è (hook, OSC 9 di Codex: piano 46)
   le regole sono quelle di agent-state.js e l'euristica tace. */

/* ---------- "L'assistente ha finito": card che lampeggia ----------
   Un agente TUI scrive senza sosta mentre lavora: quando il flusso si ferma
   per ATTENTION_IDLE_MS su una scheda non in primo piano, il turno può essere
   finito. *Può*: decidere se quella raffica era un lavoro o solo la TUI che si
   ridisegna spetta a renderer/attention.js, che è dove sta la regola (e dove i
   test la provano). Qui restano il timer e il render. */
const ATTENTION_IDLE_MS = 1500;
const attention = Attention.createAttention();

/* La scheda attiva è sotto gli occhi dell'utente solo se la finestra ha il
   focus: con l'app dietro può accendersi (e notificare) come le altre. È il
   caso più comune: chiedo qualcosa, passo al browser, aspetto (piano 38). */
let windowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

function isWatched(t) {
  return t.id === activeId && windowFocused;
}

function noteActivity(t, bytes) {
  if (t.type === 'shell') return;   // nessun assistente: niente da segnalare
  if (agentState.isExact(t.id)) return; // lo dice l'agente stesso
  if (isWatched(t)) return;         // già sotto gli occhi dell'utente
  attention.data(t.id, bytes);
  clearTimeout(t.idleTimer);
  t.idleTimer = setTimeout(() => flagAttention(t), ATTENTION_IDLE_MS);
}

/** @param {{bell?: boolean}} [o] il bell del terminale, segnale esplicito di fine turno */
function flagAttention(t, { bell = false } = {}) {
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  // Anche se non lampeggia (shell): il lavoro è finito, i numeri del suo worktree cambiano
  noteWorktreeSessionDone(t);
  if (t.type === 'shell' || isWatched(t) || t.needsAttention || agentState.isExact(t.id)) return;
  if (!(bell ? attention.bell(t.id) : attention.idle(t.id))) return;
  t.needsAttention = true;
  notifyFinished(t);
  syncBadge();
  // Solo la classe sulla card: rifare la sidebar farebbe ripartire da capo il
  // lampeggio di tutte le altre (render() ricostruisce gli elementi).
  if (!sidebar.signal(t.id, { needsAttention: true })) renderSidebar();
}

/* Lasciare la finestra è lasciare la scheda attiva: parte la finestra di
   silenzio, così il ridisegno del focus-out non accende la card. Tornarci è
   rivederla, come selezionarla. */
function onWindowBlur() {
  windowFocused = false;
  if (activeId) { attention.left(activeId); leaveAgentTab(activeId); }
}

function onWindowFocus() {
  windowFocused = true;
  if (!activeId || !clearAttention(activeId)) return;
  if (!sidebar.signal(activeId, { needsAttention: false })) renderSidebar();
}

/* ---------- Segnale esatto dagli agenti (docs/plans/46) ----------
   Claude e opencode lo scrivono su file tramite hook (arriva dal main come
   agent-signal), Codex lo manda come OSC 9 nel terminale. Al primo segnale
   la sessione passa alle regole di agent-state.js: se non ne arriva mai
   nessuno (hook bloccati, versione vecchia) resta tutto come prima. */
const agentState = AgentState.createAgentState();

/** @param {'ready'|'running'|'waiting'|'permission'} sig */
function applyAgentSignal(t, sig) {
  if (!t || !t.alive) return;
  const r = agentState.signal(t.id, sig, { watched: isWatched(t), codex: t.type === 'codex' });
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  if (sig === 'waiting') noteWorktreeSessionDone(t);
  if (r.running !== null) setExactRunning(t, r.running);
  setAttentionKind(t, r.attention);
}

/* Un permesso chiesto sotto gli occhi e lasciato lì: nessun hook arriverà più
   finché l'utente non risponde, quindi lo si riaccende quando se ne va. Senza
   notifica: l'ha appena visto, basta la card. */
function leaveAgentTab(id) {
  const t = tabs.get(id);
  if (!t || agentState.left(id) !== 'permission') return;
  setAttentionKind(t, 'permission', { notify: false });
}

/* La barra la decide il segnale: il timer del silenzio la spegnerebbe mentre
   l'agente aspetta il modello senza scrivere niente. */
function setExactRunning(t, on) {
  clearTimeout(t.runTimer);
  t.runTimer = null;
  if (!on) running.stop(t.id);
  if (t.running === on) return;
  t.running = on;
  showRunning(t);
}

/**
 * @param {null|'done'|'permission'} kind
 * @param {{notify?: boolean}} [o]
 */
function setAttentionKind(t, kind, { notify = true } = {}) {
  const was = t.needsAttention ? (t.attentionKind || 'done') : null;
  if (kind === was) return;
  t.needsAttention = Boolean(kind);
  t.attentionKind = kind;
  if (kind && notify) notifyFinished(t);
  syncBadge();
  if (!sidebar.signal(t.id, { needsAttention: Boolean(kind), permission: kind === 'permission' })) renderSidebar();
}

function watchWindowFocus() {
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
}

/* ---------- "Sta lavorando adesso": barra del tipo animata ----------
   Stesso flusso di byte dell'attenzione, domanda diversa: non «ha finito» ma
   «sta macinando in questo momento», e vale anche per la scheda in primo piano
   e per le shell (un build che gira è in esecuzione quanto un agente). La
   regola sta in renderer/running.js; qui il timer del silenzio e il render,
   che scatta solo ai due cambi di stato. */
const RUNNING_IDLE_MS = 1200;
const running = Running.createRunning();

function noteRunning(t) {
  if (!t.alive) return;
  // Per Claude e opencode la barra la accende l'hook; Codex non ha un «lavora» esatto
  if (agentState.isExact(t.id) && t.type !== 'codex') return;
  if (running.data(t.id)) { t.running = true; showRunning(t); retractAttention(t); }
  clearTimeout(t.runTimer);
  t.runTimer = setTimeout(() => stopRunning(t), RUNNING_IDLE_MS);
}

function stopRunning(t) {
  clearTimeout(t.runTimer);
  t.runTimer = null;
  if (!running.stop(t.id)) return;
  t.running = false;
  showRunning(t);
}

/* Ha ripreso a lavorare: il «ho finito» acceso nella pausa era sbagliato */
function retractAttention(t) {
  // Un segnale esatto non si smentisce con l'output: lo spegne la visita
  if (agentState.isExact(t.id)) return;
  if (!t.needsAttention || !attention.resumed(t.id)) return;
  t.needsAttention = false;
  t.attentionKind = null;
  syncBadge();
  if (!sidebar.signal(t.id, { needsAttention: false })) renderSidebar();
}

/* Il segnale si accende e si spegne di continuo (ogni pausa di una sessione che
   lavora): passare da renderSidebar() ricostruirebbe le card, e la sessione che
   lampeggia «ho finito» ripartirebbe ogni volta dal fotogramma zero — il
   lampeggio si vedrebbe a scatti. */
function showRunning(t) {
  if (!sidebar.signal(t.id, { running: t.running })) renderSidebar();
  // Stage e commit si spengono mentre una sessione lavora (changes-panel.js)
  noteChangesRunning();
}

/** Azzera la segnalazione di una scheda. @returns {boolean} true se lampeggiava */
function clearAttention(id) {
  const t = tabs.get(id);
  if (!t) return false;
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  attention.seen(id);
  agentState.seen(id);
  if (!t.needsAttention) return false;
  t.needsAttention = false;
  t.attentionKind = null;
  syncBadge();
  return true;
}

/* ---------- Notifiche di sistema e badge (docs/plans/38) ----------
   Seguono la card: si accende → il main valuta se notificare (finestra
   dietro, notifiche accese); il badge è il numero di card accese. */
function notifyFinished(t) {
  try {
    window.aisess.notifyFinished(window.AisessNotify.notifyItem(t, { typeLabels: Groups.TYPE_LABELS, shortPath: Groups.shortPath }));
  } catch (e) {
    console.warn('notifica non inviata', e);
  }
}

function syncBadge() {
  try {
    window.aisess.notifyBadge(window.AisessNotify.attentionCount(tabs.values()));
  } catch (e) {
    console.warn('badge non aggiornato', e);
  }
}
