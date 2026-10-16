const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, fire } = require('./fake-dom');
const { settle, setup, plain } = require('./editor-tab-setup');

/* I commenti nella scheda editor (renderer/editor-notes-ui.js, docs/plans/65):
   la pagina vera con un document di fake-dom; Monaco è l'host finto di
   editor-tab-setup.js, che tiene segni e zone in due mappe. */

function fakeDocument() {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.body = createElement('body');
  return doc;
}

const TEXT = 'uno\ndue\ntre\nquattro';

function notesSetup(main = {}) {
  const s = setup({ files: { 'a.js': { text: TEXT, mtime: 1 }, 'b.js': { text: 'bi', mtime: 1 } }, main });
  s.page.ctx.document = fakeDocument();
  s.tab.editor.ui.notesBar = createElement('div');
  s.tab.editor.ui.notesBar.hidden = true;
  s.tab.editor.ui.message = createElement('div');
  const zones = () => [...s.host.zones.values()];
  const find = (root, cls) => root.querySelectorAll(`.${cls}`)[0];
  const draft = () => zones().find((z) => find(z.node, 'changes-comment-input'));
  const saved = () => zones().filter((z) => find(z.node, 'changes-comment'));
  const write = (text, key = { key: 'Enter', ctrlKey: true }) => {
    const input = find(draft().node, 'changes-comment-input');
    input.value = text;
    return fire(input, 'keydown', key);
  };
  const bar = () => s.tab.editor.ui.notesBar;
  return { ...s, zones, find, draft, saved, write, bar, notes: () => plain(s.tab.editor.notes.notes) };
}

ok('commenti editor: la riga dei commenti sta in testa dopo le sotto-schede, nascosta', () => {
  const s = setup();
  s.page.ctx.document = fakeDocument();
  const wrap = createElement('div');
  const ui = s.fn('buildEditorLayout')({ ...s.tab, wrap });
  const head = wrap.children[2].children[0];
  assert.deepStrictEqual(head.children.map((c) => c.className), ['btn btn--ghost editor-tree-toggle', 'editor-subtabs', 'editor-notes-bar']);
  assert.strictEqual(ui.notesBar, head.children[2]);
  assert.strictEqual(ui.notesBar.hidden, true);
});

ok('commenti editor: si apre la casella sotto le righe, Ctrl+Invio salva il commento', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 3);
  const d = s.draft();
  assert.deepStrictEqual([d.rel, d.afterLine], ['a.js', 3]);
  assert.strictEqual(s.find(d.node, 'changes-comment-lines').textContent, 'Righe 2–3');
  assert.strictEqual(s.find(d.node, 'changes-comment-input').focused, true);
  assert.strictEqual(fire(d.node, 'keydown', { key: 'a' }).propagationStopped, true, 'i tasti non arrivano a Monaco');
  const e = s.write('  Qui manca il null.  ');
  assert.strictEqual(e.defaultPrevented, true);
  assert.deepStrictEqual(s.notes(), [{ id: 'n1', rel: 'a.js', from: 2, to: 3, body: 'Qui manca il null.', track: 'm1' }]);
  assert.deepStrictEqual([...s.host.marks.keys()], ['m1'], 'il segno della casella passa al commento');
  assert.strictEqual(s.draft(), undefined);
  const [z] = s.saved();
  assert.strictEqual(z.afterLine, 3);
  assert.strictEqual(s.find(z.node, 'changes-comment-range').textContent, 'Righe 2–3');
  assert.strictEqual(s.find(z.node, 'changes-comment-body').textContent, 'Qui manca il null.');
  assert.strictEqual(s.bar().hidden, false);
  assert.deepStrictEqual(s.bar().children.map((c) => c.textContent), ['1 commento', 'Copia prompt', 'Svuota']);
});

ok('commenti editor: Esc chiude la casella senza commento e toglie il segno', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 4, 4);
  const e = s.write('a metà', { key: 'Escape' });
  assert.strictEqual(e.defaultPrevented, true);
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.host.marks.size, 0);
});

ok('commenti editor: un commento vuoto non si salva e la casella lo dice; una casella per volta', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('   ');
  const warn = s.find(s.draft().node, 'changes-comment-warn');
  assert.strictEqual(warn.hidden, false);
  assert.strictEqual(warn.textContent, ' · Il commento è vuoto.');
  assert.deepStrictEqual(s.notes(), []);
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 3, 3);
  assert.strictEqual(s.zones().length, 1);
  assert.deepStrictEqual([...s.host.marks.values()].map((m) => m.from), [3]);
});

