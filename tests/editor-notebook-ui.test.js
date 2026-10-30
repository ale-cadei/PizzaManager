const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, createTextNode, fire } = require('./fake-dom');
const { setup } = require('./editor-tab-setup');

/* I notebook nella scheda editor (renderer/editor-notebook-ui.js,
   docs/plans/75): la pagina vera con un document di fake-dom; Monaco è
   l'host finto di editor-tab-setup.js, il testo fa da versione. */

const NB = (source) => JSON.stringify({
  nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { language: 'python' } },
  cells: [{ cell_type: 'code', source, execution_count: 1, outputs: [] }],
});

function nbSetup(files) {
  const s = setup({ files });
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.createTextNode = createTextNode;
  s.page.ctx.document = doc;
  s.page.ctx.getComputedStyle = () => ({ color: 'rgb(1, 2, 3)', fontFamily: 'Mono' });
  const ui = s.tab.editor.ui;
  ui.nbToggle = createElement('button');
  ui.host = createElement('div');
  ui.notebook = createElement('div');
  const sync = () => s.fn('syncEditorNotebook')(s.tab);
  const activate = (rel) => { s.tab.editor.files = s.page.ctx.AisessEditorFiles.activate(s.tab.editor.files, rel); sync(); };
  const cells = () => ui.notebook.querySelectorAll('.nb-code').map((n) => n.textContent);
  const toggle = () => s.fn('toggleEditorNotebook')(s.tab);
  return { ...s, ui, sync, activate, cells, toggle };
}

ok('notebook editor: la testata ha il bottone, nascosto, tra sotto-schede e commenti', () => {
  const s = nbSetup({});
  const wrap = createElement('div');
  const ui = s.fn('buildEditorLayout')({ ...s.tab, wrap });
  assert.strictEqual(ui.nbToggle.hidden, true);
  assert.strictEqual(ui.notebook.hidden, true);
  assert.strictEqual(ui.notebook.className, 'editor-notebook');
  // Il click passa dalla scheda vera: senza file attivo non fa nulla, ma non lancia
  assert.strictEqual(typeof ui.nbToggle.onclick, 'function');
  ui.nbToggle.onclick();
});

ok('notebook editor: un .ipynb si apre come notebook, colorato col suo linguaggio', () => {
  const s = nbSetup({ 'a.ipynb': { text: NB('print(1)'), mtime: 1 } });
  s.sync();
  assert.deepStrictEqual([s.ui.host.hidden, s.ui.notebook.hidden, s.ui.nbToggle.hidden], [true, false, false]);
  assert.strictEqual(s.ui.nbToggle.textContent, '{ } Sorgente');
  assert.deepStrictEqual(s.cells(), ['print(1)']);
  assert.deepStrictEqual(s.host.colorized, [['print(1)', 'python']]);
});

ok('notebook editor: il bottone passa al JSON in Monaco e torna', () => {
  const s = nbSetup({ 'a.ipynb': { text: NB('x'), mtime: 1 } });
  s.sync();
  s.toggle();
  assert.deepStrictEqual([s.ui.host.hidden, s.ui.notebook.hidden], [false, true]);
  assert.strictEqual(s.ui.nbToggle.textContent, '▤ Notebook');
  s.toggle();
  assert.deepStrictEqual([s.ui.host.hidden, s.ui.notebook.hidden], [true, false]);
});

ok('notebook editor: un file che non è un notebook non ha bottone, e si ritorna alla vista', () => {
  const s = nbSetup({ 'a.ipynb': { text: NB('x'), mtime: 1 }, 'b.py': { text: 'y', mtime: 1 } });
  s.sync();
  assert.deepStrictEqual([s.ui.nbToggle.hidden, s.ui.host.hidden, s.ui.notebook.hidden], [true, false, true]);
  s.activate('a.ipynb');
  assert.deepStrictEqual([s.ui.nbToggle.hidden, s.ui.host.hidden], [false, true]);
  assert.strictEqual(s.host.colorized.length, 1, 'la vista già fatta si riusa');
});

ok('notebook editor: il testo cambia (modifica nel JSON, ricarica) → si ridisegna', () => {
  const s = nbSetup({ 'a.ipynb': { text: NB('vecchio'), mtime: 1 } });
  s.sync();
  s.sync();
  assert.strictEqual(s.host.colorized.length, 1, 'stessa versione, niente da rifare');
  s.host.texts['a.ipynb'] = NB('nuovo');
  s.sync();
  assert.deepStrictEqual(s.cells(), ['nuovo']);
});

ok('notebook editor: JSON rotto → messaggio e bottone per il sorgente', () => {
  const s = nbSetup({ 'a.ipynb': { text: '{ rotto', mtime: 1 } });
  s.sync();
  const [problem] = s.ui.notebook.querySelectorAll('.nb-problem');
  assert.match(problem.children[0].textContent, /^Non si legge come notebook\. JSON non valido/);
  fire(problem.children[1], 'click');
  assert.deepStrictEqual([s.ui.host.hidden, s.ui.notebook.hidden], [false, true]);
});

ok('notebook editor: chiuso il file, la scelta del sorgente se ne va', () => {
  const s = nbSetup({ 'a.ipynb': { text: NB('x'), mtime: 1 } });
  s.sync();
  s.toggle();
  s.fn('dropEditorNotebook')(s.tab, 'a.ipynb');
  s.sync();
  assert.strictEqual(s.ui.notebook.hidden, false);
});
