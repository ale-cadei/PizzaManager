const assert = require('node:assert');
const { test: ok } = require('node:test');
const { validName, isInside, safeRel } = require('../lib/editor-paths');

ok('validName: i nomi normali passano, anche quelli riservati solo su Windows', () => {
  for (const n of ['a.js', '.env', 'README', 'con.txt', 'fine.']) assert.strictEqual(validName(n, 'linux'), true, n);
});

ok('validName: vuoti, punti, separatori, controllo e lunghi si rifiutano', () => {
  for (const n of ['', '.', '..', 'a/b', 'a\\b', 'a\nb', 'a\x00', 'x'.repeat(256), null, 3]) {
    assert.strictEqual(validName(n, 'linux'), false, JSON.stringify(n));
  }
});

ok('isInside: la radice e i figli sono dentro, i fratelli e i genitori no', () => {
  assert.strictEqual(isInside('/a/b', '/a/b', 'linux'), true);
  assert.strictEqual(isInside('/a/b', '/a/b/c/d.js', 'linux'), true);
  assert.strictEqual(isInside('/a/b', '/a/b/..foo', 'linux'), true);
  assert.strictEqual(isInside('/a/b', '/a/bc', 'linux'), false);
  assert.strictEqual(isInside('/a/b', '/a', 'linux'), false);
  assert.strictEqual(isInside('/a/b', '/a/b/../x', 'linux'), false);
});

ok('safeRel: normalizza i relativi e usa sempre /', () => {
  assert.strictEqual(safeRel('src/a.js'), 'src/a.js');
  assert.strictEqual(safeRel('./src//a.js'), 'src/a.js');
  assert.strictEqual(safeRel('src\\a.js'), 'src/a.js');
  assert.strictEqual(safeRel(''), '');
  assert.strictEqual(safeRel('.'), '');
});

ok('safeRel: rifiuta .., assoluti, lettere di unità, controllo e non-stringhe', () => {
  for (const r of ['../x', 'a/../b', '..', '/etc/passwd', '\\\\srv\\x', 'C:\\x', 'C:x', 'a\x00b', 'x'.repeat(1025), null, 1]) {
    assert.strictEqual(safeRel(r), null, JSON.stringify(r));
  }
});
