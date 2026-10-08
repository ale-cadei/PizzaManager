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

const label = (text, clean = false, parts = [{ kind: clean ? 'clean' : 'files', text }]) => ({ visible: true, clean, text, parts });
const COUNTS = [{ kind: 'files', text: '2' }, { kind: 'add', text: '+3' }, { kind: 'del', text: '−1' }];
const baseState = (over = {}) => ({
  label: label('2 · +3 −1', false, COUNTS), open: true, title: 'feat/x da main',
  summary: [{ kind: 'files', text: '2 file' }, { kind: 'add', text: '+3' }, { kind: 'del', text: '−1' }],
  error: null, files: [], expanded: {}, ...over,
});
const file = (path, extra = {}) => ({ path, status: 'M', added: 2, removed: 1, binary: false, ...extra });

ok('vista modifiche: la linguetta mostra il contatore e apre il pannello', () => {
  const { host, view, calls } = setup();
  view.render(baseState({ open: false }));
  const tab = one(host, 'changes-tab');
  assert.strictEqual(tab.hidden, false);
  // un pezzo per colore: verde le aggiunte, rosso le rimozioni
  assert.deepStrictEqual(['changes-n-files', 'changes-n-add', 'changes-n-del'].map((c) => textOf(one(tab, c))), ['2', '+3', '−1']);
  assert.strictEqual(tab.getAttribute('aria-label'), 'Modifiche di questa sessione: 2 · +3 −1 (⌘⇧M)');
  assert.ok(host.classes.has('has-changes-tab'), 'senza la classe la barra di scorrimento finisce sotto la linguetta');
  assert.ok(tab.title.includes('⌘⇧M'), 'la linguetta non dice la scorciatoia');
  assert.strictEqual(one(host, 'changes-panel').hidden, true);
  tab.onclick();
  assert.strictEqual(calls.toggle, 1);
});

ok('vista modifiche: fuori da un repository la linguetta non c\'è; pulito si spegne', () => {
  const { host, view } = setup();
  view.render(baseState({ open: false, label: { visible: false, clean: true, text: '', parts: [] } }));
  assert.strictEqual(one(host, 'changes-tab').hidden, true);
  assert.ok(!host.classes.has('has-changes-tab'));
  view.render(baseState({ open: false, label: label('±0', true) }));
  assert.ok(one(host, 'changes-tab').classes.has('is-clean'));
});

