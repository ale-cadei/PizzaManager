const assert = require('node:assert');
const { test } = require('node:test');
const { search, clean } = require('../renderer/shell-search');

test('shell: cerca nel testo del terminale senza confondere i colori con il testo', () => {
  const text = '\x1b[31mGit\x1b[0m status\nusa github\nusa git per il commit';
  assert.strictEqual(clean(text).includes('\x1b'), false);
  assert.strictEqual(search(text, 'git').hits, 3);
  const found = search(text, 'git ');
  assert.strictEqual(found.hits, 2);
  assert.deepStrictEqual(found.snippets.map((s) => s.match), ['Git ', 'git ']);
  assert.ok(found.snippets.every((s) => s.role === 'terminal'));
});

test('shell: mostra tre anteprime e su richiesta tutte le occorrenze', () => {
  const text = 'git git git git git';
  assert.deepStrictEqual([search(text, 'git').hits, search(text, 'git').snippets.length], [5, 3]);
  assert.deepStrictEqual([search(text, 'git', { allSnippets: true }).hits, search(text, 'git', { allSnippets: true }).snippets.length], [5, 5]);
});

test('shell: cerca senza distinguere maiuscole e accenti', () => {
  assert.strictEqual(search('PERCHÉ è qui', 'perche').hits, 1);
  assert.strictEqual(search('abc', ' ').hits, 0);
});
