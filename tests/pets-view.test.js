// renderer/pets-view.js: la striscia nel DOM, il ciclo di animazione e la pausa
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createPetsView } = require('../renderer/pets-view');
const { createElement, descendants } = require('./fake-dom');

function setup({ reduced = false, reducedMotion = () => reduced, signals = { running: false, attention: false }, random = () => 0.3 } = {}) {
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
    random,
  });
  /** Fa girare il prossimo frame dopo `ms` millisecondi. */
  const tick = (ms = 16) => { t += ms; const fn = frames.shift(); if (fn) fn(); };
  /** Il ResizeObserver avvisa che la striscia ha cambiato misura. */
  const resize = () => observed.filter((o) => o.el === strip).forEach((o) => o.fn([]));
  return { view, strip, doc, docListeners, winListeners, frames, cancelled, tick, current, resize };
}

const ON = { enabled: true, cast: ['inseguimento', 'lumaca'], size: 'm', speed: 'normale' };
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

ok('pets-view: cambiare cast a striscia accesa tiene in scena chi resta e aggiunge chi entra', () => {
  const { view, strip, tick } = setup();
  view.apply({ ...ON, cast: ['gatto', 'pizza'] });
  for (let i = 0; i < 20; i += 1) tick(50);
  const [cat, pizza] = strip.children;
  view.apply({ ...ON, cast: ['gatto', 'zucca'] });
  assert.strictEqual(strip.children.length, 2);
  assert.strictEqual(strip.children[0], cat, 'il gatto è stato ricostruito');
  assert.strictEqual(strip.children[0].style.transform, cat.style.transform, 'il gatto è stato spostato');
  assert.ok(!strip.children.includes(pizza), 'la pizza, che non sa svanire, è ancora lì');
  assert.ok(classOf(strip.children[1]).includes('pet--zucca'));
  assert.strictEqual(view.isRunning(), true);
});

ok('pets-view: chi esce dal cast svanisce e il suo elemento sparisce alla fine', () => {
  const { view, strip, tick } = setup();
  view.apply({ ...ON, cast: ['fantasmino', 'gatto'] });
  for (let i = 0; i < 40; i += 1) tick(50);
  const ghost = strip.children.find((el) => classOf(el).includes('pet--fantasmino'));
  view.apply({ ...ON, cast: ['gatto'] });
  assert.ok(strip.children.includes(ghost), 'sparito senza svanire');
  assert.ok(classOf(ghost).includes('pet--vanish'));
  for (let i = 0; i < 30; i += 1) tick(50);
  assert.ok(!strip.children.includes(ghost), 'svanito ma ancora nel DOM');
  assert.strictEqual(strip.children.filter((el) => classOf(el).startsWith('pet ')).length, 1);
  assert.strictEqual(strip.children.filter((el) => classOf(el) === 'pet-shadow').length, 0, 'l\'ombra è rimasta');
});

ok('pets-view: con meno movimento chi esce dal cast sparisce subito, senza restare a metà svanimento', () => {
  const { view, strip } = setup({ reduced: true });
  view.apply({ ...ON, cast: ['fantasmino', 'gatto'] });
  assert.strictEqual(strip.children.length, 3);
  view.apply({ ...ON, cast: ['gatto'] });
  assert.strictEqual(strip.children.length, 1);
  assert.ok(classOf(strip.children[0]).includes('pet--gatto'));
  assert.strictEqual(view.isRunning(), false);
});

ok('pets-view: un altra misura ricostruisce tutto da capo', () => {
  const { view, strip } = setup();
  view.apply({ ...ON, cast: ['gatto'] });
  const [cat] = strip.children;
  view.apply({ ...ON, cast: ['gatto'], size: 'l' });
  assert.notStrictEqual(strip.children[0], cat);
  assert.strictEqual(strip.style.height, '48px');
});

ok('pets-view: il fantasmino ha un ombra a terra, sotto di lui, che sparisce quando si posa', () => {
  const { view, strip, tick, current } = setup();
  view.apply({ ...ON, cast: ['fantasmino'] });
  assert.strictEqual(strip.children.length, 2);
  const [shadow, ghost] = strip.children;
  assert.strictEqual(classOf(shadow), 'pet-shadow');
  assert.ok(classOf(ghost).includes('pet--fantasmino'));
  assert.strictEqual(shadow.hidden, true, 'ombra a terra prima di alzarsi in volo');
  for (let i = 0; i < 40; i += 1) tick(50);
  assert.strictEqual(shadow.hidden, false);
  assert.strictEqual(visibleFrames(shadow).length, 1);
  const ghostX = Number(/translate\(([-\d.]+)px/.exec(ghost.style.transform)[1]);
  const shadowX = Number(/translate\(([-\d.]+)px/.exec(shadow.style.transform)[1]);
  const half = (w) => Number(w.children[0].getAttribute('width')) / 2;
  assert.ok(Math.abs((shadowX + half(shadow)) - (ghostX + half(ghost))) < 0.2, 'ombra non centrata');
  assert.ok(/, 0px\)$/.test(shadow.style.transform), 'l\'ombra si è alzata da terra');
  current.attention = true;
  tick(50);
  assert.strictEqual(shadow.hidden, true, 'posato a chiamare, l\'ombra resta');
});

ok('pets-view: chi va a sinistra ha la classe che lo specchia', () => {
  const { view, strip, tick } = setup();
  view.apply({ ...ON, cast: ['gatto'] });
  for (let i = 0; i < 400; i += 1) tick(50);
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) { tick(50); seen.add(classOf(strip.children[0]).includes('pet--left')); }
  assert.deepStrictEqual([...seen].sort(), [false, true], 'il gatto non ha mai cambiato verso');
});

