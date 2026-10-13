const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, installDocument, fire } = require('./fake-dom');
const T = require('../renderer/editor-tree');

const entries = (...names) => names.map((n) => (n.endsWith('/') ? { name: n.slice(0, -1), kind: 'dir', ignored: false } : { name: n, kind: 'file', ignored: n.endsWith('.log') }));

function sample() {
  let tree = T.setChildren(T.emptyTree(), '', entries('src/', 'a.log', 'b.js'));
  tree = T.setChildren(tree, 'src', entries('lib/', 'x.js'));
  tree = T.setChildren(tree, 'src/lib', entries('y.js'));
  return tree;
}

ok('visibleRows: solo le cartelle aperte mostrano i figli, con la profondità', () => {
  let tree = sample();
  assert.deepStrictEqual(T.visibleRows(tree).map((r) => r.rel), ['src', 'a.log', 'b.js']);
  tree = T.toggle(tree, 'src');
  tree = T.toggle(tree, 'src/lib');
  const rows = T.visibleRows(tree);
  assert.deepStrictEqual(rows.map((r) => `${r.depth}:${r.rel}`), ['0:src', '1:src/lib', '2:src/lib/y.js', '1:src/x.js', '0:a.log', '0:b.js']);
  assert.strictEqual(rows[0].expanded, true);
  assert.strictEqual(rows[4].ignored, true);
  assert.strictEqual(T.visibleRows(T.toggle(tree, 'src')).length, 3);
});

ok('renamePath e removePath spostano o dimenticano un ramo', () => {
  let tree = T.select(T.toggle(T.toggle(sample(), 'src'), 'src/lib'), 'src/lib/y.js');
  const moved = T.renamePath(tree, 'src', 'core');
  assert.deepStrictEqual(moved.expanded.sort(), ['core', 'core/lib']);
  assert.ok(moved.children['core/lib']);
  assert.strictEqual(moved.children['src/lib'], undefined);
  assert.strictEqual(moved.selected, 'core/lib/y.js');
  const gone = T.removePath(tree, 'src');
  assert.deepStrictEqual(gone.expanded, []);
  assert.strictEqual(gone.children.src, undefined);
  assert.strictEqual(gone.selected, null);
  assert.ok(gone.children['']);
});

ok('vista: nomi come testo, classi per cartelle, ignorati e selezione', () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const calls = [];
    const view = T.createTreeView({ root, document,
      onOpenFile: (rel) => calls.push(['open', rel]),
      onToggleDir: (rel) => calls.push(['toggle', rel]),
      onContextMenu: (row) => calls.push(['menu', row && row.rel]) });
    const tree = T.setChildren(T.emptyTree(), '', [{ name: '<img src=x onerror=alert(1)>', kind: 'file', ignored: false }, ...entries('src/', 'a.log')]);
    view.render(T.visibleRows(tree), 'a.log');
    const rows = view.element.children;
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].children[1].textContent, '<img src=x onerror=alert(1)>');
    assert.strictEqual(rows[0].innerHTML, '');
    assert.ok(rows[1].classList.contains('is-dir'));
    assert.ok(rows[2].classList.contains('is-ignored'));
    assert.ok(rows[2].classList.contains('is-selected'));
    fire(rows[1], 'click');
    fire(rows[2], 'click');
    fire(rows[2], 'contextmenu', { clientX: 1, clientY: 2 });
    fire(view.element, 'contextmenu', {});
    assert.deepStrictEqual(calls, [['toggle', 'src'], ['open', 'a.log'], ['menu', 'a.log'], ['menu', null]]);
    assert.strictEqual(view.rowOf('src'), rows[1]);
  } finally { restore(); }
});

ok('promptName: Invio dà il nome ripulito, Esc e blur null', async () => {
  const restore = installDocument();
  try {
    const host = createElement('div');
    const first = T.promptName({ document, host, initial: 'a.js' });
    const input = host.children[0];
    assert.strictEqual(input.value, 'a.js');
    input.value = '  nuovo.js ';
    fire(input, 'keydown', { key: 'Enter' });
    assert.strictEqual(await first, 'nuovo.js');
    assert.strictEqual(host.children.length, 0);

    const esc = T.promptName({ document, host });
    fire(host.children[0], 'keydown', { key: 'Escape' });
    assert.strictEqual(await esc, null);

    const blur = T.promptName({ document, host });
    fire(host.children[0], 'blur');
    assert.strictEqual(await blur, null);

    const blank = T.promptName({ document, host });
    host.children[0].value = '   ';
    fire(host.children[0], 'keydown', { key: 'Enter' });
    assert.strictEqual(await blank, null);
  } finally { restore(); }
});

ok('promptName: un render dell albero che toglie l input chiude la domanda con null', async () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {} });
    const tree = T.setChildren(T.emptyTree(), '', entries('src/', 'a.js'));
    view.render(T.visibleRows(tree), null);
    const asked = T.promptName({ document, host: view.element, after: view.rowOf('src'), depth: 1 });
    assert.ok(view.element.children.some((c) => c.classList.contains('editor-tree-input')));
    // Un evento del watch o una cartella caricata nel frattempo ridisegna
    view.render(T.visibleRows(tree), null);
    const answer = await Promise.race([asked, new Promise((r) => setTimeout(() => r('appesa'), 50))]);
    assert.strictEqual(answer, null, 'la promise resta appesa per sempre');
    assert.strictEqual(view.element.children.length, 2);
  } finally { restore(); }
});

ok('showMenu: una voce esegue e chiude, Esc chiude', () => {
  const restore = installDocument();
  try {
    let ran = 0;
    const menu = T.showMenu({ document, x: 10, y: 20, items: [{ label: 'Elimina', danger: true, run: () => { ran += 1; } }] });
    assert.strictEqual(document.body.children.includes(menu.element), true);
    assert.ok(menu.element.children[0].classList.contains('is-danger'));
    fire(menu.element.children[0], 'click');
    assert.strictEqual(ran, 1);
    assert.strictEqual(document.body.children.includes(menu.element), false);
    const other = T.showMenu({ document, x: 0, y: 0, items: [{ label: 'x', run: () => {} }] });
    fire(document, 'keydown', { key: 'Escape' });
    assert.strictEqual(document.body.children.includes(other.element), false);
  } finally { restore(); }
});
