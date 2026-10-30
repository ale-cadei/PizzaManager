const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, installDocument, fire } = require('./fake-dom');
const Q = require('../renderer/editor-quick');

/* «Vai al file» (Ctrl+P, docs/plans/75): l'ordine dei risultati è puro, la
   vista si prova con fake-dom. */

const FILES = ['renderer/editor-tab.js', 'renderer/editor-tree.js', 'tests/editor-tab.test.js', 'docs/tabelle.md', 'lib/ed/itor.js', 'README.md'];

ok('rankFiles: prima gli aperti, poi chi comincia così, chi lo contiene nel nome, nel percorso, il fuzzy', () => {
  const r = Q.rankFiles({ files: FILES, open: ['tests/editor-tab.test.js'], query: 'tab' });
  assert.deepStrictEqual(r.open.map((i) => i.rel), ['tests/editor-tab.test.js']);
  assert.deepStrictEqual(r.project.map((i) => i.rel), ['docs/tabelle.md', 'renderer/editor-tab.js']);
  assert.deepStrictEqual(r.project[0].hits, [0, 1, 2], 'tabelle comincia con tab');
  assert.deepStrictEqual(r.project[1].hits, [7, 8, 9]);
  const fuzzy = Q.rankFiles({ files: FILES, open: [], query: 'edtree' });
  assert.deepStrictEqual(fuzzy.project.map((i) => i.rel), ['renderer/editor-tree.js']);
  assert.deepStrictEqual(fuzzy.project[0].hits, [0, 1, 3, 5, 9, 10]);
  const byPath = Q.rankFiles({ files: FILES, open: [], query: 'ed/it' });
  assert.deepStrictEqual(byPath.project.map((i) => i.rel), ['lib/ed/itor.js'], 'il percorso conta, dopo il nome');
  assert.deepStrictEqual(byPath.project[0].hits, []);
});

ok('rankFiles: senza testo gli aperti e i recenti; un tetto ai risultati', () => {
  const r = Q.rankFiles({ files: FILES, open: ['README.md'], recent: ['docs/tabelle.md', 'README.md'], query: '' });
  assert.deepStrictEqual(r.open.map((i) => i.rel), ['README.md']);
  assert.deepStrictEqual(r.project.map((i) => i.rel), ['docs/tabelle.md']);
  const many = Array.from({ length: 80 }, (_, i) => `f${i}.js`);
  assert.strictEqual(Q.rankFiles({ files: many, open: [], query: 'f', limit: 50 }).project.length, 50);
  assert.strictEqual(Q.rankFiles({ files: many, open: [], query: 'f', limit: 50 }).total, 80);
});

ok('rankFiles: senza maiuscole, e un aperto che non è nel progetto (file nuovo) c è lo stesso', () => {
  const r = Q.rankFiles({ files: FILES, open: ['nuovo/Mio.JS'], query: 'mio' });
  assert.deepStrictEqual(r.open.map((i) => [i.rel, i.name, i.dir]), [['nuovo/Mio.JS', 'Mio.JS', 'nuovo']]);
});

function view(source) {
  const host = createElement('div');
  const picked = [];
  let closed = 0;
  const v = Q.createQuickView({ document, host, source, onPick: (rel) => picked.push(rel), onClose: () => { closed += 1; } });
  return { v, host, picked, closed: () => closed };
}

ok('vista: gruppi, conteggio, frecce e Invio aprono; Esc chiude', () => {
  const restore = installDocument();
  try {
    const { v, host, picked, closed } = view(() => ({ files: FILES, open: ['README.md'], recent: [], git: { 'renderer/editor-tab.js': 'M' } }));
    assert.strictEqual(host.children[0], v.element);
    v.input.value = 'e';
    fire(v.input, 'input');
    const heads = v.element.querySelectorAll('.editor-quick-group').map((g) => g.textContent);
    assert.deepStrictEqual(heads, ['Aperti', 'Nel progetto']);
    assert.match(v.element.querySelectorAll('.editor-quick-count')[0].textContent, /^6 file$/);
    const rows = v.element.querySelectorAll('.editor-quick-row');
    assert.ok(rows[0].classList.contains('is-selected'));
    assert.strictEqual(rows[0].querySelectorAll('.editor-quick-open').length, 1, 'il file aperto lo dice');
    const tab = rows.find((r) => r.dataset.rel === 'renderer/editor-tab.js');
    assert.strictEqual(tab.querySelectorAll('.editor-tree-git')[0].textContent, 'M');
    const down = fire(v.input, 'keydown', { key: 'ArrowDown' });
    assert.strictEqual(down.defaultPrevented, true);
    assert.strictEqual(down.propagationStopped, true, 'le frecce non arrivano a Monaco');
    fire(v.input, 'keydown', { key: 'Enter' });
    assert.deepStrictEqual(picked, [rows[1].dataset.rel]);
    fire(v.input, 'keydown', { key: 'Escape' });
    assert.ok(closed() >= 1);
  } finally { restore(); }
});

ok('vista: il nome mostra la corrispondenza in evidenza, come testo', () => {
  const restore = installDocument();
  try {
    const { v } = view(() => ({ files: ['<img src=x onerror=1>tab.js'], open: [], recent: [], git: {} }));
    v.input.value = 'tab';
    fire(v.input, 'input');
    const row = v.element.querySelectorAll('.editor-quick-row')[0];
    assert.strictEqual(row.querySelectorAll('.editor-match').map((m) => m.textContent).join(''), 'tab');
    assert.strictEqual(row.querySelectorAll('.editor-quick-name')[0].children.map((c) => c.textContent).join(''), '<img src=x onerror=1>tab.js');
    assert.strictEqual(row.innerHTML, '');
  } finally { restore(); }
});

ok('vista: mentre l elenco si legge lo dice, e si aggiorna quando arriva', () => {
  const restore = installDocument();
  try {
    let files = null;
    const { v } = view(() => ({ files, open: [], recent: [], git: {}, loading: files === null }));
    assert.strictEqual(v.element.querySelectorAll('.editor-quick-count')[0].textContent, 'leggo i file…');
    files = ['a.js'];
    v.refresh();
    assert.strictEqual(v.element.querySelectorAll('.editor-quick-count')[0].textContent, '1 file');
  } finally { restore(); }
});
