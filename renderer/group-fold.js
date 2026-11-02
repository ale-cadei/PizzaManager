/* Apertura e chiusura animate di un gruppo della sidebar
 * (docs/plans/80-gruppo-in-cima.md).
 *
 * La sidebar ridisegna tutta la lista a ogni render(): una transizione CSS
 * non vedrebbe mai il «prima», perché l'elemento è sempre nuovo. Si anima con
 * le Web Animations sul corpo del gruppo:
 * - aprendo, DOPO il render: il corpo nuovo cresce da 0 alla sua altezza, e la
 *   fetta ruota dalla posizione chiusa a quella aperta;
 * - chiudendo, PRIMA del render: il corpo vecchio si schiaccia a 0, e solo
 *   alla fine il gruppo si ridisegna chiuso.
 *
 * Senza `animate` (test, DOM finti) o con prefers-reduced-motion tutto è
 * istantaneo: `close()` si risolve subito.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina e module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessGroupFold = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const DURATION_MS = 180;
  const EASING = 'cubic-bezier(.2, 0, 0, 1)';
  // Le stesse trasformazioni della CSS (`.group-header .chevron svg`)
  const CHEVRON_CLOSED = 'rotate(0deg)';
  const CHEVRON_OPEN = 'translateY(2px) rotate(90deg)';

  /**
   * I fotogrammi del corpo: altezza, padding sotto e opacità insieme, così a
   * fine chiusura non resta la striscia del padding.
   * @param {number} height altezza piena del corpo
   * @param {string} paddingBottom padding sotto a corpo aperto (es. "8px")
   * @returns {object[]} dal chiuso all'aperto
   */
  function bodyFrames(height, paddingBottom) {
    return [
      { height: '0px', paddingBottom: '0px', opacity: 0, overflow: 'hidden' },
      { height: `${Math.max(0, height)}px`, paddingBottom, opacity: 1, overflow: 'hidden' },
    ];
  }

  /**
   * @param {{reducedMotion?: () => boolean, getStyle?: (el: Element) => {paddingBottom: string}}} [deps]
   * @returns {{open: (body: HTMLElement, chevron?: Element|null) => void,
   *   close: (body: HTMLElement) => Promise<void>, animates: (el: Element) => boolean}}
   */
  function createGroupFold({ reducedMotion = () => false, getStyle = null } = {}) {
    const animates = (el) => !!el && typeof el.animate === 'function' && !reducedMotion();
    const timing = { duration: DURATION_MS, easing: EASING };
    const paddingOf = (el) => (getStyle ? getStyle(el).paddingBottom : '') || '0px';

    function open(body, chevron = null) {
      if (!animates(body)) return;
      body.animate(bodyFrames(body.scrollHeight, paddingOf(body)), timing);
      if (chevron && typeof chevron.animate === 'function') {
        chevron.animate([{ transform: CHEVRON_CLOSED }, { transform: CHEVRON_OPEN }], timing);
      }
    }

    function close(body) {
      if (!animates(body)) return Promise.resolve();
      const frames = bodyFrames(body.getBoundingClientRect().height, paddingOf(body)).reverse();
      // `fill` tiene il corpo schiacciato fino al render che lo toglie: senza,
      // per un fotogramma tornerebbe aperto
      const anim = body.animate(frames, { ...timing, fill: 'forwards' });
      return anim.finished.then(() => {}, () => {});
    }

    return { open, close, animates };
  }

  return { createGroupFold, bodyFrames, DURATION_MS };
});