ok('vista modifiche: col pannello aperto la linguetta si nasconde e l\'intestazione dice cosa', () => {
  const { host, view } = setup();
  view.render(baseState());
  assert.strictEqual(one(host, 'changes-panel').hidden, false);
  assert.strictEqual(one(host, 'changes-tab').hidden, true);
  assert.strictEqual(textOf(one(host, 'changes-title')), 'feat/x da main');
  const summary = one(host, 'changes-summary');
  assert.deepStrictEqual(['changes-n-files', 'changes-n-add', 'changes-n-del'].map((c) => textOf(one(summary, c))), ['2 file', '+3', '−1']);
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
  view.render(baseState({ files: [], summary: [{ kind: 'note', text: 'Nessuna modifica' }] }));
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

ok('vista modifiche: un file che si chiama come una proprietà di Object non rompe il pannello', () => {
  const { host, view } = setup();
  assert.doesNotThrow(() => view.render(baseState({ files: [file('constructor'), file('__proto__'), file('toString')] })));
  assert.ok(byClass(host, 'changes-file-row').every((r) => r.getAttribute('aria-expanded') === 'false'));
  assert.strictEqual(byClass(host, 'changes-diff').length, 0);
});

ok('vista modifiche: dopo un ridisegno il fuoco torna sulla riga del file', () => {
  const focusDoc = { createElement, activeElement: null };
  const host = createElement('div');
  const view = createChangesView({ doc: focusDoc, host, shortcut: 'x', onToggle() {}, onClose() {}, onFile() {} });
  view.render(baseState({ files: [file('a'), file('b')] }));
  focusDoc.activeElement = byClass(host, 'changes-file-row')[1];
  view.render(baseState({ files: [file('a'), file('b', { added: 9 })] }));
  const rowB = byClass(host, 'changes-file-row')[1];
  assert.notStrictEqual(rowB, focusDoc.activeElement, 'la riga è nuova');
  assert.strictEqual(rowB.focused, true);
});

ok('ultimo giro: il selettore dice qual è acceso, e spento dice perché', () => {
  const picked = [];
  const { host, view } = setup({ onMode: (m) => picked.push(m) });
  view.render(baseState({ modes: { current: 'commit', turnAvailable: false, turnHint: 'Ancora nessun prompt inviato da questa sessione.' } }));
  const commit = one(host, 'changes-mode-commit');
  const turn = one(host, 'changes-mode-turn');
  assert.strictEqual(one(host, 'changes-modes').hidden, false);
  assert.strictEqual(commit.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(turn.disabled, true);
  assert.strictEqual(turn.title, 'Ancora nessun prompt inviato da questa sessione.');
  view.render(baseState({ modes: { current: 'turn', turnAvailable: true, turnHint: 'x' }, files: [], emptyText: 'Nessuna modifica dall\'ultimo prompt.' }));
  assert.strictEqual(turn.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(textOf(one(host, 'changes-empty')), 'Nessuna modifica dall\'ultimo prompt.');
  commit.onclick();
  turn.onclick();
  assert.deepStrictEqual(picked, ['commit', 'turn']);
  // in modalità Unisci (o senza scelta) il selettore non c'è
  view.render(baseState({ modes: null }));
  assert.strictEqual(one(host, 'changes-modes').hidden, true);
});

ok('vista modifiche: un avviso si vede sopra l\'elenco', () => {
  const { host, view } = setup();
  view.render(baseState({ files: [file('a')], notice: 'Troppi file nuovi' }));
  assert.strictEqual(textOf(one(host, 'changes-notice')), 'Troppi file nuovi');
  assert.strictEqual(one(host, 'changes-body').children[0], one(host, 'changes-notice'));
});

/* ---------- «Da committare» (docs/plans/43) ---------- */

const SECTIONS = [
  { side: 'staged', title: 'Staged', hint: 'nell\'indice', count: 1 },
  { side: 'unstaged', title: 'Non staged', hint: 'fuori', count: 2 },
];

ok('da committare: il terzo pulsante si accende e si sceglie', () => {
  const picked = [];
  const { host, view } = setup({ onMode: (m) => picked.push(m) });
  view.render(baseState({ modes: { current: 'staging', turnAvailable: false, turnHint: 'x' } }));
  const staging = one(host, 'changes-mode-staging');
  assert.strictEqual(staging.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(one(host, 'changes-mode-commit').getAttribute('aria-pressed'), 'false');
  assert.ok(!staging.disabled, '«Da committare» non si spegne mai');
  staging.onclick();
  assert.deepStrictEqual(picked, ['staging']);
});

ok('da committare: le righe stanno sotto la loro sezione, un file a metà in tutte e due', () => {
  const { host, view } = setup();
  const files = [file('a.js', { side: 'staged' }), file('a.js', { side: 'unstaged', added: 7 }), file('n.md', { side: 'unstaged', status: '?' })];
  view.render(baseState({ files, sections: SECTIONS }));
  const body = one(host, 'changes-body');
  const order = body.children.map((c) => (c.classes.has('changes-section') ? `# ${textOf(c)}` : c.children[0].dataset.item));
  assert.deepStrictEqual(order, ['# Staged1', 'staged:a.js', '# Non staged2', 'unstaged:a.js', 'unstaged:n.md']);
  assert.strictEqual(one(host, 'changes-section').title, 'nell\'indice');
});

ok('da committare: una sezione vuota lo dice, e i diff aperti sono per sezione', () => {
  const { host, view, calls } = setup();
  const diff = { ok: true, binary: false, truncated: false, hunks: [{ header: '@@ -1 +1 @@', lines: [{ kind: 'add', oldNo: null, newNo: 1, text: 'fuori stage' }] }] };
  view.render(baseState({
    files: [file('a.js', { side: 'unstaged' })],
    sections: [{ ...SECTIONS[0], count: 0 }, { ...SECTIONS[1], count: 1 }],
    expanded: { 'unstaged:a.js': diff },
  }));
  assert.strictEqual(textOf(one(host, 'changes-section-empty')), 'Nessun file');
  assert.strictEqual(textOf(one(host, 'changes-diff')).includes('fuori stage'), true);
  one(host, 'changes-file-row').onclick();
  assert.deepStrictEqual(calls.files, ['unstaged:a.js']);
});
