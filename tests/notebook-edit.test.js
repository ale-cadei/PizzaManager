const assert = require('node:assert');
const { test: ok } = require('node:test');
const Edit = require('../renderer/notebook-edit');

/* Operazioni sul JSON grezzo di un notebook (renderer/notebook-edit.js,
   docs/plans/78): ognuna torna un oggetto nuovo, serialize riscrive come
   Jupyter. */

const ids = () => { let n = 0; return () => `id${++n}`; };

/** Come lo scrive Jupyter: rientro 1, a capo finale. */
const JUPYTER = `${JSON.stringify({
  cells: [
    { cell_type: 'markdown', id: 'aa', metadata: {}, source: ['# T\n', 'testo'] },
    { cell_type: 'code', execution_count: 3, id: 'bb', metadata: {}, outputs: [{ name: 'stdout', output_type: 'stream', text: ['1\n'] }], source: ['print(1)'] },
  ],
  metadata: { kernelspec: { language: 'python', name: 'python3' } },
  nbformat: 4,
  nbformat_minor: 5,
}, null, 1)}\n`;

const parsed = () => {
  const r = Edit.parseRaw(JUPYTER);
  assert.ok(r.ok);
  return r.raw;
};

ok('notebook-edit: senza modifiche si riscrive identico', () => {
  assert.strictEqual(Edit.serialize(parsed()), JUPYTER);
});

ok('notebook-edit: rientro e a capo finale presi dal file', () => {
  const two = JSON.stringify({ nbformat: 4, nbformat_minor: 4, metadata: {}, cells: [] }, null, 2);
  const r = Edit.parseRaw(two);
  assert.strictEqual(Edit.serialize(r.raw), two);
  const flat = '{"nbformat":4,"nbformat_minor":4,"metadata":{},"cells":[]}';
  assert.strictEqual(Edit.serialize(Edit.parseRaw(flat).raw), JSON.stringify(JSON.parse(flat), null, 1));
});

ok('notebook-edit: JSON rotto o senza celle → errore', () => {
  assert.strictEqual(Edit.parseRaw('{ rotto').ok, false);
  assert.strictEqual(Edit.parseRaw('{"nbformat":4}').ok, false);
  assert.strictEqual(Edit.parseRaw('[]').ok, false);
});

ok('notebook-edit: setSource scrive righe con il loro a capo, senza toccare l originale', () => {
  const raw = parsed();
  const next = Edit.setSource(raw, 1, 'a = 1\nb = 2\n');
  assert.deepStrictEqual(next.doc.cells[1].source, ['a = 1\n', 'b = 2\n']);
  assert.deepStrictEqual(raw.doc.cells[1].source, ['print(1)']);
  assert.deepStrictEqual(Edit.setSource(raw, 0, '').doc.cells[0].source, []);
  assert.strictEqual(next.doc.cells[0], raw.doc.cells[0], 'le celle non toccate si condividono');
});

ok('notebook-edit: insertCell con id da 4.5, chiavi come Jupyter', () => {
  const next = Edit.insertCell(parsed(), 1, 'code', ids());
  assert.strictEqual(next.doc.cells.length, 3);
  assert.deepStrictEqual(Object.keys(next.doc.cells[1]), ['cell_type', 'execution_count', 'id', 'metadata', 'outputs', 'source']);
  assert.deepStrictEqual(next.doc.cells[1], { cell_type: 'code', execution_count: null, id: 'id1', metadata: {}, outputs: [], source: [] });
  const md = Edit.insertCell(parsed(), 0, 'markdown', ids());
  assert.deepStrictEqual(md.doc.cells[0], { cell_type: 'markdown', id: 'id1', metadata: {}, source: [] });
});

ok('notebook-edit: insertCell prima della 4.5 non mette id', () => {
  const r = Edit.parseRaw(JSON.stringify({ nbformat: 4, nbformat_minor: 2, metadata: {}, cells: [] }));
  const next = Edit.insertCell(r.raw, 0, 'raw', ids());
  assert.deepStrictEqual(next.doc.cells[0], { cell_type: 'raw', metadata: {}, source: [] });
});

ok('notebook-edit: insertCell fuori dai limiti va agli estremi', () => {
  assert.strictEqual(Edit.insertCell(parsed(), 99, 'code', ids()).doc.cells[2].id, 'id1');
  assert.strictEqual(Edit.insertCell(parsed(), -3, 'code', ids()).doc.cells[0].id, 'id1');
});

