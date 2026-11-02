/* Aperture e chiusure animate dei pannelli (docs/plans/80-gruppo-in-cima.md):
 * la sidebar che si comprime, l'albero dei file dell'editor, il pannello
 * delle modifiche che esce dalla linguetta.
 *
 * Tutti e tre cambiano di colpo per una classe o per `hidden`: qui si misura
 * il prima e il dopo e si anima fra i due con le Web Animations.
 * - La larghezza si anima su min-width e max-width insieme: vincono sulla
 *   `width` anche quando è !important (la sidebar compressa), perché sono
 *   limiti, non valori.
 * - Chi sparisce (`display: none`) si anima PRIMA e lo si nasconde alla fine;
 *   chi compare si anima DOPO averlo mostrato.
 * - Un'animazione nuova sullo stesso elemento cancella quella in corso: la
 *   misura di partenza è dove l'elemento si trova adesso, quindi un doppio
 *   click torna indietro da lì senza salti.
 *
 * Senza `animate` (test, DOM finti) o con prefers-reduced-motion tutto è
 * istantaneo.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina e module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessMotion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const DURATION_MS = 180;
  const EASING = 'cubic-bezier(.2, 0, 0, 1)';

  const px = (n) => `${Math.max(0, Math.round(n))}px`;
  /** Fotogramma di una larghezza fissata, contenuto tagliato. */
  const widthFrame = (w) => ({ minWidth: px(w), maxWidth: px(w), overflow: 'hidden' });

  /**
   * @param {{reducedMotion?: () => boolean}} [deps]
   */
  function createMotion({ reducedMotion = () => false } = {}) {
    const timing = { duration: DURATION_MS, easing: EASING };
    const running = new WeakMap();

    const animates = (el) => !!el && typeof el.animate === 'function' && !reducedMotion();
    const widthOf = (el) => el.getBoundingClientRect().width;

    function stop(el) {
      const anim = running.get(el);
      if (anim) anim.cancel();
    }

    /** Avvia un'animazione su `el`; si risolve a true se arriva in fondo. */
    function play(el, frames, opts = {}) {
      stop(el);
      const anim = el.animate(frames, { ...timing, ...opts });
      running.set(el, anim);
      return anim.finished.then(() => true, () => false).then((done) => {
        if (running.get(el) === anim) running.delete(el);
        return { done, anim };
      });
    }

    /**
     * L'elemento resta visibile e cambia larghezza per effetto di `apply`
     * (una classe): si anima dalla vecchia alla nuova.
     * @returns {Promise<boolean>} true se l'animazione è arrivata in fondo
     */
    function resizeWidth(el, apply) {
      if (!animates(el)) { apply(); return Promise.resolve(true); }
      const from = widthOf(el);
      stop(el);
      apply();
      const to = widthOf(el);
      if (Math.round(from) === Math.round(to)) return Promise.resolve(true);
      return play(el, [widthFrame(from), widthFrame(to)]).then((r) => r.done);
    }

    /** L'elemento compare per effetto di `apply` e cresce da 0 alla sua larghezza. */
    function showWidth(el, apply) {
      if (!animates(el)) { apply(); return Promise.resolve(true); }
      const from = running.has(el) ? widthOf(el) : 0;
      stop(el);
      apply();
      return play(el, [widthFrame(from), widthFrame(widthOf(el))]).then((r) => r.done);
    }

    /**
     * L'elemento si stringe a 0 e solo alla fine `apply` lo nasconde. Se nel
     * frattempo un'altra animazione lo riprende, `apply` non si chiama.
     */
    function hideWidth(el, apply) {
      if (!animates(el)) { apply(); return Promise.resolve(true); }
      return play(el, [widthFrame(widthOf(el)), widthFrame(0)], { fill: 'forwards' }).then(({ done, anim }) => {
        if (done) { apply(); anim.cancel(); }
        return done;
      });
    }

    /** Pannello che entra dal bordo destro, già mostrato. */
    function slideIn(el) {
      if (!animates(el)) return Promise.resolve(true);
      return play(el, [{ transform: 'translateX(100%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }]).then((r) => r.done);
    }

    /** Pannello che esce dal bordo destro; alla fine `apply` lo nasconde. */
    function slideOut(el, apply) {
      if (!animates(el)) { apply(); return Promise.resolve(true); }
      return play(el, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(100%)', opacity: 0.4 }], { fill: 'forwards' })
        .then(({ done, anim }) => {
          if (done) { apply(); anim.cancel(); }
          return done;
        });
    }

    return { resizeWidth, showWidth, hideWidth, slideIn, slideOut, animates };
  }

  /** Il `motion` della pagina: uno solo, così due pannelli che animano lo
   *  stesso elemento si cancellano a vicenda invece di sovrapporsi. */
  let pageMotion = null;
  function createPageMotion(win) {
    if (!pageMotion) {
      pageMotion = createMotion({
        reducedMotion: () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches),
      });
    }
    return pageMotion;
  }

  return { createMotion, createPageMotion, widthFrame, DURATION_MS };
});
