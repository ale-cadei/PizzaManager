const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Sidebar, albero dell'editor e pannello delle modifiche si aprono e si
   chiudono animati (docs/plans/80-gruppo-in-cima.md). */
const { createMotion, createPageMotion, widthFrame } = require('../renderer/motion');
const { createElement, createStorage, descendants, fire } = require('./fake-dom');
const { createSidebarCollapse } = require('../renderer/sidebar-collapse');
const EditorPanel = require('../renderer/editor-panel');
const { createChangesView } = require('../renderer/changes-view');

const tick = () => new Promise((r) => setImmediate(r));

/** Elemento con larghezza decisa da chi lo usa e animazioni che si finiscono a mano. */
function animEl(width = 300) {
  const el = {
    width, anims: [],
    getBoundingClientRect: () => ({ width: el.width }),
    animate(frames, timing) {
      let settle;
      const anim = {
        frames, timing, cancelled: false,
        finished: new Promise((res, rej) => { settle = { res, rej }; }),
        finish: () => settle.res(),
        cancel() { if (!anim.cancelled) { anim.cancelled = true; settle.rej(new Error('annullata')); } },
      };
      el.anims.push(anim);
      return anim;
    },
  };
  return el;
}
const lastAnim = (el) => el.anims[el.anims.length - 1];

ok('widthFrame: min e max insieme, contenuto tagliato', () => {
  assert.deepStrictEqual(widthFrame(72.4), { minWidth: '72px', maxWidth: '72px', overflow: 'hidden' });
});

ok('resizeWidth: anima dalla larghezza di prima a quella dopo la classe', async () => {
  const m = createMotion();
  const el = animEl(300);
  const p = m.resizeWidth(el, () => { el.width = 72; });
  const a = lastAnim(el);
  assert.deepStrictEqual([a.frames[0].maxWidth, a.frames[1].maxWidth], ['300px', '72px']);
  a.finish();
  assert.strictEqual(await p, true);
});

ok('resizeWidth: un secondo cambio annulla il primo e riparte da dov è', async () => {
  const m = createMotion();
  const el = animEl(300);
  const first = m.resizeWidth(el, () => { el.width = 72; });
  el.width = 180; // a metà corsa
  m.resizeWidth(el, () => { el.width = 300; });
  assert.strictEqual(el.anims[0].cancelled, true);
  assert.deepStrictEqual([lastAnim(el).frames[0].maxWidth, lastAnim(el).frames[1].maxWidth], ['180px', '300px']);
  assert.strictEqual(await first, false);
});

ok('hideWidth: si stringe a 0 e solo alla fine si nasconde', async () => {
  const m = createMotion();
  const el = animEl(256);
  let hidden = false;
  const p = m.hideWidth(el, () => { hidden = true; });
  assert.strictEqual(hidden, false, 'nascosto prima di stringersi non si vedrebbe niente');
  assert.strictEqual(lastAnim(el).frames[1].maxWidth, '0px');
  lastAnim(el).finish();
  assert.strictEqual(await p, true);
  assert.strictEqual(hidden, true);
});

ok('hideWidth ripreso da showWidth: non si nasconde, riparte dalla larghezza a metà', async () => {
  const m = createMotion();
  const el = animEl(256);
  let hidden = false;
  const hiding = m.hideWidth(el, () => { hidden = true; });
  el.width = 100;
  m.showWidth(el, () => { el.width = 256; });
  assert.strictEqual(await hiding, false);
  assert.strictEqual(hidden, false);
  assert.deepStrictEqual([lastAnim(el).frames[0].maxWidth, lastAnim(el).frames[1].maxWidth], ['100px', '256px']);
});

ok('slideIn e slideOut: dal bordo destro, e fuori si nasconde a fine corsa', async () => {
  const m = createMotion();
  const el = animEl();
  m.slideIn(el);
  assert.strictEqual(lastAnim(el).frames[0].transform, 'translateX(100%)');
  let hidden = false;
  const out = m.slideOut(el, () => { hidden = true; });
  assert.strictEqual(lastAnim(el).frames[1].transform, 'translateX(100%)');
  lastAnim(el).finish();
  await out;
  assert.strictEqual(hidden, true);
});

ok('prefers-reduced-motion o niente animate: tutto subito', async () => {
  const m = createMotion({ reducedMotion: () => true });
  const el = animEl();
  let applied = 0;
  await m.resizeWidth(el, () => { applied++; });
  await m.hideWidth(el, () => { applied++; });
  await m.showWidth(el, () => { applied++; });
  await m.slideOut(el, () => { applied++; });
  assert.strictEqual(applied, 4);
  assert.strictEqual(el.anims.length, 0);
  await createMotion().hideWidth({}, () => { applied++; });
  assert.strictEqual(applied, 5);
});

ok('createPageMotion: uno solo per la pagina', () => {
  const win = { matchMedia: () => ({ matches: false }) };
  assert.strictEqual(createPageMotion(win), createPageMotion(win));
});

