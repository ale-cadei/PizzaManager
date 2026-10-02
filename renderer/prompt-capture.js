/* Primo prompt digitato nel terminale.
 *
 * Il nome della scheda non può dipendere da dove ogni CLI salva le sue
 * conversazioni: formati e percorsi cambiano da strumento a strumento e da
 * versione a versione. Quello che si digita passa però sempre di qui, prima di
 * arrivare al pty: la prima riga inviata con Invio è il titolo più fedele a
 * quello che l'utente ha in testa, e vale per ogni tipo di sessione.
 *
 * Si guarda solo l'input dell'utente, mai l'output del terminale: niente
 * schermate da interpretare, nessun titolo preso da un banner di benvenuto.
 *
 * Espone il globale `AisessPromptCapture`; sotto Node esporta lo stesso
 * oggetto, per poterlo testare senza browser.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessPromptCapture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const DEFAULT_MAX = 40;
  const BUFFER_MAX = 4000; // un incolla enorme non deve crescere senza limiti

  /* Non tutto quello che esce da xterm è digitato: i TUI interrogano il
     terminale (colori, posizione del cursore, capacità) e xterm risponde sullo
     stesso canale dell'input. Quelle risposte iniziano sempre con ESC, come i
     tasti speciali: un blocco che comincia per ESC non è mai testo del prompt.
     Unica eccezione, l'incolla, che arriva avvolto nei marcatori bracketed. */
  const PASTE_START = /\x1b\[200~/g;
  const PASTE_END = /\x1b\[201~/g;
  const ESCAPE_SEQ = /\x1b(\][^\x07\x1b]*(\x07|\x1b\\)?|\[[0-9;?]*[ -/]*[@-~]|O[@-~]|.)/g;
  const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
  /* Un incolla su più righe è un prompt solo, inviato dall'Invio che viene dopo */
  const PASTED_BLOCK = /\x1b\[200~([\s\S]*?)(?:\x1b\[201~|$)/g;
  /* Risposte ai menu delle TUI (permessi: «1», «y»): con `repeat` restano nel
     buffer e un Invio dopo le farebbe passare per un prompt */
  const MENU_ANSWER = /^[0-9yn]{1,3}$/i;
  const CTRL_C = '\x03';

  /**
   * Accumula quello che l'utente digita e restituisce la prima riga inviata.
   * Con `repeat` restituisce ogni riga inviata, non solo la prima: è l'invio
   * di un prompt che apre un «giro» del pannello delle modifiche (piano 32).
   * @param {{max?: number, repeat?: boolean}} [opts] lunghezza massima del titolo
   */
  function createPromptCapture({ max = DEFAULT_MAX, repeat = false } = {}) {
    let buffer = '';
    let done = false;

    /** Backspace: cancella un carattere, come lo vede l'utente. */
    function applyBackspace(chunk) {
      for (const ch of chunk) {
        if (ch === '\x7f' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    }

    function takeLine() {
      const line = buffer.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
      buffer = '';
      // Una riga vuota o un comando del CLI (/model, /init…) non è un prompt
      if (!line || line.startsWith('/')) return null;
      if (repeat && MENU_ANSWER.test(line)) return null;
      done = !repeat;
      return line.slice(0, max);
    }

    /**
     * @param {string} data quello che l'utente ha appena digitato o incollato
     * @returns {string|null} il titolo, solo quando la prima riga è completa
     */
    function feed(data) {
      if (done) return null;
      const raw = String(data == null ? '' : data).replace(PASTED_BLOCK, (m, body) => `\x1b[200~${body.replace(/\r\n|\r|\n/g, ' ')}\x1b[201~`);
      // Ctrl+C: la bozza è abbandonata (Claude e codex svuotano la riga)
      if (raw.includes(CTRL_C)) { buffer = ''; return null; }
      const pasted = PASTE_START.test(raw);
      PASTE_START.lastIndex = 0;
      // Risposta del terminale o tasto speciale: non l'ha scritto l'utente
      if (!pasted && raw.startsWith('\x1b')) return null;
      const text = raw.replace(PASTE_START, '').replace(PASTE_END, '').replace(ESCAPE_SEQ, '');
      let result = null;
      for (const part of text.split(/\r\n|\r|\n/).slice(0, -1)) {
        applyBackspace(part);
        result = takeLine();
        if (result) return result;
      }
      const rest = text.split(/\r\n|\r|\n/).pop();
      applyBackspace(rest);
      if (buffer.length > BUFFER_MAX) buffer = buffer.slice(-BUFFER_MAX);
      return result;
    }

    return { feed, isDone: () => done };
  }

  return { createPromptCapture, DEFAULT_MAX };
});
