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
 * sommano al transform del div invece di sovrascriverlo). Chi ha un'ombra
 * nel disegno ne ha una seconda, <div class="pet-shadow">, che resta a
 * terra sotto di lui e sparisce quando si posa.
 *
 * Quando il cast cambia a striscia accesa non si ricomincia da capo: chi
 * resta continua da dov'è, chi esce svanisce (pets.js recast) e il suo
 * elemento si toglie quando il motore lo lascia andare.
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

  function buildFrame(doc, grid, palette) {
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('display', 'none');
    for (const r of Sprites.toRects(grid, palette)) {
      const rect = doc.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(r.x));
      rect.setAttribute('y', String(r.y));
      rect.setAttribute('width', String(r.w));
      rect.setAttribute('height', '1');
      rect.setAttribute('fill', r.fill);
      g.appendChild(rect);
    }
    return g;
  }

  /** Un <svg> di cols×rows pixel del disegno, ognuno lungo px. */
  function buildSvg(doc, cols, rows, px) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
    svg.setAttribute('width', String(cols * px));
    svg.setAttribute('height', String(rows * px));
    svg.setAttribute('shape-rendering', 'crispEdges');
    return svg;
  }

  /** Un <g> di rettangoli per frame; tutti spenti, draw() accende quello giusto. */
  function buildSprite(doc, kind, size, variant) {
    const sprite = Sprites.SPRITES[kind];
    const palette = Sprites.paletteOf(kind, variant);
    const { cols, rows } = Sprites.dims(kind);
    const svg = buildSvg(doc, cols, rows, Sprites.pixel(kind, size));
    const frames = {};
    for (const [pose, list] of Object.entries(sprite.frames)) {
      frames[pose] = list.map((grid) => svg.appendChild(buildFrame(doc, grid, palette)));
    }
    return { svg, frames };
  }

  /** Un disegno fuori dal div del personaggio, coi pixel suoi: un frame per griglia.
   *  offset centra il disegno sotto il personaggio; width è quanto è largo. */
  function buildLayer(doc, pet, size, grids, className, draw) {
    const px = Sprites.pixel(pet.kind, size);
    const palette = Sprites.paletteOf(pet.kind, pet.variant);
    const cols = grids[0][0].length;
    const svg = buildSvg(doc, cols, grids[0].length, px);
    const frames = grids.map((grid) => svg.appendChild(buildFrame(doc, grid, palette)));
    const el = doc.createElement('div');
    el.setAttribute('class', className);
    el.appendChild(svg);
    return { el, frames, shown: null, draw, width: cols * px, offset: ((Sprites.dims(pet.kind).cols - cols) / 2) * px };
  }

  /** L'ombra a terra: un frame per frame di volo, sparisce quando si posa. */
  function drawShadow(pet, layer) {
    layer.el.hidden = pet.y === 0;
    show(layer, layer.frames[Pets.frameIndex(pet, layer.frames.length)]);
    layer.el.style.transform = `translate(${(pet.x + layer.offset).toFixed(1)}px, 0px)`;
  }

  /** I disegni a parte che ha il personaggio, nell'ordine in cui vanno sotto di lui. */
  function buildLayers(doc, pet, size) {
    const { shadow } = Sprites.SPRITES[pet.kind];
    return [
      shadow && buildLayer(doc, pet, size, shadow, 'pet-shadow', drawShadow),
    ].filter(Boolean);
  }

  function buildPet(doc, pet, size) {
    const el = doc.createElement('div');
    const { svg, frames } = buildSprite(doc, pet.kind, size, pet.variant);
    el.appendChild(svg);
    return { el, frames, shown: null, layers: buildLayers(doc, pet, size) };
  }

  function show(view, frame) {
    if (frame === view.shown) return;
    if (view.shown) view.shown.setAttribute('display', 'none');
    frame.setAttribute('display', 'inline');
    view.shown = frame;
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

    function drawPet(pet, view) {
      const list = view.frames[pet.pose] || view.frames.walk;
      show(view, list[Pets.frameIndex(pet, list.length)]);
      const left = pet.dir < 0 ? ' pet--left' : '';
      view.el.setAttribute('class', `pet pet--${pet.kind} pet--${pet.pose}${left}`);
      view.el.style.transform = `translate(${pet.x.toFixed(1)}px, ${(-pet.y).toFixed(1)}px)`;
      for (const layer of view.layers) layer.draw(pet, layer, Pets.petWidth(pet.kind, size()));
    }

    function mount(pet) {
      const view = buildPet(doc, pet, size());
      views.set(pet.key, view);
      for (const layer of view.layers) strip.appendChild(layer.el);
      strip.appendChild(view.el);
    }

    function unmount(key) {
      const view = views.get(key);
      for (const layer of view.layers) layer.el.remove();
      view.el.remove();
      views.delete(key);
    }

    /** Elementi allineati allo stato: via chi è svanito, dentro chi è appena arrivato. */
    function reconcile() {
      const keys = new Set(state.pets.map((p) => p.key));
      for (const key of [...views.keys()]) if (!keys.has(key)) unmount(key);
      for (const pet of state.pets) if (!views.has(pet.key)) mount(pet);
    }

    function draw() {
      reconcile();
      for (const pet of state.pets) drawPet(pet, views.get(pet.key));
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

    function clear() {
      stop();
      strip.replaceChildren();
      views = new Map();
      state = null;
    }

    function apply(next) {
      const previous = config;
      config = Config.sanitizeConfig(next);
      if (!config.enabled || config.cast.length === 0) {
        clear();
        strip.hidden = true;
        return;
      }
      // Stessa misura, in scena e col ciclo che gira: si cambia solo chi entra
      // e chi esce. A ciclo fermo (meno movimento) nessuno finirebbe di
      // svanire, e resterebbe lì: si ricostruisce.
      const inPlace = active() && handle !== null && previous.size === config.size;
      if (!inPlace) {
        clear();
        strip.hidden = false;
        strip.style.height = `${size()}px`;
        lastBusy = now();
      }
      state = inPlace
        ? Pets.recast(state, { cast: config.cast, width: width(), random })
        : Pets.createPets({ cast: config.cast, width: width(), size: size(), random });
      draw();
      sync();
    }

    /* La striscia cambia larghezza anche senza resize della finestra (la
       sidebar si trascina): a ciclo fermo nessun tick li rimetterebbe dentro. */
    function refit() {
      if (!active()) return;
      state = Pets.fit(state, width());
      draw();
    }

    win.addEventListener('blur', () => { focused = false; sync(); });
    win.addEventListener('focus', () => { focused = true; sync(); });
    doc.addEventListener('visibilitychange', sync);
    if (win.ResizeObserver) new win.ResizeObserver(refit).observe(strip);

    return {
      apply,
      /** Da richiamare quando cambia qualcosa che sync legge (es. meno movimento). */
      refresh: sync,
      pause: () => { focused = false; sync(); },
      resume: () => { focused = true; sync(); },
      isRunning: () => handle !== null,
    };
  }

  return { createPetsView };
});
