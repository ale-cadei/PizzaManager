const assert = require('node:assert');
const { test: ok } = require('node:test');
const { MAX_GUTTER_LINES, diffLines, changeRanges } = require('../renderer/editor-gutter');

/* Le righe cambiate rispetto a HEAD (docs/plans/63): testo di HEAD contro
   testo nell'editor, righe da 1, `after` = riga dopo cui mancano righe. */

ok('gutter: testi uguali → nessuna barretta', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc\n', 'a\nb\nc\n'), []);
  assert.deepStrictEqual(changeRanges('', ''), []);
});

ok('gutter: righe aggiunte in cima, in mezzo, in fondo', () => {
  assert.deepStrictEqual(changeRanges('a\nb', 'x\na\nb'), [{ kind: 'add', from: 1, to: 1 }]);
  assert.deepStrictEqual(changeRanges('a\nb', 'a\nx\ny\nb'), [{ kind: 'add', from: 2, to: 3 }]);
  assert.deepStrictEqual(changeRanges('a\nb', 'a\nb\nx'), [{ kind: 'add', from: 3, to: 3 }]);
});

ok('gutter: righe tolte in cima, in mezzo, in fondo', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'b\nc'), [{ kind: 'del', after: 0 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nc'), [{ kind: 'del', after: 1 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nb'), [{ kind: 'del', after: 2 }]);
});

ok('gutter: righe cambiate, e cambiate più aggiunte o tolte', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nB\nc'), [{ kind: 'mod', from: 2, to: 2 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nB\nX\nc'),
    [{ kind: 'mod', from: 2, to: 2 }, { kind: 'add', from: 3, to: 3 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc\nd', 'a\nB\nd'),
    [{ kind: 'mod', from: 2, to: 2 }, { kind: 'del', after: 2 }]);
});

ok('gutter: due blocchi separati', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc\nd\ne', 'A\nb\nc\ne'),
    [{ kind: 'mod', from: 1, to: 1 }, { kind: 'del', after: 3 }]);
});

ok('gutter: file non in HEAD → tutto aggiunto', () => {
  assert.deepStrictEqual(changeRanges(null, 'a\nb'), [{ kind: 'add', from: 1, to: 2 }]);
});

ok('gutter: \\r\\n vale come \\n', () => {
  assert.deepStrictEqual(changeRanges('a\r\nb\r\n', 'a\nb\n'), []);
});

ok('gutter: testo mancante o troppe righe → null', () => {
  assert.strictEqual(changeRanges('a', undefined), null);
  assert.strictEqual(changeRanges(42, 'a'), null);
  const big = 'x\n'.repeat(MAX_GUTTER_LINES);
  assert.strictEqual(changeRanges('a', big), null);
  assert.strictEqual(changeRanges(big, 'a'), null);
  assert.strictEqual(changeRanges('a\nb', 'a\nb\nc', { maxLines: 2 }), null);
});

ok('gutter: oltre il tetto di passi → null, sotto il risultato', () => {
  const before = 'a\nb\nc\nd';
  const after = 'w\nx\ny\nz';
  assert.strictEqual(changeRanges(before, after, { maxSteps: 3 }), null);
  assert.deepStrictEqual(changeRanges(before, after), [{ kind: 'mod', from: 1, to: 4 }]);
});

ok('gutter: diffLines dà le operazioni riga per riga', () => {
  assert.deepStrictEqual(diffLines(['a', 'b', 'c'], ['a', 'c', 'd']), ['=', '-', '=', '+']);
  assert.deepStrictEqual(diffLines([], ['a']), ['+']);
  assert.deepStrictEqual(diffLines(['a'], []), ['-']);
});

ok('gutter: su testi a caso il diff è minimo e ricostruisce il testo nuovo', () => {
  let seed = 42;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const lines = () => Array.from({ length: rand(12) }, () => 'abcd'[rand(4)]);
  const lcs = (a, b) => {
    const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
      }
    }
    return t[a.length][b.length];
  };
  for (let round = 0; round < 300; round++) {
    const a = lines();
    const b = lines();
    const ops = diffLines(a, b);
    const rebuilt = [];
    let i = 0;
    for (const op of ops) {
      if (op === '=') { assert.strictEqual(a[i], b[rebuilt.length]); rebuilt.push(a[i++]); }
      else if (op === '-') i++;
      else rebuilt.push(b[rebuilt.length]);
    }
    assert.deepStrictEqual(rebuilt, b, `round ${round}`);
    assert.strictEqual(i, a.length, `round ${round}`);
    assert.strictEqual(ops.filter((o) => o === '=').length, lcs(a, b), `round ${round}`);
  }
});

ok('gutter: un file grande con poche righe cambiate si confronta in fretta', () => {
  const a = Array.from({ length: 19000 }, (_, i) => `riga ${i}`);
  const b = [...a.slice(0, 9000), 'nuova', ...a.slice(9000, 15000), ...a.slice(15001)];
  b[100] = 'cambiata';
  const started = Date.now();
  assert.deepStrictEqual(changeRanges(a.join('\n'), b.join('\n')), [
    { kind: 'mod', from: 101, to: 101 }, { kind: 'add', from: 9001, to: 9001 }, { kind: 'del', after: 15001 },
  ]);
  assert.ok(Date.now() - started < 1000, 'diff troppo lento');
});
