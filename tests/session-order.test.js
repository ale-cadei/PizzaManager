const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Ordine manuale delle card della sidebar (trascinamento). Modulo puro in
   renderer/ per lo stesso motivo di session-groups.js: il renderer non ha
   require, il wrapper UMD lo rende comunque importabile qui. */
const { moveAdjacent, applyOrder, syncOrder, tabKeys, mergeSaved } = require('../renderer/session-order');

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

/* Ordine salvato fra un avvio e l'altro. L'id della scheda nasce a runtime,
   quindi si salvano chiavi stabili: l'id della conversazione (regge anche il
   riavvio della macchina) e il nome della sessione tmux (regge la chiusura
   dell'app). */

ok('tabKeys: prima l id della conversazione, poi la sessione tmux; nessuna chiave senza identita', () => {
  assert.deepStrictEqual(tabKeys({ type: 'claude', resumeId: 'r1', session: 'ais-claude-x' }), ['claude:r1', 'tmux:ais-claude-x']);
  assert.deepStrictEqual(tabKeys({ type: 'shell', session: 'ais-shell-y' }), ['tmux:ais-shell-y']);
  assert.deepStrictEqual(tabKeys({ type: 'shell' }), []);
  assert.deepStrictEqual(tabKeys(null), []);
});

ok('syncOrder: una scheda che riappare torna al suo posto salvato, non in coda', () => {
  const rank = new Map([['c', 0], ['a', 1], ['b', 2]]);
  const rankOf = (id) => rank.get(id);
  // All'avvio le schede si riagganciano una alla volta, in ordine qualsiasi
  let order = syncOrder([], ['b'], { rankOf });
  order = syncOrder(order, ['b', 'a'], { rankOf });
  order = syncOrder(order, ['b', 'a', 'c', 'nuova'], { rankOf });
  assert.deepStrictEqual(order, ['c', 'a', 'b', 'nuova']);
});

ok('syncOrder: il posto salvato non scavalca un ordine gia deciso in questa sessione', () => {
  const rankOf = (id) => ({ a: 0, b: 1, c: 2 })[id];
  // 'b' e 'a' sono gia stati riordinati a mano: 'c' entra dopo di loro
  assert.deepStrictEqual(syncOrder(['b', 'a'], ['a', 'b', 'c'], { rankOf }), ['b', 'a', 'c']);
});

ok('mergeSaved: salva l ordine visibile e tiene al loro posto le schede non (ancora) aperte', () => {
  // Salvato [B, A, C]; all'avvio c'e solo A: B e C non vanno persi
  assert.deepStrictEqual(mergeSaved([['A']], ['B', 'A', 'C']), ['B', 'A', 'C']);
  // L'utente ha spostato C sopra A mentre B e ancora chiusa
  assert.deepStrictEqual(mergeSaved([['C'], ['A']], ['B', 'A', 'C']), ['B', 'C', 'A']);
});

ok('mergeSaved: quando una scheda cambia chiave (arriva l id della conversazione) la vecchia sparisce', () => {
  const saved = ['tmux:x', 'tmux:y'];
  const now = [['claude:r1', 'tmux:x'], ['tmux:y']];
  assert.deepStrictEqual(mergeSaved(now, saved), ['claude:r1', 'tmux:y']);
});

ok('mergeSaved: le schede senza chiave non si salvano e la lista ha un tetto', () => {
  assert.deepStrictEqual(mergeSaved([[], ['A']], []), ['A']);
  const tante = Array.from({ length: 500 }, (_, i) => 'k' + i);
  assert.strictEqual(mergeSaved([['nuova']], tante).length, 200);
  assert.ok(mergeSaved([['nuova']], tante).includes('nuova'), 'il tetto taglia le vecchie, non quelle aperte');
});
