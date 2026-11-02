const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Il tasto ⤒ di un gruppo fa scorrere la lista finché il gruppo comincia
   subito sotto «SESSIONI APERTE» (docs/plans/80-gruppo-in-cima.md). */
const { scrollPlan, canRelease, createGroupScroller, ROOM_VAR } = require('../renderer/group-scroll');
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar } = require('../renderer/sidebar');

ok('scrollPlan: il gruppo più in basso sale di quanto dista dalla cima', () => {
  const plan = scrollPlan({ offset: 300, scrollTop: 100, scrollHeight: 2000, clientHeight: 500 });
  assert.deepStrictEqual(plan, { top: 400, room: 0 });
});

ok('scrollPlan: un gruppo già scorso sopra la cima torna giù fin lì', () => {
  const plan = scrollPlan({ offset: -150, scrollTop: 400, scrollHeight: 2000, clientHeight: 500 });
  assert.deepStrictEqual(plan, { top: 250, room: 0 });
});

ok('scrollPlan: agli ultimi gruppi manca lista sotto, si aggiunge lo spazio che serve', () => {
  // massimo raggiungibile 1000 - 500 = 500: per arrivare a 700 servono 200px
  const plan = scrollPlan({ offset: 700, scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
  assert.deepStrictEqual(plan, { top: 700, room: 200 });
});

ok('scrollPlan: lo spazio già aggiunto non si conta come lista vera', () => {
  // scrollHeight comprende 200px aggiunti prima: la lista vera arriva a 500
  const plan = scrollPlan({ offset: -100, scrollTop: 700, scrollHeight: 1200, clientHeight: 500, room: 200 });
  assert.deepStrictEqual(plan, { top: 600, room: 100 });
});

ok('canRelease: lo spazio si toglie solo risalendo sotto il massimo vero', () => {
  const base = { scrollHeight: 1200, clientHeight: 500, room: 200 }; // massimo vero 500
  assert.strictEqual(canRelease({ ...base, scrollTop: 450, previousTop: 600 }), true);
  assert.strictEqual(canRelease({ ...base, scrollTop: 550, previousTop: 600 }), false, 'sopra il massimo vero salterebbe');
  assert.strictEqual(canRelease({ ...base, scrollTop: 450, previousTop: 300 }), false, 'scendendo verso il gruppo non si toglie');
  assert.strictEqual(canRelease({ ...base, room: 0, scrollTop: 0, previousTop: 600 }), false);
});

/** Una lista finta: misure fisse, scrollTo registra e muove. */
function fakeList({ scrollHeight, clientHeight }) {
  const listeners = {};
  const style = {};
  const list = {
    scrollTop: 0, scrollHeight, clientHeight, scrolls: [],
    style: { setProperty: (k, v) => { style[k] = v; } },
    styleValue: (k) => style[k],
    addEventListener: (type, fn) => { listeners[type] = fn; },
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo(opts) { list.scrolls.push(opts); },
    fire: (type) => listeners[type](),
  };
  return list;
}
const groupAt = (top) => ({ getBoundingClientRect: () => ({ top }) });

ok('createGroupScroller: scorre fino al gruppo, morbido o no secondo le preferenze', () => {
  const list = fakeList({ scrollHeight: 2000, clientHeight: 500 });
  let reduced = false;
  const scroller = createGroupScroller({ list, reducedMotion: () => reduced });
  scroller.toTop(groupAt(400));
  assert.deepStrictEqual(list.scrolls.pop(), { top: 300, behavior: 'smooth' });
  reduced = true;
  scroller.toTop(groupAt(400));
  assert.deepStrictEqual(list.scrolls.pop(), { top: 300, behavior: 'auto' });
  assert.strictEqual(list.styleValue(ROOM_VAR), undefined, 'lo spazio in fondo non serviva');
});

ok('createGroupScroller: allunga la lista per l ultimo gruppo e la riaccorcia risalendo', () => {
  const list = fakeList({ scrollHeight: 1000, clientHeight: 500 });
  const scroller = createGroupScroller({ list });
  scroller.toTop(groupAt(800)); // offset 700, massimo 500
  assert.strictEqual(list.styleValue(ROOM_VAR), '200px');
  assert.strictEqual(list.scrolls.pop().top, 700);
  // Il browser ha allungato la lista e l'ha scorsa fin lì
  list.scrollHeight = 1200; list.scrollTop = 700; list.fire('scroll');
  assert.strictEqual(list.styleValue(ROOM_VAR), '200px', 'arrivati in fondo lo spazio resta');
  list.scrollTop = 400; list.fire('scroll');
  assert.strictEqual(list.styleValue(ROOM_VAR), '0px', 'risaliti sotto il massimo vero lo spazio si toglie');
});

ok('createGroupScroller: senza lista è un errore chiaro', () => {
  assert.throws(() => createGroupScroller({}), /manca la lista/);
});

function renderSidebar(mode, onGroupToTop) {
  const list = createElement('div');
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
    onGroupToTop,
  });
  sidebar.setMode(mode);
  sidebar.render([{ id: 'a', type: 'claude', name: 'a', cwd: '/repo', projectRoot: '/repo', alive: true }], null);
  const groups = descendants(list).filter((n) => n.classes.has('session-group'));
  const cap = descendants(list).find((n) => n.classes.has('group-cap'));
  return { groups, cap, top: cap.children.find((c) => c.classes.has('group-top')) };
}

for (const mode of ['type', 'project']) {
  ok(`sidebar (${mode}): il ⤒ della testata passa il gruppo e non lo collassa`, () => {
    const restore = installDocument();
    try {
      const asked = [];
      const { groups, top } = renderSidebar(mode, (g) => asked.push(g));
      assert.ok(top, 'manca il ⤒ sulla testata');
      const ev = { stopped: false, stopPropagation() { ev.stopped = true; } };
      top.onclick(ev);
      assert.deepStrictEqual(asked, [groups[0]], 'il callback deve ricevere l elemento del gruppo');
      assert.ok(ev.stopped, 'il click non deve arrivare alla linguetta');
    } finally { restore(); }
  });
}

ok('sidebar: senza il callback il ⤒ non compare', () => {
  const restore = installDocument();
  try {
    assert.strictEqual(renderSidebar('type').top, undefined);
  } finally { restore(); }
});
