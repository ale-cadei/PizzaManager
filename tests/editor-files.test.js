const assert = require('node:assert');
const { test: ok } = require('node:test');
const F = require('../renderer/editor-files');

const three = () => ['a.js', 'src/b.js', 'src/c.js'].reduce((s, rel) => F.open(s, rel, { path: '/p/' + rel, mtime: 1 }), F.empty());

ok('open: aggiunge in coda e attiva; riaprire non duplica', () => {
  let s = three();
  assert.deepStrictEqual(s.order, ['a.js', 'src/b.js', 'src/c.js']);
  assert.strictEqual(s.active, 'src/c.js');
  assert.strictEqual(s.files['a.js'].dirty, false);
  s = F.open(s, 'a.js');
  assert.deepStrictEqual(s.order, ['a.js', 'src/b.js', 'src/c.js']);
  assert.strictEqual(s.active, 'a.js');
  assert.strictEqual(s.files['a.js'].mtime, 1);
});

ok('close: l\'attiva passa alla successiva, o alla precedente se era l\'ultima', () => {
  let s = F.activate(three(), 'src/b.js');
  s = F.close(s, 'src/b.js');
  assert.strictEqual(s.active, 'src/c.js');
  s = F.close(s, 'src/c.js');
  assert.strictEqual(s.active, 'a.js');
  s = F.close(s, 'a.js');
  assert.deepStrictEqual(s, F.empty());
  const kept = F.close(F.activate(three(), 'a.js'), 'src/c.js');
  assert.strictEqual(kept.active, 'a.js');
});

ok('update e activate ignorano i file non aperti', () => {
  const s = three();
  assert.strictEqual(F.update(s, 'manca', { dirty: true }), s);
  assert.strictEqual(F.activate(s, 'manca'), s);
});

ok('renamePath: un file, o una cartella con quello che contiene', () => {
  let s = F.activate(three(), 'src/b.js');
  s = F.renamePath(s, 'src', 'lib');
  assert.deepStrictEqual(s.order, ['a.js', 'lib/b.js', 'lib/c.js']);
  assert.strictEqual(s.active, 'lib/b.js');
  assert.strictEqual(s.files['lib/b.js'].rel, 'lib/b.js');
  assert.strictEqual(s.files['src/b.js'], undefined);
  s = F.renamePath(s, 'a.js', 'z.js');
  assert.deepStrictEqual(s.order, ['z.js', 'lib/b.js', 'lib/c.js']);
});

ok('affectedBy e movedPath: "src" non tocca "srcx/a.js"', () => {
  const s = F.open(three(), 'srcx/a.js');
  assert.deepStrictEqual(F.affectedBy(s, 'src'), ['src/b.js', 'src/c.js']);
  assert.strictEqual(F.movedPath('srcx/a.js', 'src', 'lib'), null);
  assert.strictEqual(F.movedPath('src/b.js', 'src', 'lib'), 'lib/b.js');
});

ok('markDeleted, dirtyFiles, toSaved, findByPath', () => {
  let s = F.update(three(), 'a.js', { dirty: true });
  s = F.markDeleted(s, 'src/b.js');
  assert.deepStrictEqual({ ...s.files['src/b.js'], path: null }, { ...s.files['src/b.js'], path: null, deleted: true, mtime: null });
  assert.deepStrictEqual(F.dirtyFiles(s), ['a.js']);
  assert.deepStrictEqual(F.toSaved(s), { files: ['a.js', 'src/b.js', 'src/c.js'], active: 'src/c.js' });
  assert.strictEqual(F.findByPath(s, '/p/src/c.js'), 'src/c.js');
  assert.strictEqual(F.findByPath(s, '/altro'), null);
});

ok('i passi non toccano lo stato che ricevono', () => {
  const s = three();
  const copy = JSON.parse(JSON.stringify(s));
  F.close(F.renamePath(F.update(s, 'a.js', { dirty: true }), 'src', 'lib'), 'a.js');
  assert.deepStrictEqual(s, copy);
});

ok('joinRel, parentRel, baseName', () => {
  assert.strictEqual(F.joinRel('', 'a.js'), 'a.js');
  assert.strictEqual(F.joinRel('src', 'a.js'), 'src/a.js');
  assert.strictEqual(F.parentRel('src/x/a.js'), 'src/x');
  assert.strictEqual(F.parentRel('a.js'), '');
  assert.strictEqual(F.baseName('src/x/a.js'), 'a.js');
});

/* ---------- aperti di recente (docs/plans/70) ---------- */

ok('addRecent: il più recente in cima, senza doppioni, al massimo 5', () => {
  let list = [];
  for (const [rel, at] of [['a', 1], ['b', 2], ['c', 3], ['a', 4], ['d', 5], ['e', 6], ['f', 7]]) list = F.addRecent(list, rel, at);
  assert.deepStrictEqual(list.map((r) => r.rel), ['f', 'e', 'd', 'a', 'c']);
  assert.strictEqual(list[3].at, 4);
  const before = [{ rel: 'x', at: 1 }];
  F.addRecent(before, 'y', 2);
  assert.deepStrictEqual(before, [{ rel: 'x', at: 1 }], 'la lista di partenza non cambia');
});
