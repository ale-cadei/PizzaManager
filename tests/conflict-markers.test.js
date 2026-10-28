const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { test: ok } = require('node:test');

/* Marcatori di conflitto nel testo (docs/plans/69): blocchi e scelte, sulle
   fixture in tests/fixtures/conflicts/. */
const { parseBlocks, applyChoice } = require('../renderer/conflict-markers');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'conflicts', name), 'utf8');

ok('marcatori: un blocco semplice, righe da 1 e nomi dei due lati', () => {
  assert.deepStrictEqual(parseBlocks(fixture('simple.txt')), [{
    start: 2, base: null, sep: 4, end: 6, ours: [3, 3], theirs: [5, 5], oursLabel: 'HEAD', theirsLabel: 'feat/x',
  }]);
});

ok('marcatori: più blocchi, anche con un lato vuoto', () => {
  const blocks = parseBlocks(fixture('multi.txt'));
  assert.deepStrictEqual(blocks.map((b) => [b.start, b.sep, b.end]), [[1, 3, 5], [7, 8, 11]]);
  assert.deepStrictEqual(blocks[1].ours, [8, 7]); // vuoto
  assert.deepStrictEqual(blocks[1].theirs, [9, 10]);
});

ok('marcatori: diff3, la base non è un lato', () => {
  const [b] = parseBlocks(fixture('diff3.txt'));
  assert.strictEqual(b.base, 4);
  assert.deepStrictEqual(b.ours, [3, 3]);
  assert.deepStrictEqual(b.theirs, [7, 7]);
  assert.strictEqual(applyChoice(fixture('diff3.txt'), b, 'both'), 'x\nnostro\nloro\n');
});

ok('marcatori: ======= fuori da un blocco non è un marcatore', () => {
  assert.deepStrictEqual(parseBlocks(fixture('stray.txt')), []);
  assert.deepStrictEqual(parseBlocks('<<<<<<< HEAD\nmai chiuso\n'), []);
});

ok('marcatori: le tre scelte sostituiscono solo il blocco', () => {
  const text = fixture('simple.txt');
  const [b] = parseBlocks(text);
  assert.strictEqual(applyChoice(text, b, 'ours'), 'prima\nnostro\ndopo\n');
  assert.strictEqual(applyChoice(text, b, 'theirs'), 'prima\nloro\ndopo\n');
  assert.strictEqual(applyChoice(text, b, 'both'), 'prima\nnostro\nloro\ndopo\n');
});

ok('marcatori: CRLF resta CRLF', () => {
  const text = fixture('crlf.txt');
  const [b] = parseBlocks(text);
  assert.strictEqual(b.theirsLabel, 'feat/x');
  assert.strictEqual(applyChoice(text, b, 'theirs'), 'su\r\nloro\r\ngiu\r\n');
});

ok('marcatori: un blocco che non combacia più col testo non si applica', () => {
  const [b] = parseBlocks(fixture('simple.txt'));
  assert.strictEqual(applyChoice('cambiato tutto\n', b, 'ours'), null);
  assert.strictEqual(applyChoice(fixture('simple.txt'), b, 'base'), null);
});
