const assert = require('node:assert');
const { test: ok } = require('node:test');
const { isNotebook, parseNotebook } = require('../renderer/notebook-model');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const nb = (cells, metadata = {}) => JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata, cells });

ok('notebook-model: riconosce .ipynb dal nome, anche con cartelle e maiuscole', () => {
  assert.strictEqual(isNotebook('a.ipynb'), true);
  assert.strictEqual(isNotebook('dati/Analisi.IPYNB'), true);
  assert.strictEqual(isNotebook('a.json'), false);
  assert.strictEqual(isNotebook('ipynb'), false);
  assert.strictEqual(isNotebook(null), false);
});

ok('notebook-model: source come stringa o come array di righe', () => {
  const r = parseNotebook(nb([
    { cell_type: 'markdown', metadata: {}, source: ['# Titolo\n', 'testo'] },
    { cell_type: 'code', metadata: {}, source: 'x = 1', execution_count: 3, outputs: [] },
    { cell_type: 'raw', metadata: {}, source: 'grezzo' },
  ]));
  assert.ok(r.ok);
  assert.deepStrictEqual(r.cells.map((c) => [c.type, c.source]), [
    ['markdown', '# Titolo\ntesto'], ['code', 'x = 1'], ['raw', 'grezzo'],
  ]);
  assert.strictEqual(r.cells[1].count, 3);
  assert.strictEqual(r.cells[0].count, null);
});

ok('notebook-model: linguaggio da kernelspec, poi language_info, poi python', () => {
  assert.strictEqual(parseNotebook(nb([], { kernelspec: { language: 'R' }, language_info: { name: 'julia' } })).language, 'r');
  assert.strictEqual(parseNotebook(nb([], { language_info: { name: 'Julia' } })).language, 'julia');
  assert.strictEqual(parseNotebook(nb([])).language, 'python');
});

ok('notebook-model: stream, errore senza ANSI, execute_result', () => {
  const r = parseNotebook(nb([{
    cell_type: 'code', source: '', execution_count: 1, outputs: [
      { output_type: 'stream', name: 'stdout', text: ['ciao\n', 'mondo'] },
      { output_type: 'stream', name: 'stderr', text: 'attento' },
      { output_type: 'error', ename: 'ValueError', evalue: 'no', traceback: ['\u001b[0;31mValueError\u001b[0m: no', 'riga 2'] },
      { output_type: 'execute_result', execution_count: 1, data: { 'text/plain': ['42'] }, metadata: {} },
    ],
  }]));
  assert.deepStrictEqual(r.cells[0].outputs, [
    { kind: 'text', text: 'ciao\nmondo', stream: 'stdout' },
    { kind: 'text', text: 'attento', stream: 'stderr' },
    { kind: 'error', name: 'ValueError', value: 'no', traceback: 'ValueError: no\nriga 2' },
    { kind: 'text', text: '42', stream: null },
  ]);
});

ok('notebook-model: fra più formati sceglie immagine, poi html, poi markdown, poi testo', () => {
  const out = (data) => parseNotebook(nb([{ cell_type: 'code', source: '', outputs: [{ output_type: 'display_data', data, metadata: {} }] }])).cells[0].outputs[0];
  assert.deepStrictEqual(out({ 'text/plain': 'fig', 'image/png': PNG + '\n' }), { kind: 'image', src: `data:image/png;base64,${PNG}` });
  assert.deepStrictEqual(out({ 'text/plain': 'df', 'text/html': ['<table>', '</table>'] }), { kind: 'html', html: '<table></table>' });
  assert.deepStrictEqual(out({ 'text/plain': 'md', 'text/markdown': '**a**' }), { kind: 'markdown', text: '**a**' });
  assert.deepStrictEqual(out({ 'application/vnd.jupyter.widget-view+json': {}, 'text/plain': 'w' }), { kind: 'text', text: 'w', stream: null });
  assert.strictEqual(out({ 'application/json': {} }), undefined, 'niente di mostrabile: nessun output');
});

ok('notebook-model: svg come data: in base64, base64 non valido scartato', () => {
  const out = (data) => parseNotebook(nb([{ cell_type: 'code', source: '', outputs: [{ output_type: 'display_data', data }] }])).cells[0].outputs;
  const [svg] = out({ 'image/svg+xml': ['<svg xmlns="http://www.w3.org/2000/svg">', '<text>è</text></svg>'] });
  assert.strictEqual(svg.kind, 'image');
  assert.match(svg.src, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/);
  assert.strictEqual(Buffer.from(svg.src.split(',')[1], 'base64').toString('utf8'), '<svg xmlns="http://www.w3.org/2000/svg"><text>è</text></svg>');
  assert.deepStrictEqual(out({ 'image/png': 'x"><script>', 'text/plain': 'fig' }), [{ kind: 'text', text: 'fig', stream: null }]);
});

ok('notebook-model: allegati delle celle markdown come data:', () => {
  const r = parseNotebook(nb([{ cell_type: 'markdown', source: '![](attachment:a.png)', attachments: { 'a.png': { 'image/png': PNG }, 'b.png': { 'image/png': '%%' } } }]));
  assert.deepStrictEqual(r.cells[0].attachments, { 'a.png': `data:image/png;base64,${PNG}` });
});

ok('notebook-model: JSON rotto, nbformat 3 o celle mancanti → errore che dice perché', () => {
  assert.match(parseNotebook('{').error, /JSON/);
  assert.match(parseNotebook(JSON.stringify({ nbformat: 3, worksheets: [] })).error, /nbformat 3/);
  assert.match(parseNotebook(JSON.stringify({ nbformat: 4 })).error, /celle/);
  assert.match(parseNotebook('[]').error, /notebook/);
  assert.strictEqual(parseNotebook('{').ok, false);
});

ok('notebook-model: celle e output strani non rompono il resto', () => {
  const r = parseNotebook(nb([null, { cell_type: 'boh', source: 'x' }, { cell_type: 'code', source: 7, outputs: 'no' }, { cell_type: 'code', source: '', outputs: [null, { output_type: 'stream' }] }]));
  assert.ok(r.ok);
  assert.deepStrictEqual(r.cells.map((c) => c.type), ['raw', 'code', 'code']);
  assert.deepStrictEqual(r.cells[1], { type: 'code', source: '', count: null, outputs: [], attachments: {} });
  assert.deepStrictEqual(r.cells[2].outputs, [{ kind: 'text', text: '', stream: 'stdout' }]);
});
