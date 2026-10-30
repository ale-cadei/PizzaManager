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
    assert.strictEqual(rows[0].querySelectorAll('.editor-tree-name')[0].textContent, '<img src=x onerror=alert(1)>');
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

ok('vista: chevron solo sulle cartelle, icona per tipo, rientro di 14px per livello', () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {} });
    view.render(T.visibleRows(T.toggle(sample(), 'src')), null);
    const part = (rel, cls) => view.rowOf(rel).querySelectorAll(`.${cls}`)[0];
    assert.ok(part('src', 'editor-tree-twisty').classList.contains('codicon-chevron-down'), 'cartella aperta');
    assert.ok(part('src/lib', 'editor-tree-twisty').classList.contains('codicon-chevron-right'), 'cartella chiusa');
    assert.ok(!part('b.js', 'editor-tree-twisty').classList.contains('codicon'), 'i file non hanno chevron');
    assert.ok(part('src', 'editor-tree-icon').classList.contains('codicon-folder-opened'));
    assert.ok(part('src/lib', 'editor-tree-icon').classList.contains('codicon-folder'));
    assert.ok(part('b.js', 'editor-tree-icon').classList.contains('codicon-file-code'));
    assert.strictEqual(view.rowOf('src').style.paddingLeft, '8px');
    assert.strictEqual(view.rowOf('src/x.js').style.paddingLeft, '22px');
  } finally { restore(); }
});

ok('vista: F2 rinomina e Canc elimina la riga selezionata, solo con una selezione', () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const calls = [];
    const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {},
      onRename: (row) => calls.push(['rename', row.rel]), onTrash: (row) => calls.push(['trash', row.rel]) });
    view.render(T.visibleRows(sample()), 'b.js');
    assert.strictEqual(fire(view.element, 'keydown', { key: 'F2' }).defaultPrevented, true);
    fire(view.element, 'keydown', { key: 'Delete' });
    fire(view.element, 'keydown', { key: 'Backspace', metaKey: true });
    fire(view.element, 'keydown', { key: 'Backspace' });
    view.render(T.visibleRows(sample()), null);
    fire(view.element, 'keydown', { key: 'F2' });
    assert.deepStrictEqual(calls, [['rename', 'b.js'], ['trash', 'b.js'], ['trash', 'b.js']]);
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

ok('showMenu: icona, scorciatoia e separatori; il nome della voce resta testo', () => {
  const restore = installDocument();
  try {
    const menu = T.showMenu({ document, x: 0, y: 0, items: [
      { label: 'Nuovo file', icon: 'new-file', key: 'Ctrl Alt N', run() {} },
      { sep: true },
      { label: '<b>x</b>', run() {} },
    ] });
    const [first, sep, last] = menu.element.children;
    assert.ok(first.querySelectorAll('.codicon-new-file').length === 1);
    assert.strictEqual(first.querySelectorAll('.editor-menu-key')[0].textContent, 'Ctrl Alt N');
    assert.strictEqual(first.querySelectorAll('.editor-menu-label')[0].textContent, 'Nuovo file');
    assert.ok(sep.classList.contains('editor-menu-sep'));
    assert.strictEqual(sep.getAttribute('role'), 'separator');
    assert.strictEqual(last.querySelectorAll('.editor-menu-label')[0].textContent, '<b>x</b>');
    assert.strictEqual(last.querySelectorAll('.editor-menu-key').length, 0);
    menu.close();
  } finally { restore(); }
});

/* ---------- copiare da fuori (docs/plans/61) ---------- */

const filesDrag = (more = {}) => ({ dataTransfer: { types: ['Files'], files: [], dropEffect: null, ...more } });

/** Albero con src aperta: src, src/lib, src/x.js, a.log, b.js. */
function copyView(selected = null) {
  const root = createElement('div');
  const copies = [];
  const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {},
    onCopyInto: (dir, source) => copies.push([dir, source]) });
  view.render(T.visibleRows(T.toggle(sample(), 'src')), selected);
  return { view, copies };
}

ok('vista: i file trascinati da fuori vanno nella cartella sotto il puntatore, o nella radice', () => {
  const restore = installDocument();
  try {
    const { view, copies } = copyView();
    const f = { name: 'foto.png' };
    const e = fire(view.rowOf('src/lib'), 'drop', filesDrag({ files: [f] }));
    assert.strictEqual(e.defaultPrevented, true, 'senza preventDefault Electron apre il file nella finestra');
    fire(view.rowOf('src/x.js'), 'drop', filesDrag({ files: [f] }));
    fire(view.rowOf('b.js'), 'drop', filesDrag({ files: [f] }));
    fire(view.element, 'drop', filesDrag({ files: [f] }));
    assert.deepStrictEqual(copies.map(([dir]) => dir), ['src/lib', 'src', '', '']);
    assert.deepStrictEqual(copies[0][1], { kind: 'drop', files: [f] });
    // Un drag che non porta file (testo selezionato) non copia niente
    const text = fire(view.element, 'drop', { dataTransfer: { types: ['text/plain'], files: [] } });
    assert.strictEqual(text.defaultPrevented, false);
    assert.strictEqual(copies.length, 4);
  } finally { restore(); }
});

