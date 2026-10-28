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
 * I programmi a schermo intero che chiedono il mouse (claude, opencode) hanno
 * una history loro, che da fuori non si vede: tmux ne ha zero righe. Lì la
 * rotella va al programma e la barra STIMA la posizione contando gli scatti
 * mandati — esatta in fondo, indicativa salendo, perché non si sa dove finisce
 * il testo. Click e trascinamento mandano scatti veri, generati come eventi
 * rotella sull'elemento di xterm: la codifica (SGR, X10) resta affar suo.
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
  // Stima per i programmi a schermo intero: righe mosse da uno scatto di
  // rotella (claude e opencode ne fanno circa 3) e history minima supposta,
  // in schermate, finché gli scatti non dicono che ce n'è di più.
  const LINES_PER_TICK = 3;
  const VIRTUAL_MIN_SCREENS = 3;
  // Un salto dalla barra non manda più di tanti scatti in una volta.
  const MAX_TICKS_PER_MOVE = 200;
  // Dopo scatti verso l'alto, quanto aspettare il ridisegno del programma:
  // se non arriva, non è salito, e la cima è lì (docs/plans/52).
  const SETTLE_MS = 300;

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
   *   isVisible?: () => boolean, doc?: Document,
   *   sendWheel?: (up: boolean) => void, settleMs?: number }} opts
   */
  function attach({ term, host, backend, rowHeight, sendKeys, isVisible = () => true, doc = document, sendWheel = null, settleMs = SETTLE_MS }) {
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
    // Posizione stimata nei programmi a schermo intero, in scatti sopra il
    // fondo; `reach` è il più in alto a cui si è arrivati, e con `top` è
    // proprio la cima (un salto oltre non ha fatto ridisegnare niente).
    let virtual = { offset: 0, reach: 0, top: false };
    let synthesizing = false;
    // Scatti verso l'alto in attesa di conferma, e l'ultimo output arrivato.
    let upBatch = null;
    let settleTimer = null;
    let lastOutputAt = 0;

    const trackPx = () => bar.getBoundingClientRect().height;

    function isVirtual() {
      return term.modes.mouseTrackingMode !== 'none' && isAlternate();
    }

    function virtualState() {
      const rows = Math.max(1, Math.round(term.rows / LINES_PER_TICK));
      // Durante il trascinamento la lunghezza resta ferma: crescerebbe sotto il
      // dito a ogni movimento verso l'alto e il cursore scapperebbe. Con la
      // cima nota, la lunghezza è quella: il cursore ci arriva e lì si ferma.
      const history = drag && drag.history ? drag.history
        : virtual.top ? virtual.reach : Math.max(rows * VIRTUAL_MIN_SCREENS, virtual.reach + rows);
      return { history, position: Math.min(virtual.offset, history), rows, inMode: virtual.offset > 0, alternate: true };
    }

    /** Lo stato che la barra disegna: quello vero, o la stima. */
    function view() {
      return isVirtual() ? virtualState() : state;
    }

    function render() {
      const v = view();
      geometry = thumbGeometry(v && { ...v, track: trackPx() });
      bar.classList.toggle('is-empty', !geometry.scrollable);
      bar.classList.toggle('is-scrolled', Boolean(v && v.position > 0));
      thumb.style.height = geometry.size + 'px';
      thumb.style.transform = 'translateY(' + geometry.offset + 'px)';
    }

    function apply(next) {
      if (!next) return;
      state = next;
      // Il programma a schermo intero è uscito: la stima non vale più.
      if (!next.alternate) virtual = { offset: 0, reach: 0, top: false };
      render();
    }

    function moveVirtual(ticks) {
      const offset = Math.max(0, virtual.offset + ticks);
      virtual = { offset, reach: Math.max(virtual.reach, offset), top: virtual.top && offset <= virtual.reach };
      render();
    }

    /** Scatti verso l'alto appena mandati: si aspetta il ridisegno che dice se il programma è salito. */
    function expectScroll(ticks) {
      if (!(ticks > 0)) return;
      if (!upBatch) upBatch = { ticks: 0, since: Date.now() };
      upBatch.ticks += ticks;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, settleMs);
    }

    function settle() {
      const batch = upBatch;
      upBatch = null;
      settleTimer = null;
      if (!batch || lastOutputAt >= batch.since) return;
      // Nessun ridisegno dopo quegli scatti: il programma non è salito, la cima è qui.
      const offset = Math.max(0, virtual.offset - batch.ticks);
      virtual = { offset, reach: offset, top: true };
      render();
    }

    /** Uno scatto di rotella finto sul terminale: xterm lo codifica per il programma come uno vero. */
    function dispatchWheel(up) {
      const el = term.element;
      const win = doc.defaultView;
      if (!el || !win || !win.WheelEvent) return;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new win.WheelEvent('wheel', {
        deltaY: up ? -1 : 1, deltaMode: 1, bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }

    function sendTicks(n) {
      const count = Math.min(Math.abs(n), MAX_TICKS_PER_MOVE);
      if (!count) return;
      const send = sendWheel || dispatchWheel;
      synthesizing = true;
      try {
        for (let i = 0; i < count; i++) send(n > 0);
      } finally {
        synthesizing = false;
      }
      moveVirtual(n > 0 ? count : -count);
      if (n > 0) expectScroll(count);
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
      if (isVirtual()) { sendTicks(lines); return; }
      pending = { ...pending, lines: pending.lines + lines };
      pump();
    }

    function scrollTo(fromBottom) {
      if (isVirtual()) { sendTicks(fromBottom - virtual.offset); return; }
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
      // La TUI ha chiesto il mouse (menu, liste): la rotella è sua. xterm le
      // manda uno scatto per evento che muove almeno una riga: stessa misura qui.
      if (term.modes.mouseTrackingMode !== 'none') {
        if (synthesizing) return true;
        const lines = wheelLines(e, rowHeight(), term.rows);
        if (lines && isAlternate()) {
          moveVirtual(Math.sign(lines));
          if (lines > 0) expectScroll(1);
        }
        return true;
      }
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
      scrollTo(fromBottomAt({ thumbTop: clientY - top - drag.grab, track: trackPx(), size: geometry.size, history: drag.history }));
    }

    bar.addEventListener('pointerdown', (e) => {
      const v = view();
      if (e.button !== 0 || !v || !geometry.scrollable) return;
      if (e.preventDefault) e.preventDefault();
      const y = e.clientY - bar.getBoundingClientRect().top;
      const onThumb = y >= geometry.offset && y <= geometry.offset + geometry.size;
      // Sul cursore lo si prende dov'è; sulla barra il cursore salta lì, centrato, e si continua a trascinare.
      drag = { id: e.pointerId, grab: onThumb ? y - geometry.offset : geometry.size / 2, history: v.history };
      if (bar.setPointerCapture) { try { bar.setPointerCapture(e.pointerId); } catch {} }
      bar.classList.add('is-dragging');
      if (!onThumb) dragTo(e.clientY);
    });
    bar.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.id) dragTo(e.clientY);
    });
    const endDrag = () => { drag = null; bar.classList.remove('is-dragging'); render(); };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    function refresh() {
      return Promise.resolve(backend().state()).then(apply, () => {});
    }

    /** È arrivato output: la history cresce, la barra va riletta (non troppo spesso, e solo se si vede). */
    function noteOutput() {
      lastOutputAt = Date.now();
      if (outputTimer || !isVisible()) return;
      outputTimer = setTimeout(() => { outputTimer = null; if (!drag) refresh(); }, OUTPUT_REFRESH_MS);
    }

    /** L'utente ha scritto: i programmi a schermo intero tornano in fondo, la stima pure. */
    function noteTyping() {
      // Il testo nuovo che arriva allontana la cima: la si dimentica.
      if (!virtual.offset && !virtual.top) return;
      virtual = { ...virtual, offset: 0, top: false };
      render();
    }

    return { refresh, noteOutput, noteTyping, render, scrollBy, scrollTo };
  }

  return { MIN_THUMB, thumbGeometry, fromBottomAt, createWheelAccumulator, xtermBackend, attach };
});
