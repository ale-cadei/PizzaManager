const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, descendants, fire } = require('./fake-dom');

/* Pannello «cosa ha cambiato» (docs/plans/32): linguetta, intestazione,
   file a fisarmonica e righe del diff, su un DOM finto. Il testo dei diff è
   arbitrario: deve restare testo. */
const { createChangesView } = require('../renderer/changes-view');

const doc = { createElement };
const byClass = (root, cls) => descendants(root).filter((n) => n.classes.has(cls));
const one = (root, cls) => byClass(root, cls)[0];
const textOf = (el) => [el.textContent, ...el.children.map(textOf)].join('');

function setup(extra = {}) {
  const host = createElement('div');
  const calls = { toggle: 0, close: 0, files: [] };
  const view = createChangesView({
    doc, host, shortcut: '⌘⇧M',
    onToggle: () => { calls.toggle += 1; },
    onClose: () => { calls.close += 1; },
    onFile: (p) => calls.files.push(p),
    ...extra,
  });
  return { host, view, calls };
}

const label = (text, clean = false) => ({ visible: true, clean, text });
const baseState = (over = {}) => ({
  label: label('2 · +3 −1'), open: true, title: 'feat/x da main', summary: '2 file · +3 −1',
  error: null, files: [], expanded: {}, ...over,
});
const file = (path, extra = {}) => ({ path, status: 'M', added: 2, removed: 1, binary: false, ...extra });

ok('vista modifiche: la linguetta mostra il contatore e apre il pannello', () => {
  const { host, view, calls } = setup();
  view.render(baseState({ open: false }));
  const tab = one(host, 'changes-tab');
  assert.strictEqual(tab.hidden, false);
  assert.strictEqual(textOf(tab), '2 · +3 −1');
  assert.ok(tab.title.includes('⌘⇧M'), 'la linguetta non dice la scorciatoia');
  assert.strictEqual(one(host, 'changes-panel').hidden, true);
  tab.onclick();
  assert.strictEqual(calls.toggle, 1);
});

ok('vista modifiche: fuori da un repository la linguetta non c\'è; pulito si spegne', () => {
  const { host, view } = setup();
  view.render(baseState({ open: false, label: { visible: false, clean: true, text: '' } }));
  assert.strictEqual(one(host, 'changes-tab').hidden, true);
  view.render(baseState({ open: false, label: label('±0', true) }));
  assert.ok(one(host, 'changes-tab').classes.has('is-clean'));
});

ok('vista modifiche: col pannello aperto la linguetta si nasconde e l\'intestazione dice cosa', () => {
  const { host, view } = setup();
  view.render(baseState());
  assert.strictEqual(one(host, 'changes-panel').hidden, false);
  assert.strictEqual(one(host, 'changes-tab').hidden, true);
  assert.strictEqual(textOf(one(host, 'changes-title')), 'feat/x da main');
  assert.strictEqual(textOf(one(host, 'changes-summary')), '2 file · +3 −1');
});

ok('vista modifiche: le righe dei file, con stato, percorso e contatori', () => {
  const { host, view, calls } = setup();
  view.render(baseState({ files: [
    file('lib/x.js'),
    file('b.js', { status: 'R', oldPath: 'a.js', added: 0, removed: 0 }),
    file('logo.png', { binary: true, added: null, removed: null }),
  ] }));
  const rows = byClass(host, 'changes-file-row');
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(textOf(one(rows[0], 'changes-status')), 'M');
  assert.strictEqual(textOf(one(rows[0], 'changes-path')), 'lib/x.js');
  assert.strictEqual(textOf(one(rows[0], 'changes-add')), '+2');
  assert.strictEqual(textOf(one(rows[0], 'changes-del')), '−1');
  assert.strictEqual(textOf(one(rows[1], 'changes-path')), 'a.js → b.js');
  assert.strictEqual(byClass(rows[1], 'changes-add').length, 0, 'un +0 non si mostra');
  assert.strictEqual(textOf(one(rows[2], 'changes-note')), 'binario');
  rows[0].onclick();
  assert.deepStrictEqual(calls.files, ['lib/x.js']);
  assert.strictEqual(rows[0].getAttribute('aria-expanded'), 'false');
});

ok('vista modifiche: un file aperto mostra il diff riga per riga, e il markup resta testo', () => {
  const { host, view } = setup();
  const diff = { ok: true, binary: false, truncated: false, hunks: [{ header: '@@ -1,2 +1,2 @@', lines: [
    { kind: 'ctx', oldNo: 1, newNo: 1, text: 'uno' },
    { kind: 'del', oldNo: 2, newNo: null, text: '<b>due</b>' },
    { kind: 'add', oldNo: null, newNo: 2, text: '<script>alert(1)</script>' },
    { kind: 'note', oldNo: null, newNo: null, text: 'No newline at end of file' },
  ] }] };
  view.render(baseState({ files: [file('x.html')], expanded: { 'x.html': diff } }));
  assert.strictEqual(one(host, 'changes-file-row').getAttribute('aria-expanded'), 'true');
  const lines = byClass(host, 'changes-line');
  assert.deepStrictEqual(lines.map((l) => ['add', 'del', 'ctx', 'note'].find((k) => l.classes.has(k))), ['ctx', 'del', 'add', 'note']);
  assert.strictEqual(textOf(one(lines[2], 'changes-code')), '<script>alert(1)</script>');
  assert.strictEqual(textOf(one(lines[2], 'changes-ln')), '2');
  assert.strictEqual(textOf(one(lines[1], 'changes-ln')), '2');
  assert.strictEqual(textOf(one(host, 'changes-hunk')), '@@ -1,2 +1,2 @@');
  assert.ok(descendants(host).every((n) => !n.html), 'qualcosa è passato da innerHTML');
});

