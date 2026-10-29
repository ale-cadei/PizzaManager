const assert = require('node:assert');
const { test: ok } = require('node:test');
const { settle, setup, plain } = require('./editor-tab-setup');
const ConflictMarkers = require('../renderer/conflict-markers');

/* Conflitti nella scheda editor (docs/plans/69, renderer/editor-conflicts.js):
   colori e zone sui blocchi, le scelte, con la pagina vera e un host finto. */
const CONFLICT = 'su\n<<<<<<< HEAD\nnostro\n=======\nloro\n>>>>>>> feat/x\ngiu\n';
const CONFLICT2 = 'su\n<<<<<<< HEAD\nnostro1\n=======\nloro1\n>>>>>>> feat/x\nmid\n<<<<<<< HEAD\nnostro2\n=======\nloro2\n>>>>>>> feat/x\ngiu\n';
const read = (text) => async (root, rel) => ({ ok: true, text, mtime: 100, path: `${root}/${rel}`, bom: false });
const zonesOf = (s, rel) => [...s.host.zones.values()].filter((z) => z.rel === rel);

ok('editor conflitti: aprendo un file coi marcatori, colori e una zona per blocco', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  assert.strictEqual(await s.fn('openEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.deepStrictEqual(plain(s.host.conflicts).pop(), ['a.txt', [2]]);
  assert.deepStrictEqual(zonesOf(s, 'a.txt').map((z) => z.afterLine), [2]);
});

ok('editor conflitti: una scelta sostituisce il blocco come modifica, subito, senza aspettare il debounce', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  await s.fn('openEditorFile')(s.tab, 'a.txt');
  await settle();
  const [block] = ConflictMarkers.parseBlocks(CONFLICT);
  const sig = s.fn('blockSignature')(CONFLICT.split('\n'), block);
  s.fn('chooseEditorConflict')(s.tab, 'a.txt', sig, 'both');
  // Niente settle() né chiamata manuale a updateEditorConflicts: il ricalcolo
  // è sincrono dentro chooseEditorConflict stesso (fix round 1, docs/plans/69).
  assert.deepStrictEqual(s.host.calls.filter((c) => c[0] === 'editText'), [['editText', 'a.txt', 'su\nnostro\nloro\ngiu\n']]);
  assert.deepStrictEqual(plain(s.host.conflicts).pop(), ['a.txt', []]);
  assert.strictEqual(zonesOf(s, 'a.txt').length, 0);
});

ok('editor conflitti: risolvere il blocco 0 non manda a vuoto la scelta nata per il blocco 1', async () => {
  // Fix round 1 (docs/plans/69): file con 2 blocchi. Si sceglie sul blocco 0
  // (le righe sopra il blocco 1 si accorciano, i suoi indici cambiano) e poi
  // sulla barra nata PRIMA di quella scelta per il blocco 1 (firma presa
  // sul testo iniziale, come farebbe un bottone già disegnato). Deve
  // risolvere comunque il blocco giusto, non restare muta e non toccarne un
  // altro: la firma del blocco non dipende dalla sua posizione.
  const s = setup({ main: { editorRead: read(CONFLICT2), editorHeadText: async () => ({ ok: true, text: CONFLICT2 }) } });
  await s.fn('openEditorFile')(s.tab, 'a.txt');
  await settle();
  const lines = CONFLICT2.split('\n');
  const [block0, block1] = ConflictMarkers.parseBlocks(CONFLICT2);
  const sig0 = s.fn('blockSignature')(lines, block0);
  const sig1 = s.fn('blockSignature')(lines, block1); // presa prima di qualunque modifica

  s.fn('chooseEditorConflict')(s.tab, 'a.txt', sig0, 'both');
  assert.strictEqual(zonesOf(s, 'a.txt').length, 1); // zone aggiornate subito, un solo blocco resta

  s.fn('chooseEditorConflict')(s.tab, 'a.txt', sig1, 'theirs');
  const edits = s.host.calls.filter((c) => c[0] === 'editText').map((c) => c[2]);
  assert.deepStrictEqual(edits, [
    'su\nnostro1\nloro1\nmid\n<<<<<<< HEAD\nnostro2\n=======\nloro2\n>>>>>>> feat/x\ngiu\n',
    'su\nnostro1\nloro1\nmid\nloro2\ngiu\n',
  ]);
  assert.strictEqual(zonesOf(s, 'a.txt').length, 0);
});

ok('editor conflitti: senza marcatori niente zone, e un blocco sparito non si applica', async () => {
  const s = setup({ main: { editorRead: read('pulito\n'), editorHeadText: async () => ({ ok: true, text: 'pulito\n' }) } });
  await s.fn('openEditorFile')(s.tab, 'b.txt');
  await settle();
  assert.strictEqual(s.host.zones.size, 0);
  s.fn('chooseEditorConflict')(s.tab, 'b.txt', 'qualunque-firma', 'ours');
  assert.ok(!s.host.calls.some((c) => c[0] === 'editText'));
});

ok('editor conflitti: openEditorConflict porta il cursore al primo blocco', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  assert.strictEqual(await s.fn('openEditorConflict')(s.tab, 'a.txt'), true);
  assert.deepStrictEqual(s.host.reveals, [['a.txt', 2]]);
});
