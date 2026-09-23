/* Quando una card deve lampeggiare — «l'assistente ha finito».
 *
 * La regola non è «è arrivato dell'output e poi ha smesso»: con quella, una
 * sessione già vista ricomincia a lampeggiare da sola. Basta che scriva
 * qualcosa, e qualcosa scrive sempre: tornare su una sessione la fa
 * ridimensionare (`refitTab`), e la TUI si ridisegna tutta — kilobyte che
 * arrivano mentre l'utente sta già passando a un'altra scheda. Il risultato è
 * una card che riprende a lampeggiare per un lavoro che l'utente ha appena
 * guardato.
 *
 * Quello che il lampeggio deve dire è: «da quando l'hai vista, QUI si è
 * lavorato e non l'hai ancora visto». Quindi:
 *   - subito dopo che l'utente lascia una scheda c'è una finestra di silenzio:
 *     quell'output è il ridisegno provocato dalla visita, non un lavoro;
 *   - se l'utente non ha scritto niente in quella sessione da quando l'ha
 *     vista, per lampeggiare non basta un frammento: l'output deve durare
 *     (un lavoro vero scrive per secondi, un ridisegno per un attimo);
 *   - se invece l'utente ha scritto qualcosa, ha chiesto lui: anche una
 *     risposta breve va segnalata, e la finestra di silenzio non vale più.
 *
 * Il modulo non sa niente di schede, tipi o DOM: riceve gli eventi e risponde
 * se la card va accesa. I tempi li decide chi lo chiama (il renderer tiene il
 * suo setTimeout), l'orologio si inietta per poterlo provare.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessAttention = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Sotto questa soglia è solo la TUI che si ridisegna, non una risposta. */
  const MIN_BYTES = 40;
  /** Silenzio dopo che la scheda smette di essere in primo piano. */
  const MUTE_MS = 2000;
  /** Quanto deve durare l'output perché sia un lavoro e non un frammento. */
  const WORK_MS = 1500;

  function createAttention(opts = {}) {
    const minBytes = opts.minBytes === undefined ? MIN_BYTES : opts.minBytes;
    const muteMs = opts.muteMs === undefined ? MUTE_MS : opts.muteMs;
    const workMs = opts.workMs === undefined ? WORK_MS : opts.workMs;
    const now = opts.now || (() => Date.now());

    /** @type {Map<string, {bytes: number, start: number, end: number, muteUntil: number, typed: boolean, flagged: boolean}>} */
    const state = new Map();

    function get(id) {
      if (!state.has(id)) {
        state.set(id, { bytes: 0, start: 0, end: 0, muteUntil: 0, typed: false, flagged: false });
      }
      return state.get(id);
    }

    function resetBurst(s) { s.bytes = 0; s.start = 0; s.end = 0; }

    /** Output arrivato su una scheda che non è in primo piano. */
    function data(id, bytes) {
      const s = get(id);
      const t = now();
      if (!s.start) s.start = t;
      s.end = t;
      s.bytes += bytes;
    }

    /**
     * Il flusso si è fermato: questa raffica era un lavoro finito?
     * @returns {boolean} true se la card deve accendersi adesso
     */
    function idle(id) {
      const s = get(id);
      const { bytes, start, end } = s;
      resetBurst(s);
      if (s.flagged || bytes < minBytes) return false;
      if (!s.typed) {
        // Coda del ridisegno provocato dalla visita appena finita
        if (end <= s.muteUntil) return false;
        // Un frammento isolato non è un lavoro: la TUI si sistema da sola
        if (end - start < workMs) return false;
      }
      s.flagged = true;
      return true;
    }

    /**
     * Il bell del terminale: gli agenti lo suonano a fine turno, vale subito.
     * Resta fuori solo quello che suona dentro la finestra di silenzio.
     * @returns {boolean}
     */
    function bell(id) {
      const s = get(id);
      resetBurst(s);
      if (s.flagged) return false;
      if (!s.typed && now() <= s.muteUntil) return false;
      s.flagged = true;
      return true;
    }

    /** L'utente ha scritto qui: quello che arriva dopo l'ha chiesto lui. */
    function typed(id) {
      const s = get(id);
      s.typed = true;
      s.muteUntil = 0;
    }

    /** L'utente sta guardando la scheda: quello che c'era l'ha visto. */
    function seen(id) {
      const s = get(id);
      resetBurst(s);
      s.flagged = false;
      s.typed = false;
      s.muteUntil = 0;
    }

    /** La scheda non è più in primo piano: parte la finestra di silenzio. */
    function left(id) {
      const s = get(id);
      resetBurst(s);
      s.muteUntil = now() + muteMs;
    }

    function isFlagged(id) { return Boolean(state.has(id) && state.get(id).flagged); }
    function forget(id) { state.delete(id); }

    return { data, idle, bell, typed, seen, left, isFlagged, forget };
  }

  return { createAttention, MIN_BYTES, MUTE_MS, WORK_MS };
});