ok('pets-view: due pesci con aspetto diverso hanno colori diversi nel disegno', () => {
  const fills = (el) => new Set(descendants(el).filter((n) => n.tag === 'rect').map((n) => n.getAttribute('fill')));
  const draw = (random) => {
    const { view, strip } = setup({ random });
    view.apply({ ...ON, cast: ['pesce'] });
    return strip.children.find((el) => classOf(el).includes('pet--pesce'));
  };
  const a = draw(() => 0.3);
  const b = draw(() => 0.9);
  assert.notDeepStrictEqual([...fills(a)].sort(), [...fills(b)].sort());
});

const xOf = (el) => Number(/translate\(([-\d.]+)px/.exec(el.style.transform)[1]);
const widthOf = (el) => Number(el.children[0].getAttribute('width'));

ok('pets-view: il fiore dell ape sta a terra, sotto di lei, anche mentre vola', () => {
  const { view, strip, tick } = setup();
  view.apply({ ...ON, cast: ['ape'] });
  const [flower, bee] = strip.children;
  assert.strictEqual(classOf(flower), 'pet-perch');
  assert.ok(classOf(bee).includes('pet--ape'));
  for (let i = 0; i < 20; i += 1) tick(50);
  assert.strictEqual(flower.hidden, false);
  assert.strictEqual(visibleFrames(flower).length, 1);
  assert.ok(/, 0px\)$/.test(flower.style.transform), 'il fiore si è alzato da terra');
  view.apply({ ...ON, cast: ['gatto'] });
  for (let i = 0; i < 30; i += 1) tick(50);
  assert.strictEqual(strip.children.filter((el) => classOf(el) === 'pet-perch').length, 0, 'il fiore è rimasto');
});

ok('pets-view: le bolle del pesce escono davanti alla bocca solo quando chiama', () => {
  const { view, strip, tick, current } = setup();
  view.apply({ ...ON, cast: ['pesce'] });
  const fish = strip.children.find((el) => classOf(el).includes('pet--pesce'));
  const bubbles = strip.children.find((el) => classOf(el).startsWith('pet-bubbles'));
  assert.ok(bubbles, 'niente bolle');
  for (let i = 0; i < 20; i += 1) tick(50);
  assert.strictEqual(bubbles.hidden, true, 'bolle mentre nuota');
  current.attention = true;
  tick(50);
  assert.ok(classOf(fish).includes('pet--call'));
  assert.strictEqual(bubbles.hidden, false);
  assert.strictEqual(visibleFrames(bubbles).length, 1);
  const left = classOf(fish).includes('pet--left');
  assert.strictEqual(classOf(bubbles).includes('pet-bubbles--left'), left, 'bolle girate dall altra parte');
  const expected = left ? xOf(fish) - widthOf(bubbles) : xOf(fish) + widthOf(fish);
  assert.ok(Math.abs(xOf(bubbles) - expected) < 0.2, `bolle lontane dalla bocca: ${xOf(bubbles)} invece di ${expected}`);
  assert.strictEqual(bubbles.style.transform.split(',')[1], fish.style.transform.split(',')[1], 'bolle a un altra quota');
  const seen = new Set();
  for (let i = 0; i < 20; i += 1) { tick(50); seen.add(visibleFrames(bubbles)[0]); }
  assert.ok(seen.size > 1, 'bolle ferme');
});

ok('pets-view: il pesce al bordo si gira per chiamare, e le bolle restano nella striscia davanti alla bocca', () => {
  for (const random of [() => 0, () => 0.99]) {
    const { view, strip, tick, current } = setup({ random });
    view.apply({ ...ON, cast: ['pesce'] });
    const fish = strip.children.find((el) => classOf(el).includes('pet--pesce'));
    const bubbles = strip.children.find((el) => classOf(el).startsWith('pet-bubbles'));
    current.attention = true;
    for (let i = 0; i < 5; i += 1) tick(16);
    const x = xOf(bubbles);
    assert.ok(x >= 0 && x + widthOf(bubbles) <= strip.clientWidth, `bolle fuori: ${x}`);
    const left = classOf(fish).includes('pet--left');
    const mouth = left ? xOf(fish) - widthOf(bubbles) : xOf(fish) + widthOf(fish);
    assert.ok(Math.abs(x - mouth) < 0.2, 'bolle lontane dalla bocca');
  }
});
