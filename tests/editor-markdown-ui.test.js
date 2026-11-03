const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, createTextNode } = require('./fake-dom');
const { setup } = require('./editor-tab-setup');

/* L'anteprima dei markdown nella scheda editor (renderer/editor-markdown-ui.js,
   docs/plans/83): la pagina vera con un document di fake-dom; Monaco è
   l'host finto di editor-tab-setup.js, il testo fa da versione.
   Si confrontano testi e classi, mai nodi: il diff di assert fra nodi finti
   (genitore ↔ figli) cresce senza fine. */

function mdSetup(files) {
  const s = setup({ files });
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.createTextNode = createTextNode;
  s.page.ctx.document = doc;
  const ui = s.tab.editor.ui;
  ui.nbToggle = createElement('button');
  ui.mdToggle = createElement('button');
  ui.host = createElement('div');
  ui.notebook = createElement('div');
  ui.markdown = createElement('div');
  const sync = () => { s.fn('syncEditorNotebook')(s.tab); s.fn('syncEditorMarkdown')(s.tab); };
  const activate = (rel) => { s.tab.editor.files = s.page.ctx.AisessEditorFiles.activate(s.tab.editor.files, rel); sync(); };
  const toggle = () => s.fn('toggleEditorMarkdown')(s.tab);
  const shown = () => [ui.host.hidden, ui.markdown.hidden, ui.mdToggle.hidden];
  // fake-dom cerca solo per classe: qui per tag, attraversando i figli
  const byTag = (node, tag) => (node.children || []).flatMap((c) => [...(c.tag === tag ? [c] : []), ...byTag(c, tag)]);
  const textOf = (n) => n.textContent + n.children.map(textOf).join('');
  const texts = (tag) => byTag(ui.markdown, tag).map(textOf);
  return { ...s, ui, sync, activate, toggle, shown, texts };
}

ok('markdown editor: la testata ha il bottone e il riquadro ha la vista, nascosti', () => {
  const s = mdSetup({});
  const ui = s.fn('buildEditorLayout')({ ...s.tab, wrap: createElement('div') });
  assert.deepStrictEqual([ui.mdToggle.hidden, ui.markdown.hidden], [true, true]);
  assert.strictEqual(ui.markdown.className, 'editor-notebook editor-markdown');
  ui.mdToggle.onclick(); // senza file attivo non fa nulla, ma non lancia
});

ok('markdown editor: un .md si apre nel sorgente, col bottone «Anteprima»', () => {
  const s = mdSetup({ 'README.md': { text: '# Titolo', mtime: 1 } });
  s.sync();
  assert.deepStrictEqual(s.shown(), [false, true, false]);
  assert.strictEqual(s.ui.mdToggle.textContent, '▤ Anteprima');
});

ok('markdown editor: il bottone mostra il markdown reso e torna al sorgente', () => {
  const s = mdSetup({ 'a.md': { text: '# Titolo\n\nTesto **forte** e `codice`.\n\n```js\nlet x\n```\n', mtime: 1 } });
  s.sync();
  s.toggle();
  assert.deepStrictEqual(s.shown(), [true, false, false]);
  assert.strictEqual(s.ui.mdToggle.textContent, '{ } Sorgente');
  assert.deepStrictEqual(s.texts('h1'), ['Titolo']);
  assert.deepStrictEqual(s.texts('strong'), ['forte']);
  assert.deepStrictEqual(s.host.colorized, [['let x', 'js']]);
  s.toggle();
  assert.deepStrictEqual(s.shown(), [false, true, false]);
});

ok('markdown editor: l HTML nel markdown resta testo', () => {
  const s = mdSetup({ 'a.md': { text: '<script>alert(1)</script>', mtime: 1 } });
  s.sync();
  s.toggle();
  assert.deepStrictEqual(s.texts('script'), []);
  assert.deepStrictEqual(s.texts('p'), ['<script>alert(1)</script>']);
});

ok('markdown editor: altri file senza bottone; la scelta resta al file', () => {
  const s = mdSetup({ 'a.md': { text: 'uno', mtime: 1 }, 'b.py': { text: 'y', mtime: 1 } });
  s.activate('a.md');
  s.toggle();
  s.activate('b.py');
  assert.deepStrictEqual(s.shown(), [false, true, true]);
  s.activate('a.md');
  assert.deepStrictEqual(s.shown(), [true, false, false]);
});

ok('markdown editor: un notebook resta al notebook, l anteprima non lo tocca', () => {
  const nb = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] });
  const s = mdSetup({ 'a.ipynb': { text: nb, mtime: 1 } });
  s.sync();
  assert.deepStrictEqual([s.ui.host.hidden, s.ui.notebook.hidden, s.ui.markdown.hidden, s.ui.mdToggle.hidden], [true, false, true, true]);
});

ok('markdown editor: il testo cambia (ricarica dal disco) → si ridisegna, altrimenti si riusa', () => {
  const s = mdSetup({ 'a.md': { text: '# vecchio', mtime: 1 } });
  s.sync();
  s.toggle();
  const first = s.tab.editor.markdown.views.get('a.md').node;
  s.sync();
  assert.ok(s.tab.editor.markdown.views.get('a.md').node === first, 'stessa versione, stessa vista');
  s.host.texts['a.md'] = '# nuovo';
  s.sync();
  assert.deepStrictEqual(s.texts('h1'), ['nuovo']);
});

ok('markdown editor: chiuso il file, la scelta dell anteprima se ne va', () => {
  const s = mdSetup({ 'a.md': { text: 'x', mtime: 1 } });
  s.sync();
  s.toggle();
  s.fn('dropEditorMarkdown')(s.tab, 'a.md');
  s.sync();
  assert.deepStrictEqual(s.shown(), [false, true, false]);
});
