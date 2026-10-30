const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Sidebar collassabile (docs/plans/72-sidebar-collassabile.md). Il modulo
   mette solo la classe e lo stato del tasto: che cosa si vede da collassata
   lo decide la CSS. Qui si chiama il codice vero su elementi finti. */
const { createElement, createStorage, fire } = require('./fake-dom');
const { createSidebarCollapse, STORAGE_KEY } = require('../renderer/sidebar-collapse');

function setup(saved) {
  const storage = createStorage(saved === undefined ? {} : { [STORAGE_KEY]: saved });
  const els = {
    sidebar: createElement('aside'),
    toggle: createElement('button'),
    searchButton: createElement('button'),
    searchInput: createElement('input'),
  };
  const changes = [];
  const api = createSidebarCollapse({ ...els, storage, onChange: (c) => changes.push(c) });
  return { ...els, storage, changes, api };
}

ok('sidebar collassabile: senza stato salvato parte aperta', () => {
  const { sidebar, toggle, api } = setup();
  assert.strictEqual(api.isCollapsed(), false);
  assert.ok(!sidebar.classes.has('collapsed'));
  assert.strictEqual(toggle.attrs['aria-expanded'], 'true');
});

ok('sidebar collassabile: riparte come era stata lasciata', () => {
  const { sidebar, toggle, api } = setup('1');
  assert.strictEqual(api.isCollapsed(), true);
  assert.ok(sidebar.classes.has('collapsed'));
  assert.strictEqual(toggle.attrs['aria-expanded'], 'false');
});

ok('sidebar collassabile: il tasto alterna, salva e avvisa', () => {
  const { sidebar, toggle, storage, changes } = setup();
  fire(toggle, 'click');
  assert.ok(sidebar.classes.has('collapsed'));
  assert.strictEqual(storage.getItem(STORAGE_KEY), '1');
  assert.match(toggle.title, /espandi/i);
  fire(toggle, 'click');
  assert.ok(!sidebar.classes.has('collapsed'));
  assert.strictEqual(storage.getItem(STORAGE_KEY), '0');
  assert.match(toggle.title, /comprimi/i);
  assert.deepStrictEqual(changes, [true, false]);
});

ok('sidebar collassabile: impostare lo stato che c e gia non avvisa', () => {
  const { api, changes } = setup();
  api.setCollapsed(false);
  assert.deepStrictEqual(changes, []);
});

ok('sidebar collassabile: la lente riapre e mette il cursore nella ricerca', () => {
  const { sidebar, searchInput, searchButton, changes } = setup('1');
  fire(searchButton, 'click');
  assert.ok(!sidebar.classes.has('collapsed'));
  assert.strictEqual(searchInput.focused, true);
  assert.deepStrictEqual(changes, [false]);
});

ok('sidebar collassabile: uno storage che lancia non rompe niente', () => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  const sidebar = createElement('aside');
  const toggle = createElement('button');
  const api = createSidebarCollapse({ sidebar, toggle, storage: broken });
  assert.strictEqual(api.isCollapsed(), false);
  api.toggle();
  assert.ok(sidebar.classes.has('collapsed'));
});

/* Da collassata la card è icona e barretta: il nome resta nel tooltip, anche
   quando il segnale «ha finito» si accende e si spegne senza ridisegnarla. */
ok('sidebar collassabile: il tooltip della card comincia col nome', () => {
  const { installDocument, descendants } = require('./fake-dom');
  const Groups = require('../renderer/session-groups');
  const Slice = require('../renderer/pizza-slice');
  const { createSidebar } = require('../renderer/sidebar');
  const restore = installDocument();
  try {
    const list = createElement('div');
    const bar = createSidebar({
      list, count: createElement('span'), storage: createStorage(),
      Icons: { markup: () => '' }, Slice, Groups, escapeHtml: (s) => String(s),
      onSelect: () => {}, onClose: () => {}, onRename: () => {},
    });
    bar.render([{ id: 'a', type: 'claude', name: 'refactor login', cwd: '/x', alive: true }], null);
    const card = () => descendants(list).find((n) => n.classes.has('session-item'));
    assert.match(card().title, /^refactor login\n.*rinominare/);
    bar.signal('a', { needsAttention: true });
    assert.match(card().title, /^refactor login\n.*ha finito/);
    bar.signal('a', { needsAttention: false });
    assert.match(card().title, /^refactor login\n.*rinominare/);
  } finally { restore(); }
});