/** Un motion finto che registra e finisce subito, per i collegamenti. */
function recordingMotion() {
  const calls = [];
  const rec = (kind) => (el, apply) => { calls.push({ kind, el }); if (apply) apply(); return Promise.resolve(true); };
  return { calls, resizeWidth: rec('resize'), showWidth: rec('show'), hideWidth: rec('hide'), slideIn: rec('in'), slideOut: rec('out') };
}

ok('sidebar compressa: la larghezza cambia passando da motion, e il terminale si rifitta a fine corsa', async () => {
  const motion = recordingMotion();
  const sidebar = createElement('aside');
  const toggle = createElement('button');
  const changes = [];
  createSidebarCollapse({ sidebar, toggle, storage: createStorage(), onChange: (c) => changes.push(c), motion });
  assert.strictEqual(motion.calls.length, 0, 'all avvio niente animazione');
  fire(toggle, 'click');
  assert.deepStrictEqual(motion.calls.map((c) => [c.kind, c.el]), [['resize', sidebar]]);
  assert.ok(sidebar.classes.has('collapsed'));
  await tick();
  assert.deepStrictEqual(changes, [true, true], 'subito e a fine animazione');
});

function editorDoc(sides) {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.body = createElement('body');
  doc.querySelectorAll = (sel) => (sel === '.editor-side' ? sides : []);
  return doc;
}

ok('albero dell editor: si stringe prima di sparire e cresce dopo essere comparso', () => {
  const motion = recordingMotion();
  const side = createElement('div');
  const doc = editorDoc([side]);
  const storage = createStorage();
  const panel = EditorPanel.createPanel({ doc, storage, motion });
  panel.toggle();
  assert.deepStrictEqual(motion.calls.map((c) => c.kind), ['hide']);
  assert.ok(doc.body.classList.contains('editor-tree-hidden'));
  assert.strictEqual(storage.getItem('aisess.editorTreeHidden'), '1');
  panel.toggle();
  assert.deepStrictEqual(motion.calls.map((c) => c.kind), ['hide', 'show']);
  assert.ok(!doc.body.classList.contains('editor-tree-hidden'));
  assert.strictEqual(panel.prefs().hidden, false);
});

ok('albero dell editor: se la chiusura è ripresa, la classe non arriva', () => {
  const side = createElement('div');
  const doc = editorDoc([side]);
  let pendingHide = null;
  const motion = {
    hideWidth: (el, apply) => { pendingHide = apply; return new Promise(() => {}); },
    showWidth: (el, apply) => { pendingHide = null; apply(); return Promise.resolve(true); },
  };
  const panel = EditorPanel.createPanel({ doc, storage: createStorage(), motion });
  panel.toggle();
  assert.ok(!doc.body.classList.contains('editor-tree-hidden'), 'durante la corsa resta nella pagina');
  panel.toggle();
  assert.strictEqual(pendingHide, null);
  assert.ok(!doc.body.classList.contains('editor-tree-hidden'));
});

const changesState = (open) => ({
  label: { visible: true, clean: false, text: '1', parts: [{ kind: 'files', text: '1' }] }, open, title: 't',
  summary: [], error: null, files: [], expanded: {},
});

ok('pannello modifiche: entra da destra, esce e solo alla fine si nasconde', async () => {
  let finishOut = null;
  const calls = [];
  const motion = {
    slideIn: (el) => { calls.push('in'); return Promise.resolve(true); },
    slideOut: (el, apply) => { calls.push('out'); return new Promise((r) => { finishOut = () => { apply(); r(true); }; }); },
  };
  const host = createElement('div');
  const view = createChangesView({ doc: { createElement }, host, shortcut: 'x', onToggle() {}, onClose() {}, onFile() {}, motion });
  const panel = descendants(host).find((n) => n.classes.has('changes-panel'));
  view.render(changesState(true));
  assert.deepStrictEqual(calls, ['in']);
  view.render(changesState(true));
  assert.deepStrictEqual(calls, ['in'], 'un render a pannello aperto non lo rifà entrare');
  view.render(changesState(false));
  view.render(changesState(false));
  assert.deepStrictEqual(calls, ['in', 'out'], 'un solo giro di uscita');
  assert.strictEqual(panel.hidden, false, 'durante l uscita resta nella pagina');
  finishOut();
  await tick();
  assert.strictEqual(panel.hidden, true);
});

ok('pannello modifiche: riaperto durante l uscita rientra e non si nasconde', async () => {
  let finishOut = null;
  const calls = [];
  const motion = {
    slideIn: () => { calls.push('in'); return Promise.resolve(true); },
    slideOut: (el, apply) => { calls.push('out'); return new Promise((r) => { finishOut = () => { apply(); r(true); }; }); },
  };
  const host = createElement('div');
  const view = createChangesView({ doc: { createElement }, host, shortcut: 'x', onToggle() {}, onClose() {}, onFile() {}, motion });
  const panel = descendants(host).find((n) => n.classes.has('changes-panel'));
  view.render(changesState(true));
  view.render(changesState(false));
  view.render(changesState(true));
  assert.deepStrictEqual(calls, ['in', 'out', 'in']);
  finishOut(); // un motion vero non la finirebbe: anche così non deve nascondere
  await tick();
  assert.strictEqual(panel.hidden, false);
});
