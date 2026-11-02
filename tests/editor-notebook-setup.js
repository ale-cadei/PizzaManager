const { createElement, createTextNode, fire } = require('./fake-dom');
const { setup } = require('./editor-tab-setup');

/* La vista del notebook nella pagina vera, con un document di fake-dom;
   Monaco è l'host finto di editor-tab-setup.js, più l'editor della cella
   e l'undo. Per i test di editor-notebook-*-ui.js. */

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

module.exports = { NB, nbSetup };
