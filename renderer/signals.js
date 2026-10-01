/* Segnali sulle card: «l'assistente ha finito» (lampeggio) e «sta lavorando».
   Le regole stanno in attention.js e running.js; qui i timer e il render. */

/* ---------- "L'assistente ha finito": card che lampeggia ----------
   Un agente TUI scrive senza sosta mentre lavora: quando il flusso si ferma
   per ATTENTION_IDLE_MS su una scheda non in primo piano, il turno può essere
   finito. *Può*: decidere se quella raffica era un lavoro o solo la TUI che si
   ridisegna spetta a renderer/attention.js, che è dove sta la regola (e dove i
   test la provano). Qui restano il timer e il render. */
const ATTENTION_IDLE_MS = 1500;
const attention = Attention.createAttention();

function noteActivity(t, bytes) {
  if (t.type === 'shell') return;   // nessun assistente: niente da segnalare
  if (t.id === activeId) return;    // già sotto gli occhi dell'utente
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
  if (t.type === 'shell' || t.id === activeId || t.needsAttention) return;
  if (!(bell ? attention.bell(t.id) : attention.idle(t.id))) return;
  t.needsAttention = true;
  // Solo la classe sulla card: rifare la sidebar farebbe ripartire da capo il
  // lampeggio di tutte le altre (render() ricostruisce gli elementi).
  if (!sidebar.signal(t.id, { needsAttention: true })) renderSidebar();
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
  if (!t.needsAttention || !attention.resumed(t.id)) return;
  t.needsAttention = false;
  if (!sidebar.signal(t.id, { needsAttention: false })) renderSidebar();
}

/* Il segnale si accende e si spegne di continuo (ogni pausa di una sessione che
   lavora): passare da renderSidebar() ricostruirebbe le card, e la sessione che
   lampeggia «ho finito» ripartirebbe ogni volta dal fotogramma zero — il
   lampeggio si vedrebbe a scatti. */
function showRunning(t) {
  if (!sidebar.signal(t.id, { running: t.running })) renderSidebar();
}

/** Azzera la segnalazione di una scheda. @returns {boolean} true se lampeggiava */
function clearAttention(id) {
  const t = tabs.get(id);
  if (!t) return false;
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  attention.seen(id);
  if (!t.needsAttention) return false;
  t.needsAttention = false;
  return true;
}