ok('commenti editor: ✎ riapre la casella col testo al posto del commento, ✕ lo toglie', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 2);
  s.write('prima');
  s.find(s.saved()[0].node, 'changes-comment-edit').onclick();
  assert.strictEqual(s.saved().length, 0, 'il commento lascia il posto alla casella');
  assert.strictEqual(s.find(s.draft().node, 'changes-comment-input').value, 'prima');
  s.write('x', { key: 'Escape' });
  assert.strictEqual(s.saved().length, 1, 'Esc rimette il commento com era');
  s.find(s.saved()[0].node, 'changes-comment-edit').onclick();
  s.write('dopo');
  assert.deepStrictEqual(s.notes().map((n) => [n.id, n.body, n.track]), [['n1', 'dopo', 'm1']]);
  assert.strictEqual(s.saved().length, 1);
  s.find(s.saved()[0].node, 'changes-comment-remove').onclick();
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.host.marks.size, 0);
  assert.strictEqual(s.bar().hidden, true);
});

ok('commenti editor: Copia prompt mette il prompt negli appunti e chiede se svuotare', async () => {
  const s = notesSetup();
  const asked = [];
  let answer = false;
  s.run('editorConfirm').ask = async (o) => { asked.push(o); return answer; };
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 2);
  s.write('Manca il null.');
  const copy = s.find(s.bar(), 'editor-notes-copy');
  copy.onclick();
  await settle();
  assert.deepStrictEqual(s.sent('clipboardWrite').map((c) => c[1]), [
    ['Correggi questi punti del codice:', '', '1. a.js:2', '   > due', '   Manca il null.'].join('\n'),
  ]);
  assert.deepStrictEqual(plain(asked.map((o) => [o.title, o.confirmLabel])), [['Copiato. Svuoto i commenti?', 'Svuota']]);
  assert.strictEqual(asked[0].anchor, copy);
  assert.strictEqual(s.notes().length, 1, 'Annulla: i commenti restano');
  answer = true;
  copy.onclick();
  await settle();
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.bar().hidden, true);
});

ok('commenti editor: se la copia non riesce lo dice e non chiede niente', async () => {
  const s = notesSetup({ clipboardWrite: async () => ({ ok: false, error: 'testo vuoto' }) });
  let asked = 0;
  s.run('editorConfirm').ask = async () => { asked += 1; return true; };
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('x');
  await s.find(s.bar(), 'editor-notes-copy').onclick();
  assert.strictEqual(s.tab.editor.ui.message.textContent, 'Prompt non copiato: testo vuoto');
  assert.strictEqual(s.tab.editor.ui.message.hidden, false);
  assert.strictEqual(asked, 0);
  assert.strictEqual(s.notes().length, 1);
});

ok('commenti editor: Svuota toglie tutto senza chiedere, anche la casella aperta', () => {
  const s = notesSetup();
  s.run('editorConfirm').ask = async () => { throw new Error('Svuota non chiede'); };
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('uno');
  s.fn('openEditorNoteDraft')(s.tab, 'b.js', 1, 1);
  s.write('due');
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 3, 3);
  assert.strictEqual(s.bar().children[0].textContent, '2 commenti');
  s.find(s.bar(), 'editor-notes-clear').onclick();
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.host.marks.size, 0);
  assert.strictEqual(s.bar().hidden, true);
});

ok('commenti editor: quando il testo cambia il commento segue il suo segno', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 3);
  s.write('x');
  s.host.marks.set('m1', { rel: 'a.js', from: 4, to: 5 });
  s.fn('onEditorTextChange')(s.tab, 'a.js', false, false);
  assert.deepStrictEqual(s.notes().map((n) => [n.from, n.to]), [[4, 5]]);
  assert.strictEqual(s.find(s.saved()[0].node, 'changes-comment-range').textContent, 'Righe 4–5');
});

ok('commenti editor: chiudere un file ne toglie i commenti, rinominarlo li porta col nome nuovo', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('di a');
  s.fn('openEditorNoteDraft')(s.tab, 'b.js', 1, 1);
  s.write('di b');
  s.fn('dropEditorFile')(s.tab, 'a.js');
  assert.deepStrictEqual(s.notes().map((n) => n.body), ['di b']);
  assert.deepStrictEqual(s.saved().map((z) => z.rel), ['b.js']);
  assert.deepStrictEqual([...s.host.marks.values()].map((m) => m.rel), ['b.js']);
  s.fn('renameEditorNotes')(s.tab, 'b.js', 'c.js');
  assert.deepStrictEqual(s.notes().map((n) => n.rel), ['c.js']);
});