ok('vista modifiche: caricamento, errore, binario, troncato', () => {
  const { host, view } = setup();
  view.render(baseState({
    files: [file('a'), file('b'), file('c'), file('d')],
    expanded: {
      a: { loading: true },
      b: { ok: false, error: 'Il file non è più fra le modifiche.' },
      c: { ok: true, binary: true, truncated: false, hunks: [] },
      d: { ok: true, binary: false, truncated: true, hunks: [{ header: '@@ -1 +1 @@', lines: [{ kind: 'add', oldNo: null, newNo: 1, text: 'x' }] }] },
    },
  }));
  const notes = byClass(host, 'changes-diff-note').map(textOf);
  assert.deepStrictEqual(notes, ['Carico…', 'Il file non è più fra le modifiche.', 'File binario: niente righe da mostrare.', 'Diff troppo lungo: mostrate le prime righe.']);
});

ok('vista modifiche: niente modifiche ed errore si dicono', () => {
  const { host, view } = setup();
  view.render(baseState({ files: [], summary: 'Nessuna modifica' }));
  assert.strictEqual(textOf(one(host, 'changes-empty')), 'Nessuna modifica: tutto come all\'ultimo commit.');
  view.render(baseState({ error: 'git: boh' }));
  assert.strictEqual(textOf(one(host, 'changes-error')), 'git: boh');
});

ok('vista modifiche: la ✕ e Esc dentro il pannello lo chiudono', () => {
  const { host, view, calls } = setup();
  view.render(baseState());
  one(host, 'changes-close').onclick();
  fire(one(host, 'changes-panel'), 'keydown', { key: 'Escape' });
  fire(one(host, 'changes-panel'), 'keydown', { key: 'a' });
  assert.strictEqual(calls.close, 2);
});

ok('vista modifiche: la larghezza si applica e si legge', () => {
  const { host, view } = setup();
  view.setWidth(420);
  assert.strictEqual(one(host, 'changes-panel').style.width, '420px');
  assert.ok(view.resizer && view.resizer.classes.has('changes-resizer'));
});

ok('vista modifiche: in modalità Unisci c\'è il piè di pagina con conferma e annulla', () => {
  const merged = [];
  const { host, view, calls } = setup({ onMerge: (yes) => merged.push(yes) });
  view.render(baseState({ files: [file('b.js')], heading: 'Stai per unire', merge: {
    text: 'Il merge si fa nella cartella principale.', confirmLabel: 'Unisci in main', warning: null, canConfirm: true,
  } }));
  assert.strictEqual(textOf(one(host, 'changes-label')), 'Stai per unire');
  const foot = one(host, 'changes-foot');
  assert.strictEqual(foot.hidden, false);
  assert.strictEqual(textOf(one(foot, 'changes-foot-text')), 'Il merge si fa nella cartella principale.');
  assert.strictEqual(one(foot, 'changes-warning').hidden, true);
  const confirm = one(foot, 'changes-confirm');
  assert.strictEqual(textOf(confirm), 'Unisci in main');
  assert.strictEqual(confirm.disabled, false);
  confirm.onclick();
  one(foot, 'changes-cancel').onclick();
  assert.deepStrictEqual(merged, [true, false]);
  assert.strictEqual(calls.close, 0, 'annullare non passa dalla chiusura');
});

ok('vista modifiche: con un avviso la conferma si spegne e l\'avviso si vede', () => {
  const { host, view } = setup({ onMerge: () => {} });
  view.render(baseState({ merge: { text: 't', confirmLabel: 'Unisci in main', warning: '2 file non committati', canConfirm: false } }));
  assert.strictEqual(one(host, 'changes-confirm').disabled, true);
  assert.strictEqual(one(host, 'changes-warning').hidden, false);
  assert.strictEqual(textOf(one(host, 'changes-warning')), '2 file non committati');
  // fuori dalla modalità Unisci il piè di pagina sparisce
  view.render(baseState());
  assert.strictEqual(one(host, 'changes-foot').hidden, true);
  assert.strictEqual(textOf(one(host, 'changes-label')), 'Modifiche');
});

ok('vista modifiche: finché la lettura non arriva dice che sta caricando', () => {
  const { host, view } = setup();
  view.render(baseState({ loading: true }));
  assert.strictEqual(textOf(one(host, 'changes-empty')), 'Carico…');
});
