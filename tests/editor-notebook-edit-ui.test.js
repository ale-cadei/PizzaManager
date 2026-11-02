const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, createTextNode, fire } = require('./fake-dom');
const { setup, settle } = require('./editor-tab-setup');

/* Il notebook si modifica dalla vista (renderer/editor-notebook-edit-ui.js,
   docs/plans/78): la pagina vera con un document di fake-dom; Monaco è
   l'host finto di editor-tab-setup.js, più l'editor della cella e l'undo. */

const NB = (...sources) => `${JSON.stringify({
  cells: sources.map((s, k) => (typeof s === 'string'
    ? { cell_type: 'code', execution_count: k + 1, id: `c${k}`, metadata: {}, outputs: [{ output_type: 'stream', name: 'stdout', text: ['o\n'] }], source: [s] }
    : s)),
  metadata: { kernelspec: { language: 'python' } },
  nbformat: 4,
  nbformat_minor: 5,
}, null, 1)}\n`;

function nbSetup(text, main) {
  const s = setup({ files: { 'a.ipynb': { text, mtime: 1 } }, main });
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.createTextNode = createTextNode;
  s.page.ctx.document = doc;
  s.page.ctx.getComputedStyle = () => ({ color: 'rgb(1, 2, 3)', fontFamily: 'Mono' });
  const ui = s.tab.editor.ui;
  ui.nbToggle = createElement('button');
  ui.host = createElement('div');
  ui.notebook = createElement('div');
  // Come in buildEditorLayout (editor-tab.js)
  ui.notebook.addEventListener('keydown', (e) => s.fn('onEditorNotebookKey')(s.tab, e));
  // L'editor della cella: ricorda testo e tasti, `type` è l'utente che scrive
  const cells = [];
  s.host.cellEditor = (node, opts) => {
    const c = { node, opts, value: opts.text, focused: false, disposed: false };
    c.api = { focus: () => { c.focused = true; }, getValue: () => c.value, dispose: () => { c.disposed = true; } };
    c.type = (t) => { c.value += t; opts.onChange(c.value); };
    cells.push(c);
    return c.api;
  };
  const history = [];
  s.host.undo = (rel) => history.push(['undo', rel]);
  s.host.redo = (rel) => history.push(['redo', rel]);
  const sync = () => s.fn('syncEditorNotebook')(s.tab);
  sync();
  const json = () => JSON.parse(s.host.texts['a.ipynb']);
  const sources = () => json().cells.map((c) => `${c.cell_type}:${c.source.join('')}`);
  const nodes = () => ui.notebook.querySelectorAll('.nb-cell');
  const selected = () => nodes().filter((n) => n.classes.has('nb-cell--selected')).map((n) => n.dataset.index);
  const key = (k, mods = {}) => fire(ui.notebook, 'keydown', { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  const edits = () => s.host.calls.filter((c) => c[0] === 'editText').length;
  return { ...s, ui, sync, json, sources, nodes, selected, key, cells, history, edits };
}

ok('notebook modifica: la prima cella è selezionata, il click e le frecce spostano', () => {
  const s = nbSetup(NB('a', 'b', 'c'));
  assert.deepStrictEqual(s.selected(), ['0']);
  fire(s.nodes()[2], 'mousedown');
  assert.deepStrictEqual(s.selected(), ['2']);
  s.key('ArrowUp');
  s.key('k');
  s.key('k');
  assert.deepStrictEqual(s.selected(), ['0'], 'in cima si resta in cima');
  s.key('j');
  assert.deepStrictEqual(s.selected(), ['1']);
  assert.strictEqual(s.edits(), 0, 'selezionare non scrive il file');
});

ok('notebook modifica: A e B inseriscono una cella di codice e la selezionano', () => {
  const s = nbSetup(NB('a', 'b'));
  s.key('b');
  assert.deepStrictEqual(s.sources(), ['code:a', 'code:', 'code:b']);
  assert.deepStrictEqual(s.selected(), ['1']);
  s.key('a');
  assert.deepStrictEqual(s.sources(), ['code:a', 'code:', 'code:', 'code:b']);
  assert.deepStrictEqual(s.selected(), ['1']);
  const fresh = s.json().cells[1];
  assert.match(fresh.id, /^[0-9a-f]{8}$/);
  assert.deepStrictEqual([fresh.outputs, fresh.execution_count], [[], null]);
  // Il file resta come lo scrive Jupyter: rientro 1, a capo finale
  assert.strictEqual(s.host.texts['a.ipynb'], `${JSON.stringify(s.json(), null, 1)}\n`);
});

ok('notebook modifica: D D elimina, una D sola no', () => {
  const s = nbSetup(NB('a', 'b', 'c'));
  s.key('j');
  s.key('d');
  s.key('j');
  s.key('d');
  assert.deepStrictEqual(s.sources(), ['code:a', 'code:b', 'code:c'], 'una D e poi altro: non si elimina');
  s.key('d');
  assert.deepStrictEqual(s.sources(), ['code:a', 'code:b']);
  assert.deepStrictEqual(s.selected(), ['1'], 'eliminata l ultima, si seleziona quella sopra');
});

ok('notebook modifica: M, Y e R cambiano tipo', () => {
  const s = nbSetup(NB('# t'));
  s.key('m');
  assert.deepStrictEqual(s.json().cells[0], { cell_type: 'markdown', id: 'c0', metadata: {}, source: ['# t'] });
  assert.strictEqual(s.nodes()[0].className, 'nb-cell nb-cell--markdown nb-cell--selected');
  s.key('r');
  s.key('y');
  assert.deepStrictEqual(s.json().cells[0].outputs, []);
});

ok('notebook modifica: Invio apre l editor della cella, Esc lo chiude e scrive il testo', () => {
  const s = nbSetup(NB('x = 1', 'y'));
  s.key('Enter');
  const [c] = s.cells;
  assert.deepStrictEqual([c.opts.text, c.opts.language, c.focused], ['x = 1', 'python', true]);
  assert.strictEqual(c.node.className, 'nb-cell-editor');
  assert.ok(s.nodes()[0].classes.has('nb-cell--editing'));
  c.type('0');
  // I tasti della vista non valgono mentre si scrive nella cella
  s.key('d');
  s.key('d');
  assert.deepStrictEqual(s.sources(), ['code:x = 1', 'code:y']);
  c.opts.onKey('escape');
  assert.deepStrictEqual(s.sources(), ['code:x = 10', 'code:y']);
  assert.strictEqual(c.disposed, true);
  assert.strictEqual(s.ui.notebook.focused, true, 'il fuoco torna alla vista');
  assert.deepStrictEqual(s.ui.notebook.querySelectorAll('.nb-code').map((n) => n.textContent), ['x = 10', 'y'], 'ridisegnata col testo nuovo');
});

ok('notebook modifica: una markdown si modifica in markdown, doppio click compreso', () => {
  const s = nbSetup(NB({ cell_type: 'markdown', id: 'm', metadata: {}, source: ['**b**'] }));
  fire(s.nodes()[0], 'dblclick');
  assert.deepStrictEqual([s.cells[0].opts.text, s.cells[0].opts.language], ['**b**', 'markdown']);
});

ok('notebook modifica: il testo battuto arriva al JSON dopo una pausa, senza ridisegnare la cella', async () => {
  const s = nbSetup(NB('a'));
  s.key('Enter');
  const [c] = s.cells;
  c.type('b');
  assert.deepStrictEqual(s.sources(), ['code:a'], 'non a ogni tasto');
  await new Promise((r) => setTimeout(r, 350));
  assert.deepStrictEqual(s.sources(), ['code:ab']);
  s.sync();
  assert.strictEqual(c.disposed, false, 'la cella in modifica resta');
  assert.strictEqual(s.nodes()[0].querySelectorAll('.nb-cell-editor').length, 1);
});

ok('notebook modifica: Shift+Invio passa alla cella dopo; dall ultima ne crea una e ci entra', () => {
  const s = nbSetup(NB('a', 'b'));
  s.key('Enter', { shiftKey: true });
  assert.deepStrictEqual(s.selected(), ['1']);
  s.key('Enter');
  s.cells[0].opts.onKey('next');
  assert.deepStrictEqual(s.sources(), ['code:a', 'code:b', 'code:']);
  assert.strictEqual(s.cells.length, 2);
  assert.strictEqual(s.cells[1].opts.text, '');
  assert.ok(s.nodes()[2].classes.has('nb-cell--editing'));
});

ok('notebook modifica: Z e Ctrl+Z annullano sul file, Ctrl+Shift+Z ripete', () => {
  const s = nbSetup(NB('a'));
  s.key('z');
  s.key('z', { ctrlKey: true });
  s.key('Z', { ctrlKey: true, shiftKey: true });
  assert.deepStrictEqual(s.history, [['undo', 'a.ipynb'], ['undo', 'a.ipynb'], ['redo', 'a.ipynb']]);
});

ok('notebook modifica: il testo cambiato da fuori (undo, disco) ridisegna anche la cella in modifica', () => {
  const s = nbSetup(NB('a'));
  s.key('Enter');
  s.host.texts['a.ipynb'] = NB('dal disco');
  s.sync();
  assert.strictEqual(s.cells[0].disposed, true);
  assert.deepStrictEqual(s.ui.notebook.querySelectorAll('.nb-code').map((n) => n.textContent), ['dal disco']);
});

ok('notebook modifica: Ctrl+S salva, dalla vista e dalla cella', async () => {
  const s = nbSetup(NB('a'), { editorWrite: async () => ({ ok: true, mtime: 2 }) });
  s.key('Enter');
  s.cells[0].type('!');
  s.cells[0].opts.onKey('save');
  await settle();
  const writes = s.sent('editorWrite');
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(JSON.parse(writes[0][3]).cells[0].source, ['a!'], 'col testo della cella in modifica');
  assert.strictEqual(s.cells[0].disposed, false, 'salvare non esce dalla cella');
  s.cells[0].opts.onKey('escape');
  s.key('s', { ctrlKey: true });
  await settle();
  assert.strictEqual(s.sent('editorWrite').length, 2);
});

ok('notebook modifica: barra della cella sposta, cambia tipo, cancella output, elimina', () => {
  const s = nbSetup(NB('a', 'b'));
  const tools = (k) => s.nodes()[k].querySelectorAll('.nb-cell-tools')[0];
  const button = (k, title) => tools(k).children.find((b) => b.title.startsWith(title));
  fire(button(0, 'Sposta giù'), 'click');
  assert.deepStrictEqual(s.sources(), ['code:b', 'code:a']);
  assert.deepStrictEqual(s.selected(), ['1'], 'la selezione segue la cella');
  fire(button(1, 'Cancella output'), 'click');
  assert.deepStrictEqual(s.json().cells.map((c) => c.outputs.length), [1, 0]);
  const pick = tools(0).children.find((n) => n.classes.has('nb-type'));
  pick.value = 'markdown';
  fire(pick, 'change');
  assert.strictEqual(s.json().cells[0].cell_type, 'markdown');
  fire(button(1, 'Elimina'), 'click');
  assert.deepStrictEqual(s.sources(), ['markdown:b']);
});

ok('notebook modifica: barra del notebook aggiunge sotto la selezionata e cancella tutti gli output', () => {
  const s = nbSetup(NB('a', 'b'));
  const bar = s.ui.notebook.querySelectorAll('.nb-bar')[0];
  const [code, markdown, clear] = bar.children;
  fire(markdown, 'click');
  assert.deepStrictEqual(s.sources(), ['code:a', 'markdown:', 'code:b']);
  fire(s.ui.notebook.querySelectorAll('.nb-bar')[0].children[0], 'click');
  assert.deepStrictEqual(s.sources(), ['code:a', 'markdown:', 'code:', 'code:b']);
  fire(s.ui.notebook.querySelectorAll('.nb-bar')[0].children[2], 'click');
  assert.deepStrictEqual(s.json().cells.map((c) => (c.outputs || []).length), [0, 0, 0, 0]);
  assert.ok(code && clear);
});

ok('notebook modifica: un click su un altra cella chiude la modifica e scrive il testo', () => {
  const s = nbSetup(NB('a', 'b'));
  s.key('Enter');
  s.cells[0].type('!');
  fire(s.nodes()[0], 'mousedown'); // dentro la cella in modifica: resta aperta
  assert.strictEqual(s.cells[0].disposed, false);
  fire(s.nodes()[1], 'mousedown');
  assert.deepStrictEqual(s.sources(), ['code:a!', 'code:b']);
  assert.strictEqual(s.cells[0].disposed, true);
  assert.deepStrictEqual(s.selected(), ['1']);
});

ok('notebook modifica: al JSON con la cella in modifica il testo arriva prima', () => {
  const s = nbSetup(NB('a'));
  s.key('Enter');
  s.cells[0].type('!');
  s.fn('toggleEditorNotebook')(s.tab);
  assert.deepStrictEqual(s.sources(), ['code:a!']);
  assert.strictEqual(s.cells[0].disposed, true);
});

ok('notebook modifica: tasti con Alt, o su un select della barra, restano loro', () => {
  const s = nbSetup(NB('a'));
  s.key('b', { altKey: true });
  fire(s.ui.notebook, 'keydown', { key: 'b', target: { tagName: 'SELECT' } });
  assert.strictEqual(s.edits(), 0);
});

ok('notebook modifica: salva tutto, chiudere e uscire vedono anche gli ultimi tasti della cella', async () => {
  const s = nbSetup(NB('a'), { editorWrite: async () => ({ ok: true, mtime: 2 }) });
  s.key('Enter');
  // Appena battuto, prima della pausa: il file non lo sa ancora
  s.cells[0].type('!');
  s.fn('editorDirtyTabs')(); // la domanda prima di uscire dall'app
  assert.deepStrictEqual(s.sources(), ['code:a!']);
  s.cells[0].type('?');
  await s.fn('saveEditorFile')(s.tab, 'a.ipynb'); // il bottone Salva della barra
  await settle();
  assert.deepStrictEqual(JSON.parse(s.sent('editorWrite').at(-1)[3]).cells[0].source, ['a!?']);
  assert.strictEqual(s.cells[0].disposed, false, 'si resta nella cella');
});

ok('notebook modifica: chiudendo la scheda l editor della cella se ne va', () => {
  const s = nbSetup(NB('a'));
  s.key('Enter');
  s.fn('disposeEditorTab')(s.tab);
  assert.strictEqual(s.cells[0].disposed, true);
});

ok('notebook modifica: dopo un bottone della barra i tasti tornano alla vista', () => {
  const s = nbSetup(NB('a'));
  s.ui.notebook.focused = false;
  fire(s.ui.notebook.querySelectorAll('.nb-bar')[0].children[0], 'click');
  assert.strictEqual(s.ui.notebook.focused, true);
});
