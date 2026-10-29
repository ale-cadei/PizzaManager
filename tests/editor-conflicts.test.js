const assert = require('node:assert');
const { test: ok } = require('node:test');
const { settle, setup, plain } = require('./editor-tab-setup');

/* Conflitti nella scheda editor (docs/plans/69, renderer/editor-conflicts.js):
   colori e zone sui blocchi, le scelte, con la pagina vera e un host finto. */
const CONFLICT = 'su\n<<<<<<< HEAD\nnostro\n=======\nloro\n>>>>>>> feat/x\ngiu\n';
const read = (text) => async (root, rel) => ({ ok: true, text, mtime: 100, path: `${root}/${rel}`, bom: false });

ok('editor conflitti: aprendo un file coi marcatori, colori e una zona per blocco', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  assert.strictEqual(await s.fn('openEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.deepStrictEqual(plain(s.host.conflicts).pop(), ['a.txt', [2]]);
  const zones = [...s.host.zones.values()].filter((z) => z.rel === 'a.txt');
  assert.deepStrictEqual(zones.map((z) => z.afterLine), [2]);
});

ok('editor conflitti: una scelta sostituisce il blocco come modifica, e le zone se ne vanno', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  await s.fn('openEditorFile')(s.tab, 'a.txt');
  await settle();
  s.fn('chooseEditorConflict')(s.tab, 'a.txt', 0, 'both');
  assert.deepStrictEqual(s.host.calls.filter((c) => c[0] === 'editText'), [['editText', 'a.txt', 'su\nnostro\nloro\ngiu\n']]);
  s.fn('updateEditorConflicts')(s.tab, 'a.txt'); // l'host vero lo fa da onChange
  assert.deepStrictEqual(plain(s.host.conflicts).pop(), ['a.txt', []]);
  assert.strictEqual([...s.host.zones.values()].filter((z) => z.rel === 'a.txt').length, 0);
});

ok('editor conflitti: senza marcatori niente zone, e un blocco sparito non si applica', async () => {
  const s = setup({ main: { editorRead: read('pulito\n'), editorHeadText: async () => ({ ok: true, text: 'pulito\n' }) } });
  await s.fn('openEditorFile')(s.tab, 'b.txt');
  await settle();
  assert.strictEqual(s.host.zones.size, 0);
  s.fn('chooseEditorConflict')(s.tab, 'b.txt', 0, 'ours');
  assert.ok(!s.host.calls.some((c) => c[0] === 'editText'));
});

ok('editor conflitti: openEditorConflict porta il cursore al primo blocco', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  assert.strictEqual(await s.fn('openEditorConflict')(s.tab, 'a.txt'), true);
  assert.deepStrictEqual(s.host.reveals, [['a.txt', 2]]);
});
