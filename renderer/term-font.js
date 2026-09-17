/* Dimensione del testo dei terminali.
 *
 * Una sola per tutte le schede, cambiata con ⌘+ / ⌘- / ⌘0 (menu Vista) e
 * ricordata in localStorage. Prende il posto dello zoom di pagina di
 * Electron, che ingrandiva anche la sidebar e restava memorizzato fra un
 * avvio e l'altro: in un'app di terminali "più grande" vuol dire il testo
 * del terminale, non l'interfaccia.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. Puro: chi lo usa applica il valore
 * a xterm.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessTermFont = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const STORAGE_KEY = 'aisess.termFontSize';
  const DEFAULT_SIZE = 14;
  const MIN_SIZE = 9;
  const MAX_SIZE = 28;

  function clamp(n) {
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
  }

  /** Solo interi nella scala; tutto il resto è il default. */
  function parse(raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) return DEFAULT_SIZE;
    return n;
  }

  /** @param {Storage} storage localStorage, o un sostituto nei test */
  function createFontSizeStore(storage) {
    let size = DEFAULT_SIZE;
    try { size = parse(storage.getItem(STORAGE_KEY)); } catch {}

    function save(next) {
      size = next;
      try { storage.setItem(STORAGE_KEY, String(next)); } catch {}
      return size;
    }

    return {
      get: () => size,
      /** @param {number} delta punti in più o in meno */
      step: (delta) => save(clamp(size + delta)),
      reset: () => save(DEFAULT_SIZE),
    };
  }

  return { createFontSizeStore, STORAGE_KEY, DEFAULT_SIZE, MIN_SIZE, MAX_SIZE };
});
