/* Quale sessione sta lavorando in questo momento.
 *
 * Dalla lista non si distingueva una sessione che sta macinando da una ferma
 * al prompt: l'unico segnale era il lampeggio, che parla del passato («ha
 * finito») e solo per le schede in secondo piano. Qui la domanda è al presente,
 * e vale per tutte, anche per quella in primo piano.
 *
 * Il segnale è l'output: un processo che lavora scrive (le TUI degli agenti
 * animano lo spinner, un `npm run build` sputa righe). Ma non basta «è arrivato
 * un byte»: la TUI si ridisegna anche da ferma — a una finestra che cambia
 * misura, a un carattere digitato — e la card si metterebbe a correre per
 * niente. Quindi il flusso deve *durare* un attimo prima di contare, mentre a
 * fermarsi basta un momento di silenzio (quello lo cronometra chi chiama, che
 * ha già il suo timer).
 *
 * Il modulo tiene solo lo stato e risponde ai cambi: il renderer ridisegna la
 * lista quando una sessione parte o si ferma, mai a ogni chunk di output.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessRunning = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Quanto deve durare il flusso prima di chiamarlo «in esecuzione». */
  const START_MS = 300;

  function createRunning(opts = {}) {
    const startMs = opts.startMs === undefined ? START_MS : opts.startMs;
    const now = opts.now || (() => Date.now());

    /** @type {Map<string, {start: number, running: boolean}>} */
    const state = new Map();
    const get = (id) => {
      if (!state.has(id)) state.set(id, { start: 0, running: false });
      return state.get(id);
    };

    /**
     * È arrivato dell'output.
     * @returns {boolean} true se la sessione ha ORA cominciato a lavorare
     *   (il renderer ridisegna solo su questo, non a ogni chunk)
     */
    function data(id) {
      const s = get(id);
      if (s.running) return false;
      const t = now();
      if (!s.start) { s.start = t; return false; }
      if (t - s.start < startMs) return false;
      s.running = true;
      return true;
    }

    /**
     * Silenzio: il flusso si è fermato.
     * @returns {boolean} true se la sessione stava lavorando e ora è ferma
     */
    function stop(id) {
      const s = get(id);
      s.start = 0;
      if (!s.running) return false;
      s.running = false;
      return true;
    }

    function isRunning(id) { return Boolean(state.has(id) && state.get(id).running); }
    function forget(id) { state.delete(id); }

    return { data, stop, isRunning, forget };
  }

  return { createRunning, START_MS };
});
