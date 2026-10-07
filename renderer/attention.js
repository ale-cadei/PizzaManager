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
 *     risposta breve va segnalata, e la finestra di silenzio non vale più;
 *   - la prima raffica di una scheda appena nata o riattaccata è l'avvio
 *     (tmux che ridisegna lo schermo, `--resume` che riscrive la
 *     conversazione): dura secondi, ma non è un lavoro. All'apertura dell'app
 *     accendeva tutte le sessioni ripristinate. E non arriva tutto insieme
 *     (tmux ridisegna, la TUI si riadatta alla misura nuova, `--resume`
 *     riscrive): con il main occupato a ripristinare le altre schede le pause
 *     superano l'idle. Vale quindi la prima raffica E tutto quello che
 *     comincia entro BOOT_MS dalla nascita. Un processo appena lanciato (non
 *     riattaccato) non lavora senza una domanda: per lui l'avvio dura finché
 *     l'utente non scrive;
 *   - una card accesa che riprende a lavorare si spegne: il silenzio era una
 *     pausa a metà turno (un tool che gira, l'attesa del modello), e la card
 *     mostrava insieme «sta lavorando» e «ha finito». Si riaccende alla fine.
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
  /** Dalla nascita della scheda, quanto dura l'avvio (raffiche e bell). */
  const BOOT_MS = 10000;

  function createAttention(opts = {}) {
    const minBytes = opts.minBytes === undefined ? MIN_BYTES : opts.minBytes;
    const muteMs = opts.muteMs === undefined ? MUTE_MS : opts.muteMs;
    const workMs = opts.workMs === undefined ? WORK_MS : opts.workMs;
    const bootMs = opts.bootMs === undefined ? BOOT_MS : opts.bootMs;
    const now = opts.now || (() => Date.now());

    /** @type {Map<string, {bytes: number, start: number, end: number, muteUntil: number, typed: boolean, flagged: boolean, booting: boolean, bootUntil: number, working: boolean}>} */
    const state = new Map();

    function get(id) {
      if (!state.has(id)) {
        state.set(id, { bytes: 0, start: 0, end: 0, muteUntil: 0, typed: false, flagged: false, booting: false, bootUntil: 0, working: false });
      }
      return state.get(id);
    }

    function resetBurst(s) { s.bytes = 0; s.start = 0; s.end = 0; }

    /** Quello che arriva all'istante `t` è ancora l'avvio? L'utente che scrive lo chiude. */
    function inBoot(s, t) { return !s.typed && (s.booting || t <= s.bootUntil); }

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
      if (inBoot(s, start)) { s.booting = false; return false; }
      // Già vista lavorare (resumed): la coda del turno può essere breve
      if (!s.typed && !s.working) {
        // Coda del ridisegno provocato dalla visita appena finita
        if (end <= s.muteUntil) return false;
        // Un frammento isolato non è un lavoro: la TUI si sistema da sola
        if (end - start < workMs) return false;
      }
      s.flagged = true;
      s.working = false;
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
      const t = now();
      if (inBoot(s, t) || (!s.typed && t <= s.muteUntil)) return false;
      s.flagged = true;
      s.working = false;
      return true;
    }

    /** L'utente ha scritto qui: quello che arriva dopo l'ha chiesto lui. */
    function typed(id) {
      const s = get(id);
      s.typed = true;
      s.muteUntil = 0;
      s.booting = false;
      s.bootUntil = 0;
    }

    /**
     * La sessione ha ripreso a lavorare (renderer/running.js).
     * `typed` resta: la risposta che l'utente aspetta non è ancora arrivata.
     * @returns {boolean} true se la card era accesa e va spenta
     */
    function resumed(id) {
      const s = get(id);
      if (!s.flagged) return false;
      s.flagged = false;
      s.working = true;
      return true;
    }

    /**
     * Scheda appena nata o riattaccata: la prima raffica, e quelle entro BOOT_MS, sono l'avvio.
     * `untilTyped`: processo appena lanciato (non un riattacco). Senza una domanda
     * dell'utente non ha lavori da finire, quindi l'avvio dura finché non scrive.
     * Un tempo non basta: a PC appena acceso tmux si attacca subito e
     * `claude --resume` riscrive la conversazione oltre BOOT_MS.
     * @param {string} id
     * @param {{untilTyped?: boolean}} [o]
     */
    function born(id, { untilTyped = false } = {}) {
      const s = get(id);
      s.booting = true;
      s.bootUntil = untilTyped ? Infinity : now() + bootMs;
    }

    /** L'utente sta guardando la scheda: quello che c'era l'ha visto. */
    function seen(id) {
      const s = get(id);
      resetBurst(s);
      s.flagged = false;
      s.typed = false;
      s.working = false;
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

    return { data, idle, bell, typed, born, resumed, seen, left, isFlagged, forget };
  }

  /*
   * Byte che xterm manda da solo, senza che l'utente tocchi la tastiera:
   * report del mouse (claude e opencode chiedono ?1003h, ogni movimento sopra
   * il terminale ne produce uno), focus dentro/fuori, risposte a domande del
   * programma (DA, posizione del cursore, colori OSC). Passano da onData come
   * i tasti, ma non sono "l'utente ha chiesto qualcosa".
   */
  const GENERATED = new RegExp([
    /\x1b\[<\d+;\d+;\d+[Mm]/,                 // mouse SGR
    /\x1b\[M[\s\S]{3}/,                       // mouse X10
    /\x1b\[[IO]/,                             // focus
    /\x1b\[[?>][\d;]*c/,                      // DA
    /\x1b\[\d+;\d+R/,                         // posizione del cursore
    /\x1b\][\d;]*[^\x07\x1b]*(?:\x07|\x1b\\)/, // OSC (colori)
  ].map((r) => r.source).join('|'), 'g');

  /** true se in `data` c'è qualcosa che ha scritto l'utente (tasti, incolla). */
  function isTyping(data) {
    return String(data || '').replace(GENERATED, '').length > 0;
  }

  return { createAttention, isTyping, MIN_BYTES, MUTE_MS, WORK_MS, BOOT_MS };
});
