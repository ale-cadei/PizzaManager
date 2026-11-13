// Copia, taglia e incolla nell'albero della scheda editor (docs/plans/95):
// Ctrl+C / Ctrl+X scrivono gli appunti nel main, Incolla di un taglia sposta
// e i file aperti seguono lo spostamento.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { settle, setup, plain } = require('./editor-tab-setup');
const { createElement } = require('./fake-dom');

/** Una scheda con src/a.js aperto, il main che risponde ok e un messaggio vero. */
function cutSetup({ main = {}, answers = [] } = {}) {
  const s = setup({
    files: { 'src/a.js': { text: 'uno', mtime: 1 } },
    main: {
      editorClipboardPut: async () => ({ ok: true }),
      editorClipboardFiles: async () => ({ ok: true, paths: ['/w/src/a.js'], cut: true }),
      editorCopyPlan: async () => ({ ok: true, items: [{ name: 'a.js', kind: 'file' }], conflicts: [], count: null, bytes: null }),
      editorCopyRun: async () => ({ ok: true, copied: 1, skipped: 0, failed: [], moved: [{ fromRel: 'src/a.js', toRel: 'dest/a.js' }] }),
      editorList: async () => ({ ok: true, entries: [] }),
      ...main,
    },
  });
  const message = createElement('div');
  message.hidden = true;
  s.tab.editor.ui.message = message;
  s.tab.editor.copying = false;
  const asked = [];
  s.run('editorConfirm').choose = async (o) => { asked.push(o); return answers.length ? answers.shift() : null; };
  const paste = (dir) => s.fn('copyIntoEditor')(s.tab, dir, { kind: 'paste' });
  return { ...s, message, asked, paste };
}

ok('Ctrl+C / Ctrl+X: la riga va negli appunti del main, un avviso dice cosa fare', async () => {
  const s = cutSetup();
  const put = s.fn('putEditorClipboard');
  await put(s.tab, { rel: 'src/a.js', name: 'a.js', kind: 'file' }, 'cut');
  assert.deepStrictEqual(plain(s.sent('editorClipboardPut').map((c) => c.slice(1))), [['/w', 'src/a.js', 'cut']]);
  assert.match(s.message.textContent, /Tagliato «a\.js»/);
  await put(s.tab, { rel: 'src', name: 'src', kind: 'dir' }, 'copy');
  assert.match(s.message.textContent, /Copiato «src»/);
});

ok('Ctrl+C: se il main rifiuta, il messaggio lo dice', async () => {
  const s = cutSetup({ main: { editorClipboardPut: async () => ({ ok: false, error: 'Non esiste più.' }) } });
  await s.fn('putEditorClipboard')(s.tab, { rel: 'x.js', name: 'x.js', kind: 'file' }, 'copy');
  assert.strictEqual(s.message.textContent, 'Non si copia x.js: Non esiste più.');
});

ok('Incolla di un taglia: piano e corsa con move, esito «Spostato», il file aperto segue', async () => {
  const s = cutSetup();
  await s.paste('dest');
  await settle();
  assert.deepStrictEqual(plain(s.sent('editorCopyPlan').map((c) => c.slice(1))), [['/w', 'dest', ['/w/src/a.js'], true]]);
  assert.deepStrictEqual(plain(s.sent('editorCopyRun').map((c) => c.slice(1))), [['/w', 'dest', ['/w/src/a.js'], {}, true]]);
  assert.strictEqual(s.message.textContent, 'Spostato 1 elemento.');
  assert.deepStrictEqual(plain(s.tab.editor.files.order), ['dest/a.js']);
  const lists = s.sent('editorList').map((c) => c[2]);
  assert.ok(lists.includes('src') && lists.includes('dest'), `rilette ${lists.join(',')}`);
});

ok('Incolla: un conflitto con se stesso non si chiede', async () => {
  const s = cutSetup({
    main: {
      editorCopyPlan: async () => ({ ok: true, items: [{ name: 'a.js', kind: 'file' }], conflicts: [{ name: 'a.js', kind: 'file', existingKind: 'file', same: true }] }),
      editorCopyRun: async () => ({ ok: true, copied: 0, skipped: 1, failed: [], moved: [] }),
    },
  });
  await s.paste('src');
  assert.deepStrictEqual(s.asked, []);
  assert.strictEqual(s.sent('editorCopyRun').length, 1);
  assert.deepStrictEqual(plain(s.tab.editor.files.order), ['src/a.js']);
});

ok('Incolla di una copia: niente move, il file aperto resta dov era', async () => {
  const s = cutSetup({
    main: {
      editorClipboardFiles: async () => ({ ok: true, paths: ['/w/src/a.js'], cut: false }),
      editorCopyRun: async () => ({ ok: true, copied: 1, skipped: 0, failed: [] }),
    },
  });
  await s.paste('dest');
  assert.deepStrictEqual(plain(s.sent('editorCopyRun').map((c) => c.slice(1))), [['/w', 'dest', ['/w/src/a.js'], {}]]);
  assert.strictEqual(s.message.textContent, 'Copiato 1 elemento.');
  assert.deepStrictEqual(plain(s.tab.editor.files.order), ['src/a.js']);
});

ok('esito di uno spostamento: «Spostati», «non spostato»', () => {
  const s = cutSetup();
  const text = s.fn('copyOutcomeText');
  assert.strictEqual(text({ copied: 2, skipped: 1, failed: [{ name: 'b', error: 'Esiste già.' }] }, true),
    'Spostati 2 elementi, 1 saltato, 1 non spostato: b (Esiste già).');
  assert.strictEqual(text({ copied: 2 }), 'Copiati 2 elementi.');
});