ok('notebook-edit: deleteCell e moveCell', () => {
  const raw = parsed();
  assert.deepStrictEqual(Edit.deleteCell(raw, 0).doc.cells.map((c) => c.id), ['bb']);
  assert.deepStrictEqual(Edit.moveCell(raw, 0, 1).doc.cells.map((c) => c.id), ['bb', 'aa']);
  assert.deepStrictEqual(Edit.moveCell(raw, 1, -1).doc.cells.map((c) => c.id), ['bb', 'aa']);
  assert.strictEqual(Edit.moveCell(raw, 0, -1), raw, 'già in cima: niente da fare');
  assert.strictEqual(Edit.moveCell(raw, 1, 1), raw);
  assert.strictEqual(Edit.deleteCell(raw, 5), raw);
  assert.deepStrictEqual(raw.doc.cells.map((c) => c.id), ['aa', 'bb']);
});

ok('notebook-edit: setType aggiunge o toglie output e numero', () => {
  const raw = parsed();
  const toMd = Edit.setType(raw, 1, 'markdown');
  assert.deepStrictEqual(toMd.doc.cells[1], { cell_type: 'markdown', id: 'bb', metadata: {}, source: ['print(1)'] });
  const toCode = Edit.setType(raw, 0, 'code');
  assert.deepStrictEqual(toCode.doc.cells[0], { cell_type: 'code', execution_count: null, id: 'aa', metadata: {}, outputs: [], source: ['# T\n', 'testo'] });
  assert.deepStrictEqual(Object.keys(toCode.doc.cells[0]), ['cell_type', 'execution_count', 'id', 'metadata', 'outputs', 'source'], 'chiavi dove le mette Jupyter');
  assert.strictEqual(Edit.setType(raw, 0, 'markdown'), raw, 'stesso tipo: niente da fare');
  assert.strictEqual(Edit.setType(raw, 0, 'boh'), raw);
});

ok('notebook-edit: clearOutputs di una cella o di tutte', () => {
  const raw = parsed();
  const one = Edit.clearOutputs(raw, 1);
  assert.deepStrictEqual([one.doc.cells[1].outputs, one.doc.cells[1].execution_count], [[], null]);
  assert.strictEqual(Edit.clearOutputs(raw, 0), raw, 'una markdown non ha output');
  const all = Edit.clearOutputs(raw);
  assert.deepStrictEqual(all.doc.cells[1].outputs, []);
  assert.strictEqual(raw.doc.cells[1].outputs.length, 1);
});

ok('notebook-edit: celle non oggetto restano dove sono', () => {
  const r = Edit.parseRaw(JSON.stringify({ nbformat: 4, nbformat_minor: 4, metadata: {}, cells: [7, { cell_type: 'code', source: 'x', outputs: [] }] }));
  const next = Edit.setSource(r.raw, 1, 'y');
  assert.deepStrictEqual(next.doc.cells, [7, { cell_type: 'code', source: ['y'], outputs: [] }]);
  assert.strictEqual(Edit.setSource(r.raw, 0, 'z'), r.raw);
});

ok('notebook-edit: i tasti del modo comando, come in Jupyter', () => {
  const k = (key, mods = {}, armed = false) => Edit.commandForKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }, armed);
  assert.deepStrictEqual(
    ['ArrowUp', 'k', 'ArrowDown', 'j', 'Enter', 'a', 'b', 'm', 'y', 'r', 'z', 'x'].map((key) => k(key)),
    ['up', 'up', 'down', 'down', 'edit', 'above', 'below', 'markdown', 'code', 'raw', 'undo', null],
  );
  assert.strictEqual(k('Enter', { shiftKey: true }), 'next');
  assert.strictEqual(k('Enter', { ctrlKey: true }), 'run');
  assert.strictEqual(k('A', { shiftKey: true }), null, 'maiuscole: non sono i comandi');
  // D due volte elimina
  assert.strictEqual(k('d'), 'arm-delete');
  assert.strictEqual(k('d', {}, true), 'delete');
  // Ctrl e ⌘
  assert.strictEqual(k('s', { ctrlKey: true }), 'save');
  assert.strictEqual(k('s', { metaKey: true }), 'save');
  assert.strictEqual(k('z', { ctrlKey: true }), 'undo');
  assert.strictEqual(k('Z', { ctrlKey: true, shiftKey: true }), 'redo');
  assert.strictEqual(k('y', { ctrlKey: true }), 'redo');
  assert.strictEqual(k('a', { ctrlKey: true }), null, 'Ctrl+A resta al sistema');
  assert.strictEqual(k('a', { altKey: true }), null);
});
