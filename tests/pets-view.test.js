// renderer/pets-view.js: la striscia nel DOM, il ciclo di animazione e la pausa
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createPetsView } = require('../renderer/pets-view');
const { createElement, descendants } = require('./fake-dom');

function setup({ reduced = false, reducedMotion = () => reduced, signals = { running: false, attention: false } } = {}) {
  const docListeners = {};
  const winListeners = {};
  const doc = {
    hidden: false,
    createElement,
    createElementNS: (_ns, tag) => createElement(tag),
    addEventListener: (ev, fn) => { docListeners[ev] = fn; },
    hasFocus: () => true,
  };
  const observed = [];
  const win = {
    addEventListener: (ev, fn) => { winListeners[ev] = fn; },
    ResizeObserver: class { constructor(fn) { this.fn = fn; } observe(el) { observed.push({ el, fn: this.fn }); } },
  };
  const strip = createElement('div');
  strip.clientWidth = 800;
  let t = 0;
  const frames = [];
  const cancelled = [];
  const current = { ...signals };
  const view = createPetsView({
    doc, win, strip,
    signals: () => current,
    now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; },
    caf: (id) => cancelled.push(id),
    reducedMotion,
    random: () => 0.3,
  });
  /** Fa girare il prossimo frame dopo `ms` millisecondi. */
  const tick = (ms = 16) => { t += ms; const fn = frames.shift(); if (fn) fn(); };
  /** Il ResizeObserver avvisa che la striscia ha cambiato misura. */
  const resize = () => observed.filter((o) => o.el === strip).forEach((o) => o.fn([]));
  return { view, strip, doc, docListeners, winListeners, frames, cancelled, tick, current, resize };
}

const ON = { enabled: true, cast: ['inseguimento', 'gary'], size: 'm', speed: 'normale' };
const visibleFrames = (petEl) => descendants(petEl).filter((n) => n.tag === 'g' && n.getAttribute('display') !== 'none');
const classOf = (el) => el.getAttribute('class') || '';

ok('pets-view: accesi → un elemento per personaggio, striscia visibile, ciclo avviato', () => {
  const { view, strip, frames } = setup();
  view.apply(ON);
  assert.strictEqual(strip.hidden, false);
  assert.strictEqual(strip.children.length, 3);
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(view.isRunning(), true);
  for (const el of strip.children) assert.strictEqual(visibleFrames(el).length, 1, 'un solo frame acceso per personaggio');
  assert.ok(strip.children.every((el) => descendants(el).some((n) => n.tag === 'rect')), 'disegno vuoto');
});

ok('pets-view: spenti → striscia nascosta e vuota, ciclo fermo', () => {
  const { view, strip, cancelled } = setup();
  view.apply(ON);
  view.apply({ ...ON, enabled: false });
  assert.strictEqual(strip.hidden, true);
  assert.strictEqual(strip.children.length, 0);
  assert.strictEqual(view.isRunning(), false);
  assert.strictEqual(cancelled.length, 1);
});

ok('pets-view: un cast vuoto è come spenti', () => {
  const { view, strip, frames } = setup();
  view.apply({ ...ON, cast: [] });
  assert.strictEqual(strip.hidden, true);
  assert.strictEqual(frames.length, 0);
});

ok('pets-view: finestra senza fuoco o nascosta → fermi; tornata → ripartono', () => {
  const { view, doc, docListeners, winListeners } = setup();
  view.apply(ON);
  winListeners.blur();
  assert.strictEqual(view.isRunning(), false);
  winListeners.focus();
  assert.strictEqual(view.isRunning(), true);
  doc.hidden = true;
  docListeners.visibilitychange();
  assert.strictEqual(view.isRunning(), false);
  // Il fuoco da solo non basta se la finestra è ancora nascosta
  winListeners.focus();
  assert.strictEqual(view.isRunning(), false);
  doc.hidden = false;
  docListeners.visibilitychange();
  assert.strictEqual(view.isRunning(), true);
});

ok('pets-view: con meno movimento richiesto li disegna ma non li anima', () => {
  const { view, strip, frames } = setup({ reduced: true });
  view.apply(ON);
  assert.strictEqual(strip.children.length, 3);
  assert.strictEqual(frames.length, 0);
  assert.strictEqual(view.isRunning(), false);
});

ok('pets-view: la striscia si stringe a ciclo fermo → rientrano lo stesso', () => {
  const { view, strip, resize } = setup({ reduced: true });
  view.apply(ON);
  strip.clientWidth = 60;
  resize();
  for (const el of strip.children) {
    const x = Number(/translate\(([-\d.]+)px/.exec(el.style.transform)[1]);
    assert.ok(x + Number(el.children[0].getAttribute('width')) <= 60 + 0.1, `fuori: ${el.style.transform}`);
  }
});

ok('pets-view: refresh riavvia il ciclo quando la richiesta di meno movimento cade', () => {
  const s = { reduced: true };
  const { view } = setup({ reducedMotion: () => s.reduced });
  view.apply(ON);
  assert.strictEqual(view.isRunning(), false);
  s.reduced = false;
  view.refresh();
  assert.strictEqual(view.isRunning(), true);
  s.reduced = true;
  view.refresh();
  assert.strictEqual(view.isRunning(), false);
});

ok('pets-view: a ogni frame si muovono e il ciclo continua', () => {
  const { view, strip, frames, tick } = setup({ signals: { running: true, attention: false } });
  view.apply(ON);
  const before = strip.children.map((el) => el.style.transform);
  tick(50);
  tick(50);
  assert.strictEqual(frames.length, 1, 'il ciclo non si è riprenotato');
  const after = strip.children.map((el) => el.style.transform);
  assert.notDeepStrictEqual(after, before);
});

ok('pets-view: una sessione che aspetta fa chiamare qualcuno', () => {
  const { view, strip, tick } = setup({ signals: { running: false, attention: true } });
  view.apply(ON);
  tick(16);
  assert.strictEqual(strip.children.filter((el) => classOf(el).includes('pet--call')).length, 1);
});

ok('pets-view: chi va a sinistra ha la classe che lo specchia', () => {
  const { view, strip, tick } = setup();
  view.apply({ ...ON, cast: ['gatto'] });
  for (let i = 0; i < 400; i += 1) tick(50);
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) { tick(50); seen.add(classOf(strip.children[0]).includes('pet--left')); }
  assert.deepStrictEqual([...seen].sort(), [false, true], 'il gatto non ha mai cambiato verso');
});
