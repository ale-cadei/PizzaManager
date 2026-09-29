/* Striscia degli animaletti (docs/plans/33-animaletti.md): DOM e ciclo di
 * animazione. La logica sta in pets.js; qui si costruiscono i disegni una
 * volta sola (un <g> per frame, si accende quello giusto) e a ogni frame si
 * spostano con transform, che non ricalcola il layout.
 *
 * Il ciclo gira solo se servono: accesi, finestra visibile e con il fuoco,
 * nessuna richiesta di movimento ridotto. Altrimenti niente
 * requestAnimationFrame, zero CPU.
 *
 * Ogni personaggio è un <div class="pet"> (posizione) con dentro l'<svg>
 * (specchio e saltello, con le proprietà CSS scale e translate, che si
 * sommano al transform del div invece di sovrascriverlo).
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = root
    ? factory(root.AisessPets, root.AisessPetsSprites, root.AisessPetsConfig)
    : factory(require('./pets'), require('./pets-sprites'), require('./pets-config'));
  if (root) root.AisessPetsView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Pets, Sprites, Config) {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Un <g> di rettangoli per frame; tutti spenti, draw() accende quello giusto. */
  function buildSprite(doc, kind, size) {
    const sprite = Sprites.SPRITES[kind];
    const { cols, rows } = Sprites.dims(kind);
    const px = size / Sprites.GRID;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
    svg.setAttribute('width', String(cols * px));
    svg.setAttribute('height', String(rows * px));
    svg.setAttribute('shape-rendering', 'crispEdges');
    const frames = {};
    for (const [pose, list] of Object.entries(sprite.frames)) {
      frames[pose] = list.map((grid) => {
        const g = doc.createElementNS(SVG_NS, 'g');
        g.setAttribute('display', 'none');
        for (const r of Sprites.toRects(grid, sprite.palette)) {
          const rect = doc.createElementNS(SVG_NS, 'rect');
          rect.setAttribute('x', String(r.x));
          rect.setAttribute('y', String(r.y));
          rect.setAttribute('width', String(r.w));
          rect.setAttribute('height', '1');
          rect.setAttribute('fill', r.fill);
          g.appendChild(rect);
        }
        svg.appendChild(g);
        return g;
      });
    }
    return { svg, frames };
  }

  function buildPet(doc, pet, size) {
    const el = doc.createElement('div');
    const { svg, frames } = buildSprite(doc, pet.kind, size);
    el.appendChild(svg);
    return { el, frames, shown: null };
  }

  /**
   * @param {{ doc: Document, win: Window, strip: HTMLElement,
   *   signals: () => {running: boolean, attention: boolean},
   *   now?: () => number, raf?: Function, caf?: Function,
   *   reducedMotion?: () => boolean, random?: () => number }} opts
   */
  function createPetsView({ doc, win, strip, signals, now = () => Date.now(), raf, caf, reducedMotion = () => false, random = Math.random }) {
    let config = Config.sanitizeConfig(null);
    let state = null;
    let views = new Map();
    let handle = null;
    let last = 0;
    let lastBusy = now();
    let focused = typeof doc.hasFocus === 'function' ? doc.hasFocus() : true;

    const size = () => Config.SIZES[config.size];
    const width = () => strip.clientWidth || 0;
    const active = () => Boolean(state && state.pets.length);

    function draw() {
      for (const pet of state.pets) {
        const view = views.get(pet.key);
        const list = view.frames[pet.pose] || view.frames.walk;
        const frame = list[Pets.frameIndex(pet, list.length)];
        if (frame !== view.shown) {
          if (view.shown) view.shown.setAttribute('display', 'none');
          frame.setAttribute('display', 'inline');
          view.shown = frame;
        }
        const left = pet.dir < 0 ? ' pet--left' : '';
        view.el.setAttribute('class', `pet pet--${pet.kind} pet--${pet.pose}${left}`);
        view.el.style.transform = `translate(${pet.x.toFixed(1)}px, ${(-pet.y).toFixed(1)}px)`;
      }
    }

    function tick() {
      handle = null;
      const t = now();
      const { running, attention } = signals();
      if (running) lastBusy = t;
      const mood = Pets.moodOf({ running, attention, idleMs: t - lastBusy });
      state = Pets.step(state, { dt: t - last, width: width(), mood, speed: Config.SPEEDS[config.speed], random });
      last = t;
      draw();
      handle = raf(tick);
    }

    function stop() {
      if (handle === null) return;
      caf(handle);
      handle = null;
    }

    /** Avvia o ferma il ciclo secondo quello che vale adesso. */
    function sync() {
      const wanted = active() && focused && !doc.hidden && !reducedMotion();
      if (!wanted) { stop(); return; }
      if (handle !== null) return;
      last = now();
      handle = raf(tick);
    }

    function apply(next) {
      config = Config.sanitizeConfig(next);
      stop();
      strip.replaceChildren();
      views = new Map();
      state = null;
      if (!config.enabled || config.cast.length === 0) {
        strip.hidden = true;
        return;
      }
      strip.hidden = false;
      strip.style.height = `${size()}px`;
      state = Pets.createPets({ cast: config.cast, width: width(), size: size(), random });
      for (const pet of state.pets) {
        const view = buildPet(doc, pet, size());
        views.set(pet.key, view);
        strip.appendChild(view.el);
      }
      lastBusy = now();
      draw();
      sync();
    }

    win.addEventListener('blur', () => { focused = false; sync(); });
    win.addEventListener('focus', () => { focused = true; sync(); });
    doc.addEventListener('visibilitychange', sync);

    return {
      apply,
      pause: () => { focused = false; sync(); },
      resume: () => { focused = true; sync(); },
      isRunning: () => handle !== null,
    };
  }

  return { createPetsView };
});
