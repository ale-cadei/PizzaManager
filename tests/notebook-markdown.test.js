const assert = require('node:assert');
const { test: ok } = require('node:test');
const { parseMarkdown, parseInline } = require('../renderer/notebook-markdown');

const text = (t) => ({ type: 'text', text: t });

ok('notebook-markdown: titoli con # e sottolineati', () => {
  assert.deepStrictEqual(parseMarkdown('# Uno\n### Tre ###\nDue\n---\nGrande\n==='), [
    { type: 'heading', level: 1, inlines: [text('Uno')] },
    { type: 'heading', level: 3, inlines: [text('Tre')] },
    { type: 'heading', level: 2, inlines: [text('Due')] },
    { type: 'heading', level: 1, inlines: [text('Grande')] },
  ]);
});

ok('notebook-markdown: paragrafi separati da righe vuote, righe unite', () => {
  assert.deepStrictEqual(parseMarkdown('a\nb\n\n\nc'), [
    { type: 'paragraph', inlines: [text('a\nb')] },
    { type: 'paragraph', inlines: [text('c')] },
  ]);
});

ok('notebook-markdown: blocchi di codice con ``` e ~~~, anche senza chiusura', () => {
  assert.deepStrictEqual(parseMarkdown('```python\nx = 1\n\n# no\n```\ndopo'), [
    { type: 'code', lang: 'python', text: 'x = 1\n\n# no' },
    { type: 'paragraph', inlines: [text('dopo')] },
  ]);
  assert.deepStrictEqual(parseMarkdown('~~~\naperto'), [{ type: 'code', lang: '', text: 'aperto' }]);
});

ok('notebook-markdown: linea orizzontale e citazione annidata', () => {
  assert.deepStrictEqual(parseMarkdown('***\n> # T\n> riga\n>> dentro'), [
    { type: 'hr' },
    { type: 'quote', blocks: [
      { type: 'heading', level: 1, inlines: [text('T')] },
      { type: 'paragraph', inlines: [text('riga')] },
      { type: 'quote', blocks: [{ type: 'paragraph', inlines: [text('dentro')] }] },
    ] },
  ]);
});

ok('notebook-markdown: liste puntate, numerate, annidate', () => {
  assert.deepStrictEqual(parseMarkdown('- a\n- b\n  - c\n\n3. tre\n4) quattro'), [
    { type: 'list', ordered: false, start: 1, items: [
      [{ type: 'paragraph', inlines: [text('a')] }],
      [{ type: 'paragraph', inlines: [text('b')] }, { type: 'list', ordered: false, start: 1, items: [[{ type: 'paragraph', inlines: [text('c')] }]] }],
    ] },
    { type: 'list', ordered: true, start: 3, items: [
      [{ type: 'paragraph', inlines: [text('tre')] }],
      [{ type: 'paragraph', inlines: [text('quattro')] }],
    ] },
  ]);
});

ok('notebook-markdown: tabelle con allineamento, righe corte riempite', () => {
  assert.deepStrictEqual(parseMarkdown('| a | b |\n|:--|--:|\n| 1 | `|` |\n| 2 |'), [
    { type: 'table', align: ['left', 'right'],
      head: [[text('a')], [text('b')]],
      rows: [[[text('1')], [{ type: 'code', text: '|' }]], [[text('2')], []]] },
  ]);
});

ok('notebook-markdown: inline — codice, grassetto, corsivo, barrato, annidati', () => {
  assert.deepStrictEqual(parseInline('a `b*c*` **d *e*** _f_ ~~g~~'), [
    text('a '), { type: 'code', text: 'b*c*' }, text(' '),
    { type: 'strong', children: [text('d '), { type: 'em', children: [text('e')] }] }, text(' '),
    { type: 'em', children: [text('f')] }, text(' '), { type: 'del', children: [text('g')] },
  ]);
  assert.deepStrictEqual(parseInline('snake_case_name'), [text('snake_case_name')]);
  assert.deepStrictEqual(parseInline('** a'), [text('** a')]);
});

ok('notebook-markdown: link, immagini, autolink, escape, a capo forzato', () => {
  assert.deepStrictEqual(parseInline('[sito **x**](https://e.it "t") ![gatto](attachment:g.png) <https://a.b>'), [
    { type: 'link', href: 'https://e.it', children: [text('sito '), { type: 'strong', children: [text('x')] }] }, text(' '),
    { type: 'image', src: 'attachment:g.png', alt: 'gatto' }, text(' '),
    { type: 'link', href: 'https://a.b', children: [text('https://a.b')] },
  ]);
  assert.deepStrictEqual(parseInline('\\*no\\* [solo]'), [text('*no* [solo]')]);
  assert.deepStrictEqual(parseInline('a  \nb\\\nc\nd'), [text('a'), { type: 'break' }, text('b'), { type: 'break' }, text('c\nd')]);
});

ok('notebook-markdown: l HTML resta testo', () => {
  assert.deepStrictEqual(parseMarkdown('<script>alert(1)</script>'), [
    { type: 'paragraph', inlines: [text('<script>alert(1)</script>')] },
  ]);
});

ok('notebook-markdown: testo vuoto o strano non lancia', () => {
  assert.deepStrictEqual(parseMarkdown(''), []);
  assert.deepStrictEqual(parseMarkdown(null), []);
  assert.ok(Array.isArray(parseMarkdown('[[[(((**__``~~>>- 1.')));
});