ok('vista: durante il drag si evidenzia la cartella di arrivo; si spegne uscendo e al render', () => {
  const restore = installDocument();
  try {
    const { view } = copyView();
    const lit = (el) => el.classList.contains('is-drop-target');
    const over = fire(view.rowOf('src/x.js'), 'dragover', filesDrag());
    assert.strictEqual(over.defaultPrevented, true);
    assert.strictEqual(over.dataTransfer.dropEffect, 'copy');
    assert.ok(lit(view.rowOf('src')), 'un file evidenzia la sua cartella');
    fire(view.rowOf('b.js'), 'dragover', filesDrag());
    assert.ok(!lit(view.rowOf('src')));
    assert.ok(lit(view.element), 'un file della radice evidenzia tutto l albero');
    fire(view.element, 'dragleave', { relatedTarget: view.rowOf('src') });
    assert.ok(lit(view.element), 'passare da una riga all altra non spegne');
    fire(view.element, 'dragleave', { relatedTarget: null });
    assert.ok(!lit(view.element));
    const plain = fire(view.rowOf('src'), 'dragover', { dataTransfer: { types: ['text/plain'] } });
    assert.strictEqual(plain.defaultPrevented, false);
    assert.ok(!lit(view.rowOf('src')));
    fire(view.rowOf('src/lib'), 'dragover', filesDrag());
    const lib = view.rowOf('src/lib');
    view.render(T.visibleRows(T.toggle(sample(), 'src')), null);
    assert.ok(!lit(lib) && !lit(view.element));
  } finally { restore(); }
});

ok('vista: Ctrl+V con l albero a fuoco incolla nella cartella della selezione', () => {
  const restore = installDocument();
  try {
    const { view, copies } = copyView('src/x.js');
    assert.strictEqual(view.element.tabIndex, 0, 'l albero deve poter avere il fuoco');
    const e = fire(view.element, 'keydown', { key: 'v', ctrlKey: true });
    assert.strictEqual(e.defaultPrevented, true);
    fire(view.element, 'keydown', { key: 'V', metaKey: true });
    fire(view.element, 'keydown', { key: 'v' });
    fire(view.element, 'keydown', { key: 'v', ctrlKey: true, shiftKey: true });
    fire(view.element, 'keydown', { key: 'v', ctrlKey: true, altKey: true });
    assert.deepStrictEqual(copies, [['src', { kind: 'paste' }], ['src', { kind: 'paste' }]]);
    const dir = copyView('src/lib');
    fire(dir.view.element, 'keydown', { key: 'v', ctrlKey: true });
    const none = copyView(null);
    fire(none.view.element, 'keydown', { key: 'v', ctrlKey: true });
    assert.deepStrictEqual([dir.copies[0][0], none.copies[0][0]], ['src/lib', '']);
  } finally { restore(); }
});

ok('vista: click nel vuoto toglie la selezione, cosi Ctrl+V torna a incollare nella radice', () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const copies = [];
    let selected = 'src/x.js';
    const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {},
      onCopyInto: (dir, source) => copies.push([dir, source]),
      onDeselect: () => { selected = null; view.render(T.visibleRows(T.toggle(sample(), 'src')), selected); } });
    view.render(T.visibleRows(T.toggle(sample(), 'src')), selected);
    assert.ok(view.rowOf('src/x.js').classList.contains('is-selected'));
    fire(view.element, 'click', { target: view.element });
    assert.ok(!view.rowOf('src/x.js').classList.contains('is-selected'), 'nessuna riga resta selezionata');
    fire(view.element, 'keydown', { key: 'v', ctrlKey: true });
    assert.deepStrictEqual(copies, [['', { kind: 'paste' }]], 'Ctrl+V incolla nella radice');
  } finally { restore(); }
});

ok('vista: click su una riga non chiama onDeselect (solo il vuoto lo fa)', () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const deselects = [];
    const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {},
      onDeselect: () => deselects.push(true) });
    view.render(T.visibleRows(T.toggle(sample(), 'src')), null);
    fire(view.rowOf('src'), 'click');
    fire(view.rowOf('b.js'), 'click');
    assert.deepStrictEqual(deselects, []);
  } finally { restore(); }
});

ok('vista: un click che arriva (per propagazione) da un figlio - riga o input aperto - non toglie la selezione', () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const deselects = [];
    const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {},
      onDeselect: () => deselects.push(true) });
    view.render(T.visibleRows(T.toggle(sample(), 'src')), null);
    // Il bersaglio vero del click è lo span del nome, non la lista: come
    // bollerebbe un click reale su una riga prima di arrivare (per bolla) alla lista
    const name = view.rowOf('src').children[1];
    fire(view.element, 'click', { target: name });
    // L'input per rinominare/creare: un click dentro per spostare il cursore
    // non deve chiudere la domanda togliendo la selezione (docs/plans/61)
    T.promptName({ document, host: view.element });
    const input = view.element.children[0];
    fire(view.element, 'click', { target: input });
    assert.deepStrictEqual(deselects, []);
  } finally { restore(); }
});

ok('showMenu: tinta dell icona, dettaglio, classi della voce e onClose', () => {
  const restore = installDocument();
  try {
    let closed = 0;
    const menu = T.showMenu({ document, x: 0, y: 0, onClose: () => { closed += 1; }, items: [
      { label: 'a.js', icon: 'file-code', tint: 'red', detail: 'src/lib', className: 'is-active is-dirty', run() {} },
    ] });
    const item = menu.element.children[0];
    assert.strictEqual(item.querySelectorAll('.codicon')[0].style.color, 'red');
    assert.strictEqual(item.querySelectorAll('.editor-menu-detail')[0].textContent, 'src/lib');
    assert.ok(item.classList.contains('is-active') && item.classList.contains('is-dirty'));
    fire(document, 'keydown', { key: 'Escape' });
    menu.close();
    assert.strictEqual(closed, 1, 'una volta sola');
  } finally { restore(); }
});
