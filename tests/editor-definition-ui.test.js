const assert = require('node:assert');
const { test: ok } = require('node:test');
const { setup, deferred, plain } = require('./editor-tab-setup');

/* Ctrl+click nella scheda editor (docs/plans/71): il main risponde finto,
   la scheda apre il file e porta il cursore sul nome. */
const FILES = { 'src/a.js': { text: 'helper(1);\n', mtime: 1 } };
const found = (...results) => async () => ({ ok: true, results });

ok('definizione ui: chiede al main cartella, nome, file e riga; apre il file e va alla colonna', async () => {
  const s = setup({
    files: FILES,
    main: {
      editorDefinition: found({ rel: 'src/util.js', line: 3, column: 10 }, { rel: 'x.js', line: 1, column: 1 }),
      editorRead: async () => ({ ok: true, text: 'a\nb\nfunction helper() {}\n', mtime: 2, path: '/w/src/util.js', bom: false }),
    },
  });
  await s.fn('goToEditorDefinition')(s.tab, 'src/a.js', 'helper', { lineNumber: 1, column: 1 });
  assert.deepStrictEqual(plain(s.sent('editorDefinition')), [['editorDefinition', '/w', 'helper', 'src/a.js', 1]]);
  assert.strictEqual(s.tab.editor.files.active, 'src/util.js');
  assert.deepStrictEqual(s.host.reveals, [['src/util.js', 3, 10]]);
});

ok('definizione ui: nello stesso file non rilegge, porta solo il cursore', async () => {
  const s = setup({ files: FILES, main: { editorDefinition: found({ rel: 'src/a.js', line: 1, column: 1 }) } });
  await s.fn('goToEditorDefinition')(s.tab, 'src/a.js', 'helper', { lineNumber: 1 });
  assert.deepStrictEqual(s.sent('editorRead'), []);
  assert.deepStrictEqual(s.host.reveals, [['src/a.js', 1, 1]]);
});

ok('definizione ui: nessun risultato o errore → fumetto, nessun salto', async () => {
  const none = setup({ files: FILES, main: { editorDefinition: found() } });
  await none.fn('goToEditorDefinition')(none.tab, 'src/a.js', 'helper', { lineNumber: 1 });
  assert.deepStrictEqual(none.host.hints, ['Nessuna definizione per «helper».']);
  assert.deepStrictEqual(none.host.reveals, []);
  const noGit = setup({ files: FILES, main: { editorDefinition: async () => ({ ok: false, reason: 'no-git' }) } });
  await noGit.fn('goToEditorDefinition')(noGit.tab, 'src/a.js', 'helper', { lineNumber: 1 });
  assert.match(noGit.host.hints[0], /serve git/);
  const thrown = setup({ files: FILES, main: { editorDefinition: async () => { throw new Error('ipc giù'); } } });
  await thrown.fn('goToEditorDefinition')(thrown.tab, 'src/a.js', 'helper', { lineNumber: 1 });
  assert.match(thrown.host.hints[0], /ipc giù/);
});

ok('definizione ui: senza fumetto di Monaco il messaggio va nella barra', async () => {
  const s = setup({ files: FILES, main: { editorDefinition: found() } });
  s.host.hint = () => false;
  const message = { textContent: '', hidden: true, classList: { add() {}, remove() {} } };
  s.tab.editor.ui = { ...s.tab.editor.ui, message };
  await s.fn('goToEditorDefinition')(s.tab, 'src/a.js', 'helper', { lineNumber: 1 });
  assert.strictEqual(message.textContent, 'Nessuna definizione per «helper».');
  assert.strictEqual(message.hidden, false);
});

ok('definizione ui: la risposta di un click vecchio arrivata dopo si scarta', async () => {
  const slow = deferred();
  let n = 0;
  const s = setup({
    files: FILES,
    main: { editorDefinition: () => (++n === 1 ? slow.promise : found({ rel: 'src/a.js', line: 1, column: 5 })()) },
  });
  const first = s.fn('goToEditorDefinition')(s.tab, 'src/a.js', 'old', { lineNumber: 1 });
  await s.fn('goToEditorDefinition')(s.tab, 'src/a.js', 'helper', { lineNumber: 1 });
  slow.resolve({ ok: true, results: [{ rel: 'src/a.js', line: 9, column: 1 }] });
  await first;
  assert.deepStrictEqual(s.host.reveals, [['src/a.js', 1, 5]]);
});
