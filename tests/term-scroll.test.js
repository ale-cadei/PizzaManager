// renderer/term-scroll.js: rotella e barra laterale dei terminali.
// Geometria pura più il controller su un DOM e un terminale finti.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const S = require('../renderer/term-scroll');
const { createElement, fire } = require('./fake-dom');

ok('thumbGeometry: in fondo il cursore sta in basso, in cima in alto', () => {
  const bottom = S.thumbGeometry({ history: 76, position: 0, rows: 24, track: 400 });
  assert.deepStrictEqual(bottom, { scrollable: true, size: 96, offset: 304 });
  const top = S.thumbGeometry({ history: 76, position: 76, rows: 24, track: 400 });
  assert.strictEqual(top.offset, 0);
  const middle = S.thumbGeometry({ history: 76, position: 38, rows: 24, track: 400 });
  assert.strictEqual(middle.offset, 152);
});

ok('thumbGeometry: history enorme, il cursore non scende sotto la misura minima', () => {
  const g = S.thumbGeometry({ history: 50000, position: 0, rows: 24, track: 400 });
  assert.strictEqual(g.size, S.MIN_THUMB);
  assert.strictEqual(g.offset, 400 - S.MIN_THUMB);
});

ok('thumbGeometry: niente history, niente da scorrere', () => {
  assert.strictEqual(S.thumbGeometry({ history: 0, position: 0, rows: 24, track: 400 }).scrollable, false);
  assert.strictEqual(S.thumbGeometry(null).scrollable, false);
});

ok('fromBottomAt: è l inverso di thumbGeometry, e resta nei limiti', () => {
  const state = { history: 76, rows: 24, track: 400 };
  for (const position of [0, 10, 38, 76]) {
    const g = S.thumbGeometry({ ...state, position });
    assert.strictEqual(S.fromBottomAt({ ...state, thumbTop: g.offset, size: g.size }), position);
  }
  assert.strictEqual(S.fromBottomAt({ ...state, thumbTop: -50, size: 96 }), 76);
  assert.strictEqual(S.fromBottomAt({ ...state, thumbTop: 999, size: 96 }), 0);
});

ok('wheel: i pixel si accumulano in righe, il resto non si perde', () => {
  const acc = S.createWheelAccumulator();
  assert.strictEqual(acc({ deltaY: -10, deltaMode: 0 }, 20, 24), 0, 'mezza riga: ancora niente');
  assert.strictEqual(acc({ deltaY: -10, deltaMode: 0 }, 20, 24), 1, 'la seconda metà completa la riga, verso l alto');
  assert.strictEqual(acc({ deltaY: 60, deltaMode: 0 }, 20, 24), -3);
  assert.strictEqual(acc({ deltaY: 2, deltaMode: 1 }, 20, 24), -2, 'deltaMode 1: già in righe');
  assert.strictEqual(acc({ deltaY: -1, deltaMode: 2 }, 20, 24), 23, 'deltaMode 2: pagine');
});

