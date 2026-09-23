/* Rotella e barra laterale dei terminali.
 *
 * Dietro tmux la history non è di xterm: tmux ridisegna il terminale
 * scorrendolo con `CSI n S`, righe che xterm.js non conserva, e lo scrollback
 * di xterm resta vuoto o a buchi. Si scorre allora la history di tmux (la
 * copy-mode, vedi lib/tmux.js) passando dal main. Senza tmux (Windows) la
 * history è quella di xterm: `xtermBackend`.
 *
 * Un backend risponde a scroll(righe su), scrollTo(righe dal fondo) e state()
 * con { history, position, rows, inMode, alternate }: position è quante righe
 * sopra il fondo sta la vista.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessTermScroll = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const MIN_THUMB = 24;
  // Aggiornare lo stato a ogni pezzo di output sarebbe un processo tmux per
  // pezzo: basta qualche volta al secondo perché la barra segua la history.
  const OUTPUT_REFRESH_MS = 250;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** Misura e posizione del cursore sulla barra, in px. */
  function thumbGeometry(s) {
    if (!s || !(s.history > 0) || !(s.track > 0)) return { scrollable: false, size: 0, offset: 0 };
    const total = s.history + Math.max(1, s.rows);
    const size = Math.round(clamp((s.track * s.rows) / total, Math.min(MIN_THUMB, s.track), s.track));
    const fromTop = s.history - clamp(s.position, 0, s.history);
    return { scrollable: true, size, offset: Math.round(((s.track - size) * fromTop) / s.history) };
  }

  /** Inverso di thumbGeometry: con il cursore a `thumbTop`, quante righe dal fondo. */
  function fromBottomAt({ thumbTop, track, size, history }) {
    const room = track - size;
    if (!(room > 0) || !(history > 0)) return 0;
    return Math.round(history * (1 - clamp(thumbTop, 0, room) / room));
  }

  /** Righe verso l'alto per un WheelEvent. Il touchpad manda pochi pixel alla volta: il resto si accumula. */
  function createWheelAccumulator() {
    let rest = 0;
    return function lines(e, rowPx, rows) {
      const unit = e.deltaMode === 1 ? 1 : e.deltaMode === 2 ? Math.max(1, rows - 1) : 1 / Math.max(1, rowPx);
      rest -= e.deltaY * unit;
      const n = Math.trunc(rest);
      rest -= n;
      return n;
    };
  }

  /** Senza tmux: la history è lo scrollback di xterm. */
  function xtermBackend(term) {
    const state = () => {
      const b = term.buffer.active;
      const position = b.baseY - b.viewportY;
      return { history: b.baseY, position, rows: term.rows, inMode: position > 0, alternate: b.type === 'alternate' };
    };
    return {
      state: async () => state(),
      scroll: async (n) => { term.scrollLines(-n); return state(); },
      scrollTo: async (n) => { term.scrollToLine(term.buffer.active.baseY - n); return state(); },
      isAlternate: () => term.buffer.active.type === 'alternate',
    };
  }

  /**
   * Barra dentro `host` e rotella di `term`.
   * @param {{ term: object, host: HTMLElement, backend: () => object,
   *   rowHeight: () => number, sendKeys: (data: string) => void,
   *   isVisible?: () => boolean, doc?: Document }} opts
   */
  function attach({ term, host, backend, rowHeight, sendKeys, isVisible = () => true, doc = document }) {
    const bar = doc.createElement('div');
    bar.className = 'term-scroll is-empty';
    bar.setAttribute('aria-hidden', 'true');
    const thumb = doc.createElement('div');
    thumb.className = 'term-scroll-thumb';
    bar.appendChild(thumb);
    host.appendChild(bar);

    const wheelLines = createWheelAccumulator();
    let state = null;
    let geometry = thumbGeometry(null);
    let pending = { lines: 0, target: null };
    let inflight = false;
    let drag = null;
    let outputTimer = null;

    const trackPx = () => bar.getBoundingClientRect().height;

    function render() {
      geometry = thumbGeometry(state && { ...state, track: trackPx() });
      bar.classList.toggle('is-empty', !geometry.scrollable);
      bar.classList.toggle('is-scrolled', Boolean(state && state.position > 0));
      thumb.style.height = geometry.size + 'px';
      thumb.style.transform = 'translateY(' + geometry.offset + 'px)';
    }

    function apply(next) {
      if (!next) return;
      state = next;
      render();
    }

    /** Una richiesta alla volta: gli scatti arrivati nel frattempo partono insieme, il salto più recente vince. */
    function pump() {
      if (inflight) return;
      let op = null;
      if (pending.target !== null) op = backend().scrollTo(pending.target);
      else if (pending.lines) op = backend().scroll(pending.lines);
      if (!op) return;
      pending = { lines: 0, target: null };
      inflight = true;
      Promise.resolve(op).then(apply, () => {}).then(() => { inflight = false; pump(); });
    }

    function scrollBy(lines) {
      if (!lines) return;
      pending = { ...pending, lines: pending.lines + lines };
      pump();
    }

    function scrollTo(fromBottom) {
      pending = { lines: 0, target: fromBottom };
      // La barra si sposta subito sotto il dito: tmux conferma dopo.
      if (state) apply({ ...state, position: fromBottom });
      pump();
    }

    function isAlternate() {
      const b = backend();
      return b.isAlternate ? b.isAlternate() : Boolean(state && state.alternate);
    }

    term.attachCustomWheelEventHandler((e) => {
      // La TUI ha chiesto il mouse (menu, liste): la rotella è sua.
      if (term.modes.mouseTrackingMode !== 'none') return true;
      if (e.preventDefault) e.preventDefault();
      const lines = wheelLines(e, rowHeight(), term.rows);
      if (!lines) return false;
      if (isAlternate()) {
        // less, vim, man: niente history, xterm manderebbe le frecce. Idem qui.
        const key = term.modes.applicationCursorKeysMode ? (lines > 0 ? '\x1bOA' : '\x1bOB') : (lines > 0 ? '\x1b[A' : '\x1b[B');
        sendKeys(key.repeat(Math.abs(lines)));
        return false;
      }
      scrollBy(lines);
      return false;
    });

    function dragTo(clientY) {
      const top = bar.getBoundingClientRect().top;
      scrollTo(fromBottomAt({ thumbTop: clientY - top - drag.grab, track: trackPx(), size: geometry.size, history: state.history }));
    }

    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !state || !geometry.scrollable) return;
      if (e.preventDefault) e.preventDefault();
      const y = e.clientY - bar.getBoundingClientRect().top;
      const onThumb = y >= geometry.offset && y <= geometry.offset + geometry.size;
      // Sul cursore lo si prende dov'è; sulla barra il cursore salta lì, centrato, e si continua a trascinare.
      drag = { id: e.pointerId, grab: onThumb ? y - geometry.offset : geometry.size / 2 };
      if (bar.setPointerCapture) { try { bar.setPointerCapture(e.pointerId); } catch {} }
      bar.classList.add('is-dragging');
      if (!onThumb) dragTo(e.clientY);
    });
    bar.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.id) dragTo(e.clientY);
    });
    const endDrag = () => { drag = null; bar.classList.remove('is-dragging'); };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    function refresh() {
      return Promise.resolve(backend().state()).then(apply, () => {});
    }

    /** È arrivato output: la history cresce, la barra va riletta (non troppo spesso, e solo se si vede). */
    function noteOutput() {
      if (outputTimer || !isVisible()) return;
      outputTimer = setTimeout(() => { outputTimer = null; if (!drag) refresh(); }, OUTPUT_REFRESH_MS);
    }

    return { refresh, noteOutput, render, scrollBy, scrollTo };
  }

  return { MIN_THUMB, thumbGeometry, fromBottomAt, createWheelAccumulator, xtermBackend, attach };
});
