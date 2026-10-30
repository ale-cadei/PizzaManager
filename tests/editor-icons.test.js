const assert = require('node:assert');
const { test: ok } = require('node:test');
const I = require('../renderer/editor-icons');

/* Icone dell'albero e degli «Aperti» (docs/plans/70, SPEC §0): classe codicon
   e tinta per estensione, cartelle aperte e chiuse. */

ok('iconFor: le cartelle, aperte o chiuse, con la tinta del tipo editor', () => {
  const closed = I.iconFor('src', 'dir', false);
  const open = I.iconFor('src', 'dir', true);
  assert.strictEqual(closed.cls, 'codicon-folder');
  assert.strictEqual(open.cls, 'codicon-folder-opened');
  assert.strictEqual(closed.tint, open.tint);
  assert.match(closed.tint, /--type-editor/);
});

ok('iconFor: per estensione, senza badare alle maiuscole', () => {
  const cls = (name) => I.iconFor(name, 'file').cls;
  assert.deepStrictEqual(
    ['a.js', 'b.MJS', 'c.cjs', 'd.ts', 'e.css', 'f.html', 'README.md', 'package.json', '.gitignore', 'x.png', 'Makefile'].map(cls),
    ['codicon-file-code', 'codicon-file-code', 'codicon-file-code', 'codicon-file-code', 'codicon-symbol-color', 'codicon-code',
      'codicon-markdown', 'codicon-json', 'codicon-git-commit', 'codicon-file', 'codicon-file'],
  );
});

ok('iconFor: i file senza tinta propria stanno in --text-dim', () => {
  assert.strictEqual(I.iconFor('x.png', 'file').tint, 'var(--text-dim)');
  assert.strictEqual(I.iconFor('.gitignore', 'file').tint, 'var(--text-dim)');
  assert.notStrictEqual(I.iconFor('a.js', 'file').tint, I.iconFor('a.css', 'file').tint);
});

ok('iconFor: un nome che è solo un punto iniziale non è un estensione', () => {
  assert.strictEqual(I.iconFor('.js', 'file').cls, 'codicon-file');
});
