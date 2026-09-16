const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Ordine manuale delle card della sidebar (trascinamento). Modulo puro in
   renderer/ per lo stesso motivo di session-groups.js: il renderer non ha
   require, il wrapper UMD lo rende comunque importabile qui. */
const { moveAdjacent, applyOrder, syncOrder } = require('../renderer/session-order');

const ids = () => ['a', 'b', 'c', 'd'];

ok('moveAdjacent sposta una card sopra il bersaglio', () => {
  assert.deepStrictEqual(moveAdjacent(ids(), 'd', 'b', { before: true }), ['a', 'd', 'b', 'c']);
});

ok('moveAdjacent sposta una card sotto il bersaglio', () => {
  assert.deepStrictEqual(moveAdjacent(ids(), 'd', 'b', { before: false }), ['a', 'b', 'd', 'c']);
});

ok('moveAdjacent verso il basso non sfasa l\'indice del bersaglio', () => {
  // 'a' viene da sopra: togliendolo, 'c' scala di uno. Il risultato deve
  // comunque metterlo subito dopo 'c', non dopo 'd'.
  assert.deepStrictEqual(moveAdjacent(ids(), 'a', 'c', { before: false }), ['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(moveAdjacent(ids(), 'a', 'c', { before: true }), ['b', 'a', 'c', 'd']);
});

ok('moveAdjacent porta in testa e in coda', () => {
  assert.deepStrictEqual(moveAdjacent(ids(), 'c', 'a', { before: true }), ['c', 'a', 'b', 'd']);
  assert.deepStrictEqual(moveAdjacent(ids(), 'b', 'd', { before: false }), ['a', 'c', 'd', 'b']);
});

ok('moveAdjacent ignora le mosse nulle e gli id sconosciuti', () => {
  const order = ids();
  assert.strictEqual(moveAdjacent(order, 'b', 'b', { before: true }), order);
  assert.strictEqual(moveAdjacent(order, 'zzz', 'b', { before: true }), order);
  assert.strictEqual(moveAdjacent(order, 'b', 'zzz', { before: true }), order);
  assert.deepStrictEqual(order, ids(), 'non deve mutare l\'array di partenza');
});

ok('applyOrder ordina secondo la lista e non muta l\'ingresso', () => {
  const sessions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const sorted = applyOrder(sessions, ['c', 'a', 'b']);
  assert.deepStrictEqual(sorted.map((s) => s.id), ['c', 'a', 'b']);
  assert.deepStrictEqual(sessions.map((s) => s.id), ['a', 'b', 'c']);
});

ok('applyOrder tiene in coda le sessioni non ancora ordinate', () => {
  const sorted = applyOrder([{ id: 'a' }, { id: 'nuova' }, { id: 'c' }], ['c', 'a']);
  assert.deepStrictEqual(sorted.map((s) => s.id), ['c', 'a', 'nuova']);
});

ok('applyOrder senza ordine lascia la lista com\'è', () => {
  const sorted = applyOrder([{ id: 'a' }, { id: 'b' }], []);
  assert.deepStrictEqual(sorted.map((s) => s.id), ['a', 'b']);
});

ok('syncOrder aggiunge le schede nuove in coda e toglie quelle chiuse', () => {
  assert.deepStrictEqual(syncOrder(['c', 'a', 'b'], ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd']);
  assert.deepStrictEqual(syncOrder(['c', 'a', 'b'], ['a', 'c']), ['c', 'a']);
  const order = ['c', 'a'];
  syncOrder(order, ['a', 'c', 'd']);
  assert.deepStrictEqual(order, ['c', 'a'], 'non deve mutare l\'array di partenza');
});