function setup({ backendState = { history: 76, position: 0, rows: 24, inMode: false, alternate: false }, mouse = 'none' } = {}) {
  const calls = [];
  let wheel = null;
  const typed = [];
  const wheels = [];
  const term = {
    rows: 24,
    modes: { mouseTrackingMode: mouse, applicationCursorKeysMode: false },
    attachCustomWheelEventHandler: (fn) => { wheel = fn; },
  };
  let state = { ...backendState };
  const backend = {
    scroll: async (n) => { calls.push(['scroll', n]); state = { ...state, position: Math.max(0, state.position + n) }; return state; },
    scrollTo: async (n) => { calls.push(['scrollTo', n]); state = { ...state, position: n }; return state; },
    state: async () => { calls.push(['state']); return state; },
  };
  const host = createElement('div');
  // Come xterm: lo scatto generato passa anche dal gestore della rotella, che non deve contarlo due volte.
  const sendWheel = (up) => { wheels.push(up ? 'su' : 'giù'); wheel({ deltaY: up ? -1 : 1, deltaMode: 1, preventDefault() {} }); };
  const ctl = S.attach({ term, host, backend: () => backend, rowHeight: () => 20, sendKeys: (d) => typed.push(d), doc: { createElement }, sendWheel });
  const bar = host.children.find((c) => c.classes.has('term-scroll'));
  bar.rect = { top: 0, left: 0, width: 8, height: 400 };
  const setState = (next) => { state = { ...state, ...next }; };
  return { ctl, bar, thumb: bar.children[0], calls, typed, wheels, setState, wheel: (e) => wheel({ preventDefault() { this.prevented = true; }, ...e }) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

ok('attach: la rotella scorre la history e ferma lo scorrimento nativo', async () => {
  const s = setup();
  await s.ctl.refresh();
  const ev = { deltaY: -60, deltaMode: 0 };
  assert.strictEqual(s.wheel(ev), false, 'xterm non deve scorrere per conto suo');
  await flush();
  assert.deepStrictEqual(s.calls.filter((c) => c[0] === 'scroll'), [['scroll', 3]]);
  assert.strictEqual(s.thumb.style.transform, 'translateY(' + (304 - 12) + 'px)', 'il cursore segue la posizione');
});

ok('attach: con la TUI che chiede il mouse la rotella resta sua', async () => {
  const s = setup({ mouse: 'any' });
  assert.strictEqual(s.wheel({ deltaY: -60, deltaMode: 0 }), true);
  await flush();
  assert.strictEqual(s.calls.filter((c) => c[0] === 'scroll').length, 0);
});

ok('attach: nell alternate screen (less, vim) la rotella manda frecce, come xterm', async () => {
  const s = setup({ backendState: { history: 0, position: 0, rows: 24, inMode: false, alternate: true } });
  await s.ctl.refresh();
  s.wheel({ deltaY: -40, deltaMode: 0 });
  s.wheel({ deltaY: 20, deltaMode: 0 });
  assert.deepStrictEqual(s.typed, ['\x1b[A\x1b[A', '\x1b[B']);
});

ok('attach: scatti rapidi mentre una richiesta è in volo si sommano in una sola', async () => {
  const s = setup();
  s.wheel({ deltaY: -20, deltaMode: 0 });
  s.wheel({ deltaY: -20, deltaMode: 0 });
  s.wheel({ deltaY: -20, deltaMode: 0 });
  await flush(); await flush();
  assert.deepStrictEqual(s.calls.filter((c) => c[0] === 'scroll'), [['scroll', 1], ['scroll', 2]]);
});

ok('attach: un click sulla barra porta lì la vista, il trascinamento la segue', async () => {
  const s = setup();
  await s.ctl.refresh();
  fire(s.bar, 'pointerdown', { clientY: 48, button: 0, pointerId: 1, target: s.bar });
  await flush();
  assert.deepStrictEqual(s.calls.filter((c) => c[0] === 'scrollTo').at(-1), ['scrollTo', 76], 'click in cima: tutta la history');
  fire(s.bar, 'pointermove', { clientY: 400, pointerId: 1 });
  await flush();
  assert.deepStrictEqual(s.calls.filter((c) => c[0] === 'scrollTo').at(-1), ['scrollTo', 0]);
  fire(s.bar, 'pointerup', { pointerId: 1 });
  fire(s.bar, 'pointermove', { clientY: 0, pointerId: 1 });
  await flush();
  assert.deepStrictEqual(s.calls.filter((c) => c[0] === 'scrollTo').at(-1), ['scrollTo', 0], 'rilasciato: non trascina più');
});

ok('attach: senza history la barra si dichiara vuota', async () => {
  const s = setup({ backendState: { history: 0, position: 0, rows: 24, inMode: false, alternate: false } });
  await s.ctl.refresh();
  assert.ok(s.bar.classes.has('is-empty'));
});

ok('xtermBackend: senza tmux la history è quella di xterm', async () => {
  const scrolled = [];
  const term = {
    rows: 24,
    buffer: { active: { type: 'normal', baseY: 100, viewportY: 90 } },
    scrollLines: (n) => scrolled.push(['lines', n]),
    scrollToLine: (n) => scrolled.push(['line', n]),
  };
  const b = S.xtermBackend(term);
  assert.deepStrictEqual(await b.state(), { history: 100, position: 10, rows: 24, inMode: true, alternate: false });
  await b.scroll(3);
  await b.scrollTo(40);
  assert.deepStrictEqual(scrolled, [['lines', -3], ['line', 60]]);
});

const TUI = { backendState: { history: 0, position: 0, rows: 24, inMode: false, alternate: true }, mouse: 'any' };

ok('schermo intero col mouse: la rotella resta al programma, la barra stima dagli scatti', async () => {
  const s = setup(TUI);
  await s.ctl.refresh();
  assert.ok(!s.bar.classes.has('is-empty'), 'la barra si vede anche senza history di tmux');
  assert.strictEqual(s.thumb.style.transform, 'translateY(' + (400 - s.thumb.style.height.replace('px', '')) + 'px)', 'in fondo');
  assert.strictEqual(s.wheel({ deltaY: -60, deltaMode: 0 }), true, 'xterm manda lo scatto al programma');
  s.wheel({ deltaY: -60, deltaMode: 0 });
  s.wheel({ deltaY: -5, deltaMode: 0 });
  assert.ok(s.bar.classes.has('is-scrolled'), 'salito: la barra si accende');
  assert.strictEqual(s.calls.filter((c) => c[0] === 'scroll').length, 0, 'tmux non c entra');
  s.wheel({ deltaY: 60, deltaMode: 0 });
  s.wheel({ deltaY: 60, deltaMode: 0 });
  s.wheel({ deltaY: 60, deltaMode: 0 });
  assert.ok(!s.bar.classes.has('is-scrolled'), 'sotto il fondo non si scende');
});

ok('schermo intero: click e trascinamento mandano scatti veri, contati una volta sola', async () => {
  const s = setup(TUI);
  await s.ctl.refresh();
  fire(s.bar, 'pointerdown', { clientY: 0, button: 0, pointerId: 1, target: s.bar });
  // 24 righe / 3 per scatto = 8 scatti a schermata, history supposta 3 schermate
  assert.strictEqual(s.wheels.length, 24);
  assert.ok(s.wheels.every((w) => w === 'su'));
  assert.strictEqual(s.thumb.style.transform, 'translateY(0px)', 'durante il trascinamento la lunghezza non cresce');
  fire(s.bar, 'pointermove', { clientY: 400, pointerId: 1 });
  assert.strictEqual(s.wheels.filter((w) => w === 'giù').length, 24, 'di nuovo in fondo');
  fire(s.bar, 'pointerup', { pointerId: 1 });
  assert.ok(!s.bar.classes.has('is-scrolled'));
});

ok('schermo intero: scrivere riporta la stima in fondo, uscire dal programma la azzera', async () => {
  const s = setup(TUI);
  await s.ctl.refresh();
  s.ctl.scrollBy(5);
  assert.deepStrictEqual(s.wheels, ['su', 'su', 'su', 'su', 'su']);
  assert.ok(s.bar.classes.has('is-scrolled'));
  s.ctl.noteTyping();
  assert.ok(!s.bar.classes.has('is-scrolled'));
  s.ctl.scrollBy(3);
  s.setState({ alternate: false, history: 0 });
  await s.ctl.refresh();
  assert.ok(!s.bar.classes.has('is-scrolled'));
  assert.ok(s.bar.classes.has('is-empty'), 'shell senza history: niente barra');
});
