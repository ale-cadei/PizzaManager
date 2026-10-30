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
  const order = body.children.map((c) => (c.classes.has('changes-section') ? `# ${textOf(c)}` : one(c, 'changes-file-row').dataset.item));
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

/* Commenti sul diff (docs/plans/44) */
const R = require('../renderer/review-notes');
const reviewDiff = () => ({ ok: true, binary: false, truncated: false, hunks: [{ header: '@@ -1,2 +1,2 @@', lines: [
  { kind: 'ctx', oldNo: 1, newNo: 1, text: 'uno' },
  { kind: 'del', oldNo: 2, newNo: null, text: 'due' },
  { kind: 'add', oldNo: null, newNo: 2, text: 'tre' },
  { kind: 'note', oldNo: null, newNo: null, text: 'No newline at end of file' },
] }] });
const noteOn = (notes, line, body, path = 'a.js') => R.addNote(notes, R.anchorOf(path, line), body).notes;
const reviewState = (review, over = {}) => baseState({ files: [file('a.js')], expanded: { 'a.js': reviewDiff() }, review, ...over });

ok('commenti: senza commenti disponibili nessun ＋ e nessun piè di pagina', () => {
  const { host, view } = setup();
  view.render(reviewState(null));
  assert.strictEqual(byClass(host, 'changes-note-add').length, 0);
  assert.strictEqual(one(host, 'changes-review-foot').hidden, true);
  view.render(reviewState({ enabled: false, notes: [], error: null }));
  assert.strictEqual(byClass(host, 'changes-note-add').length, 0);
});

ok('commenti: ＋ su ogni riga con un numero; si scrive, Ctrl+Invio salva', () => {
  const actions = [];
  const { host, view } = setup({ onReview: (a) => { actions.push(a); return true; } });
  view.render(reviewState({ enabled: true, notes: [], error: null }));
  const plus = byClass(host, 'changes-note-add');
  assert.strictEqual(plus.length, 3, 'la riga «No newline» non si commenta');
  plus[2].onclick();
  const input = one(host, 'changes-comment-input');
  assert.ok(input, 'la textarea non si apre');
  assert.strictEqual(input.focused, true);
  input.value = 'manca il controllo';
  fire(input, 'input');
  const e = fire(input, 'keydown', { key: 'Enter', ctrlKey: true });
  assert.ok(e.defaultPrevented);
  assert.deepStrictEqual(actions, [{ type: 'save', anchor: { path: 'a.js', lines: [{ side: 'new', no: 2, kind: 'add', text: 'tre' }] },
    body: 'manca il controllo', replaces: null }]);
  assert.strictEqual(byClass(host, 'changes-comment-input').length, 0, 'salvata, la textarea si chiude');
});

ok('commenti: Esc nella textarea annulla senza chiudere il pannello', () => {
  const { host, view, calls } = setup({ onReview: () => true });
  view.render(reviewState({ enabled: true, notes: [], error: null }));
  byClass(host, 'changes-note-add')[0].onclick();
  const e = fire(one(host, 'changes-comment-input'), 'keydown', { key: 'Escape' });
  assert.ok(e.propagationStopped);
  assert.strictEqual(byClass(host, 'changes-comment-input').length, 0);
  assert.strictEqual(calls.close, 0);
});

ok('commenti: quello che si sta scrivendo sopravvive a un ridisegno', () => {
  const { host, view } = setup({ onReview: () => true });
  const state = reviewState({ enabled: true, notes: [], error: null });
  view.render(state);
  byClass(host, 'changes-note-add')[0].onclick();
  const input = one(host, 'changes-comment-input');
  input.value = 'a metà';
  fire(input, 'input');
  view.render(state);
  assert.strictEqual(one(host, 'changes-comment-input').value, 'a metà');
});

ok('commenti: mentre si scrive, un ridisegno (l\'agente cambia file) non toglie fuoco e cursore', () => {
  const focusDoc = { createElement, activeElement: null };
  const host = createElement('div');
  const view = createChangesView({ doc: focusDoc, host, shortcut: 'x', onToggle() {}, onClose() {}, onFile() {}, onReview: () => true });
  const state = reviewState({ enabled: true, key: 't1', notes: [], error: null });
  view.render(state);
  byClass(host, 'changes-note-add')[0].onclick();
  const input = one(host, 'changes-comment-input');
  input.value = 'a metà';
  fire(input, 'input');
  Object.assign(input, { selectionStart: 2, selectionEnd: 4 });
  focusDoc.activeElement = input;
  view.render(state);
  const again = one(host, 'changes-comment-input');
  assert.notStrictEqual(again, input, 'la textarea è nuova');
  assert.strictEqual(again.focused, true);
  assert.deepStrictEqual([again.selectionStart, again.selectionEnd], [2, 4]);
  // senza fuoco sulla textarea, il ridisegno non glielo dà (lo ruberebbe al terminale)
  focusDoc.activeElement = null;
  view.render(state);
  assert.strictEqual(one(host, 'changes-comment-input').focused, undefined);
});

ok('commenti: cambiando scheda il commento a metà non segue, né si salva sull\'altra', () => {
  const actions = [];
  const { host, view } = setup({ onReview: (a) => { actions.push(a); return true; } });
  view.render(reviewState({ enabled: true, key: 't1', notes: [], error: null }));
  byClass(host, 'changes-note-add')[0].onclick();
  view.render(reviewState({ enabled: true, key: 't2', notes: [], error: null }));
  assert.strictEqual(byClass(host, 'changes-comment-input').length, 0);
  view.render(reviewState({ enabled: true, key: 't1', notes: [], error: null }));
  assert.strictEqual(byClass(host, 'changes-comment-input').length, 0, 'scartato, non solo nascosto');
  assert.deepStrictEqual(actions, []);
});

ok('commenti: la nota sotto la sua riga, ✎ riapre, ✕ toglie; contatore sul file', () => {
  const actions = [];
  const { host, view } = setup({ onReview: (a) => { actions.push(a); return true; } });
  const line = reviewDiff().hunks[0].lines[1];
  const notes = noteOn([], line, '<b>perché?</b>');
  view.render(reviewState({ enabled: true, notes, error: null }));
  const box = one(host, 'changes-comment');
  assert.strictEqual(textOf(one(box, 'changes-comment-body')), '<b>perché?</b>');
  const lines = byClass(host, 'changes-diff')[0].children;
  assert.strictEqual(lines.indexOf(box), lines.findIndex((l) => l.classes.has('del')) + 1, 'la nota non è sotto la riga tolta');
  assert.strictEqual(textOf(one(host, 'changes-comments')), '💬1');
  one(box, 'changes-comment-edit').onclick();
  assert.strictEqual(one(host, 'changes-comment-input').value, '<b>perché?</b>');
  fire(one(host, 'changes-comment-input'), 'keydown', { key: 'Escape' });
  one(host, 'changes-comment-remove').onclick();
  assert.deepStrictEqual(actions, [{ type: 'remove', id: notes[0].id }]);
  assert.ok(descendants(host).every((n) => !n.html));
});

ok('commenti: una nota la cui riga non c\'è più sta in testa al file', () => {
  const { host, view } = setup({ onReview: () => true });
  const notes = noteOn([], { kind: 'add', oldNo: null, newNo: 30, text: 'sparita' }, 'dove sei?');
  view.render(reviewState({ enabled: true, notes, error: null }));
  const orphan = one(host, 'changes-orphan');
  assert.ok(textOf(orphan).includes('non più nel diff'));
  assert.ok(textOf(orphan).includes('dove sei?'));
  assert.ok(textOf(orphan).includes('sparita'));
});

ok('commenti: piè di pagina con conteggio, Svuota e Invia; l\'errore si vede', () => {
  const actions = [];
  const { host, view } = setup({ onReview: (a) => { actions.push(a); return true; } });
  const [l1, l2] = reviewDiff().hunks[0].lines;
  const notes = noteOn(noteOn([], l1, 'uno'), l2, 'due');
  view.render(reviewState({ enabled: true, notes, error: 'Al massimo 50 commenti' }));
  const foot = one(host, 'changes-review-foot');
  assert.strictEqual(foot.hidden, false);
  assert.strictEqual(textOf(one(foot, 'changes-review-count')), '2 commenti');
  assert.strictEqual(textOf(one(foot, 'changes-review-error')), 'Al massimo 50 commenti');
  one(foot, 'changes-review-clear').onclick();
  one(foot, 'changes-review-send').onclick();
  assert.deepStrictEqual(actions, [{ type: 'clear' }, { type: 'send' }]);
  view.render(reviewState({ enabled: true, notes: noteOn([], l1, 'uno'), error: null }));
  assert.strictEqual(textOf(one(foot, 'changes-review-count')), '1 commento');
  assert.strictEqual(one(foot, 'changes-review-error').hidden, true);
  view.render(reviewState({ enabled: true, notes: [], error: null }));
  assert.strictEqual(foot.hidden, true);
});

/* Commento su un gruppo di righe (docs/plans/57) */
const groupDiff = () => ({ ok: true, binary: false, truncated: false, hunks: [
  { header: '@@ -1,3 +1,3 @@', lines: [
    { kind: 'ctx', oldNo: 1, newNo: 1, text: 'uno' },
    { kind: 'del', oldNo: 2, newNo: null, text: 'due' },
    { kind: 'add', oldNo: null, newNo: 2, text: 'tre' },
    { kind: 'ctx', oldNo: 3, newNo: 3, text: 'quattro' },
  ] },
  { header: '@@ -20 +20 @@', lines: [{ kind: 'add', oldNo: null, newNo: 20, text: 'lontana' }] },
] });
const groupState = (review) => baseState({ files: [file('a.js')], expanded: { 'a.js': groupDiff() }, review });
const rowsOf = (host) => byClass(host, 'changes-line');
const shiftClick = (b) => { fire(b, 'mousedown', { shiftKey: true }); b.onclick({ shiftKey: true }); };

ok('gruppo: Shift+clic allarga, le righe si evidenziano, la textarea va sotto l\'ultima', () => {
  const actions = [];
  const { host, view } = setup({ onReview: (a) => { actions.push(a); return true; } });
  view.render(groupState({ enabled: true, notes: [], error: null }));
  byClass(host, 'changes-note-add')[0].onclick();
  shiftClick(byClass(host, 'changes-note-add')[3]);
  const selected = rowsOf(host).filter((r) => r.classes.has('is-selecting'));
  assert.deepStrictEqual(selected.map((r) => textOf(one(r, 'changes-code'))), ['uno', 'due', 'tre', 'quattro']);
  const lines = byClass(host, 'changes-diff')[0].children;
  const editor = one(host, 'changes-comment-editor');
  assert.strictEqual(lines.indexOf(editor), lines.indexOf(selected[3]) + 1);
  assert.strictEqual(textOf(one(editor, 'changes-comment-lines')), 'Righe 1–3 e 1 tolta');
  assert.strictEqual(one(host, 'changes-comment-input').focused, true);
  one(host, 'changes-comment-input').value = 'tutto il blocco';
  fire(one(host, 'changes-comment-input'), 'input');
  one(host, 'changes-comment-save').onclick();
  assert.strictEqual(actions[0].anchor.lines.length, 4);
  assert.strictEqual(actions[0].body, 'tutto il blocco');
});

ok('gruppo: Shift+clic all\'indietro e Shift+clic su un altro blocco lo dice', () => {
  const { host, view } = setup({ onReview: () => true });
  view.render(groupState({ enabled: true, notes: [], error: null }));
  byClass(host, 'changes-note-add')[2].onclick();
  shiftClick(byClass(host, 'changes-note-add')[1]);
  assert.strictEqual(rowsOf(host).filter((r) => r.classes.has('is-selecting')).length, 2);
  shiftClick(byClass(host, 'changes-note-add')[4]);
  assert.ok(textOf(one(host, 'changes-comment-lines')).includes('stesso blocco'));
  assert.strictEqual(rowsOf(host).filter((r) => r.classes.has('is-selecting')).length, 2, 'il gruppo resta quello di prima');
});

ok('gruppo: Shift+clic senza textarea aperta è un clic normale', () => {
  const { host, view } = setup({ onReview: () => true });
  view.render(groupState({ enabled: true, notes: [], error: null }));
  shiftClick(byClass(host, 'changes-note-add')[1]);
  assert.strictEqual(textOf(one(host, 'changes-comment-lines')), 'Riga 2 tolta');
});

ok('gruppo: Shift sul ＋ non seleziona il testo della pagina', () => {
  const { host, view } = setup({ onReview: () => true });
  view.render(groupState({ enabled: true, notes: [], error: null }));
  const plus = byClass(host, 'changes-note-add')[0];
  assert.strictEqual(fire(plus, 'mousedown', { shiftKey: true }).defaultPrevented, true);
  assert.notStrictEqual(fire(plus, 'mousedown', {}).defaultPrevented, true);
});

ok('gruppo: la nota salvata segna le sue righe e sta sotto l\'ultima; ✎ la riapre e la sostituisce', () => {
  const actions = [];
  const { host, view } = setup({ onReview: (a) => { actions.push(a); return true; } });
  const hunk = groupDiff().hunks[0];
  const range = R.rangeAnchor('a.js', hunk, R.anchorOf('a.js', hunk.lines[0]).lines[0], R.anchorOf('a.js', hunk.lines[2]).lines[0]);
  const notes = R.addNote([], range.anchor, 'tre righe').notes;
  view.render(groupState({ enabled: true, notes, error: null }));
  assert.deepStrictEqual(rowsOf(host).map((r) => r.classes.has('has-note')), [true, true, true, false, false]);
  const lines = byClass(host, 'changes-diff')[0].children;
  const box = one(host, 'changes-comment');
  assert.strictEqual(lines.indexOf(box), lines.indexOf(rowsOf(host)[2]) + 1);
  assert.strictEqual(textOf(one(box, 'changes-comment-range')), 'Righe 1–2 e 1 tolta');
  one(box, 'changes-comment-edit').onclick();
  assert.strictEqual(byClass(host, 'changes-comment').length, 0, 'la nota in modifica non si vede due volte');
  assert.strictEqual(rowsOf(host).filter((r) => r.classes.has('is-selecting')).length, 3);
  shiftClick(byClass(host, 'changes-note-add')[3]);
  one(host, 'changes-comment-save').onclick();
  assert.strictEqual(actions[0].replaces, notes[0].id);
  assert.strictEqual(actions[0].anchor.lines.length, 4);
  assert.strictEqual(actions[0].body, 'tre righe');
});

ok('gruppo: allargare fin sulle righe esatte di un altro commento non lo cancella', () => {
  const actions = [];
  const { host, view } = setup({ onReview: (a) => { actions.push(a); return true; } });
  const hunk = groupDiff().hunks[0];
  const ref = (i) => R.anchorOf('a.js', hunk.lines[i]).lines[0];
  const other = R.rangeAnchor('a.js', hunk, ref(0), ref(3)).anchor;
  const notes = R.addNote(R.addNote([], R.anchorOf('a.js', hunk.lines[0]), 'mia').notes, other, 'altra').notes;
  view.render(groupState({ enabled: true, notes, error: null }));
  byClass(host, 'changes-comment-edit')[0].onclick();
  shiftClick(byClass(host, 'changes-note-add')[3]);
  assert.ok(textOf(one(host, 'changes-comment-lines')).includes('già un altro commento'));
  assert.strictEqual(rowsOf(host).filter((r) => r.classes.has('is-selecting')).length, 1, 'il gruppo resta quello di prima');
  assert.ok(byClass(host, 'changes-comment').some((c) => textOf(c).includes('altra')), 'l\'altro commento resta visibile');
  one(host, 'changes-comment-save').onclick();
  assert.strictEqual(actions[0].anchor.lines.length, 1);
});

ok('gruppo: una nota orfana cita la prima riga e quante altre', () => {
  const { host, view } = setup({ onReview: () => true });
  const gone = { path: 'a.js', lines: [{ side: 'new', no: 40, kind: 'add', text: 'via' }, { side: 'new', no: 41, kind: 'add', text: 'via2' }] };
  const notes = R.addNote([], gone, 'dove?').notes;
  view.render(groupState({ enabled: true, notes, error: null }));
  assert.ok(textOf(one(host, 'changes-orphan')).includes('+40  via  (e un\'altra riga)'));
  one(host, 'changes-comment-edit').onclick();
  assert.ok(one(one(host, 'changes-orphan'), 'changes-comment-input'), 'la textarea resta fra le orfane');
});

/* ---------- Stage, unstage e commit (docs/plans/53) ---------- */

const stagingSections = (staged, unstaged) => [
  { side: 'staged', title: 'Staged', hint: 'h', count: staged },
  { side: 'unstaged', title: 'Non staged', hint: 'h', count: unstaged },
];
const commitOf = (over = {}) => ({
  key: 't1', message: '', canWrite: true, reason: null, canCommit: false,
  commitReason: 'Scrivi il messaggio del commit.', commitLabel: 'Committa 1 file', outcome: null, ...over,
});
const stagingView = (commit, over = {}) => baseState({
  files: [file('a.js', { side: 'staged' }), file('a.js', { side: 'unstaged' }), file('n.md', { side: 'unstaged', status: '?' })],
  sections: stagingSections(1, 2), commit, ...over,
});

ok('commit: ＋ sulle righe non staged, − sulle staged, e «tutti» nelle sezioni', () => {
  const actions = [];
  const { host, view } = setup({ onCommit: (a) => { actions.push(a); } });
  view.render(stagingView(commitOf()));
  const add = byClass(host, 'changes-stage');
  const remove = byClass(host, 'changes-unstage');
  assert.deepStrictEqual([add.length, remove.length], [2, 1]);
  assert.ok(byClass(host, 'changes-file-row').every((r) => !descendants(r).some((n) => n.tag === 'button')), 'niente pulsanti dentro un pulsante');
  add[1].onclick();
  remove[0].onclick();
  one(host, 'changes-stage-all').onclick();
  one(host, 'changes-unstage-all').onclick();
  assert.deepStrictEqual(actions, [
    { type: 'stage', paths: ['n.md'] }, { type: 'unstage', paths: ['a.js'] },
    { type: 'stage-all' }, { type: 'unstage-all' },
  ]);
  assert.strictEqual(add[0].getAttribute('aria-label'), 'Aggiungi a.js allo stage');
});

ok('commit: fuori da «Da committare» niente pulsanti, niente casella', () => {
  const { host, view } = setup({ onCommit: () => {} });
  view.render(baseState({ files: [file('a.js')] }));
  assert.deepStrictEqual([byClass(host, 'changes-stage').length, byClass(host, 'changes-unstage').length], [0, 0]);
  assert.strictEqual(one(host, 'changes-commit-foot').hidden, true);
});

ok('commit: con la sessione che lavora tutto spento, e il motivo si legge', () => {
  const actions = [];
  const { host, view } = setup({ onCommit: (a) => { actions.push(a); } });
  const reason = 'La sessione sta lavorando: aspetta che si fermi.';
  view.render(stagingView(commitOf({ canWrite: false, reason, commitReason: reason, message: 'x' })));
  const buttons = [...byClass(host, 'changes-stage'), ...byClass(host, 'changes-unstage'),
    one(host, 'changes-stage-all'), one(host, 'changes-unstage-all'), one(host, 'changes-commit-btn')];
  assert.ok(buttons.every((b) => b.disabled), 'un pulsante acceso');
  assert.ok(byClass(host, 'changes-stage').every((b) => b.title === reason));
  assert.strictEqual(textOf(one(host, 'changes-commit-reason')), reason);
  fire(one(host, 'changes-commit-input'), 'keydown', { key: 'Enter', ctrlKey: true });
  assert.deepStrictEqual(actions, [], 'Ctrl+Invio non committa');
});

ok('commit: il messaggio va al pannello, Ctrl+Invio e il pulsante committano', () => {
  const actions = [];
  const { host, view } = setup({ onCommit: (a) => { actions.push(a); } });
  view.render(stagingView(commitOf()));
  const foot = one(host, 'changes-commit-foot');
  assert.strictEqual(foot.hidden, false);
  const input = one(foot, 'changes-commit-input');
  assert.strictEqual(input.maxLength, 10000);
  input.value = 'fix: <b>x</b>';
  fire(input, 'input');
  assert.deepStrictEqual(actions, [{ type: 'message', text: 'fix: <b>x</b>' }]);
  view.renderCommit(commitOf({ message: 'fix: <b>x</b>', canCommit: true, commitReason: null, commitLabel: 'Committa 2 file' }));
  const btn = one(foot, 'changes-commit-btn');
  assert.deepStrictEqual([btn.disabled, btn.textContent], [false, 'Committa 2 file']);
  assert.strictEqual(input.value, 'fix: <b>x</b>');
  fire(input, 'keydown', { key: 'Enter', ctrlKey: true, preventDefault() {} });
  btn.onclick();
  assert.deepStrictEqual(actions.slice(1), [{ type: 'commit' }, { type: 'commit' }]);
});

ok('commit: la riga dell\'esito, e l\'output di un hook che fallisce resta testo', () => {
  const { host, view } = setup({ onCommit: () => {} });
  view.render(stagingView(commitOf({ outcome: { ok: true, text: 'Commit abc1234 su main' } })));
  const outcome = one(host, 'changes-commit-outcome');
  assert.deepStrictEqual([outcome.hidden, textOf(outcome), outcome.classes.has('is-error')], [false, 'Commit abc1234 su main', false]);
  view.render(stagingView(commitOf({ outcome: { ok: false, text: '<img src=x onerror=alert(1)>\nlint: 2 errori' } })));
  assert.ok(outcome.classes.has('is-error'));
  assert.ok(textOf(outcome).includes('<img src=x'));
  assert.ok(descendants(host).every((n) => !n.html));
  view.render(stagingView(commitOf()));
  assert.strictEqual(outcome.hidden, true);
});

ok('commit: cambiando scheda il messaggio è quello della scheda, non quello di prima', () => {
  const { host, view } = setup({ onCommit: () => {} });
  view.render(stagingView(commitOf({ key: 't1', message: 'uno' })));
  const input = one(host, 'changes-commit-input');
  assert.strictEqual(input.value, 'uno');
  view.render(stagingView(commitOf({ key: 't2', message: '' })));
  assert.strictEqual(input.value, '');
});

/* ---------- Scartare un file (docs/plans/56) ---------- */

ok('scarta: ↶ solo sulle righe non staged, accanto a ＋, e chiede conferma al pannello', () => {
  const actions = [];
  const { host, view } = setup({ onCommit: (a) => { actions.push(a); } });
  view.render(stagingView(commitOf()));
  const discard = byClass(host, 'changes-discard');
  assert.strictEqual(discard.length, 2, 'le due righe non staged');
  assert.ok(byClass(host, 'changes-file-row').every((r) => !descendants(r).some((n) => n.tag === 'button')), 'niente pulsanti dentro un pulsante');
  assert.strictEqual(discard[0].getAttribute('aria-label'), 'Scarta le modifiche non staged a a.js');
  assert.strictEqual(discard[1].getAttribute('aria-label'), 'Cancella n.md (non è in git)');
  discard[0].onclick();
  discard[1].onclick();
  assert.deepStrictEqual(actions, [
    { type: 'discard-ask', path: 'a.js', untracked: false }, { type: 'discard-ask', path: 'n.md', untracked: true },
  ]);
  view.render(stagingView(commitOf({ canWrite: false, reason: 'La sessione sta lavorando.' })));
  assert.ok(byClass(host, 'changes-discard').every((b) => b.disabled && b.title === 'La sessione sta lavorando.'));
  view.render(baseState({ files: [file('a.js')] }));
  assert.strictEqual(byClass(host, 'changes-discard').length, 0, 'fuori da «Da committare» niente ↶');
});

ok('scarta: il piè di pagina conferma o annulla, poi offre «Annulla lo scarto»', () => {
  const actions = [];
  const { host, view } = setup({ onCommit: (a) => { actions.push(a); } });
  view.render(stagingView(commitOf()));
  const foot = one(host, 'changes-discard-foot');
  assert.strictEqual(foot.hidden, true);
  const ask = { text: 'Scartare <b>a.js</b>?', confirmLabel: 'Scarta', undoLabel: null, canAct: true };
  view.render(stagingView(commitOf(), { discard: ask }));
  assert.strictEqual(foot.hidden, false);
  assert.strictEqual(textOf(one(foot, 'changes-discard-text')), 'Scartare <b>a.js</b>?', 'resta testo');
  assert.strictEqual(one(foot, 'changes-discard-undo').hidden, true);
  one(foot, 'changes-discard-cancel').onclick();
  one(foot, 'changes-discard-confirm').onclick();
  view.render(stagingView(commitOf(), { discard: { ...ask, canAct: false } }));
  assert.strictEqual(one(foot, 'changes-discard-confirm').disabled, true);

  view.render(stagingView(commitOf(), { discard: { text: 'Scartate le modifiche a a.js.', confirmLabel: null, undoLabel: 'Annulla lo scarto', canAct: true } }));
  assert.strictEqual(one(foot, 'changes-discard-confirm').hidden, true);
  assert.strictEqual(textOf(one(foot, 'changes-discard-undo')), 'Annulla lo scarto');
  one(foot, 'changes-discard-undo').onclick();
  one(foot, 'changes-discard-cancel').onclick();
  assert.deepStrictEqual(actions.map((a) => a.type), ['discard-cancel', 'discard', 'discard-undo', 'discard-cancel']);
});

/* ---------- apri nell'editor (docs/plans/64) ---------- */

const openButtons = (host) => byClass(host, 'changes-open-editor');

ok('apri nell editor: il bottone c è sui file modificati e nuovi, non su cancellati, binari e non file', () => {
  const { host, view } = setup({ onOpenFile: () => {} });
  view.render(baseState({ openable: true, files: [
    file('m.js'), file('n.js', { status: '?' }), file('via.js', { status: 'D' }),
    file('logo.png', { binary: true, added: null, removed: null }), file('link', { special: true }),
  ] }));
  const heads = byClass(host, 'changes-file-head');
  assert.deepStrictEqual(heads.map((h) => openButtons(h).length), [1, 1, 0, 0, 0]);
  const b = openButtons(heads[0])[0];
  assert.strictEqual(b.tag, 'button');
  assert.strictEqual(b.type, 'button');
  assert.strictEqual(b.title, "Apri nell'editor");
  assert.strictEqual(b.getAttribute('aria-label'), "Apri nell'editor");
  assert.strictEqual(heads[0].children.indexOf(b), 1, 'subito dopo la riga, non dentro');
  assert.strictEqual(byClass(one(heads[0], 'changes-file-row'), 'changes-open-editor').length, 0);
});

ok('apri nell editor: il click passa il percorso e non apre il diff', () => {
  const opened = [];
  const { host, view, calls } = setup({ onOpenFile: (p) => opened.push(p) });
  view.render(baseState({ openable: true, files: [file('lib/x.js')] }));
  const e = fire(openButtons(host)[0], 'click');
  assert.deepStrictEqual(opened, ['lib/x.js']);
  assert.strictEqual(e.propagationStopped, true);
  assert.deepStrictEqual(calls.files, [], 'il diff resta chiuso');
});

ok('apri nell editor: niente bottone se il pannello non lo chiede o nessuno lo ascolta', () => {
  const noListener = setup();
  noListener.view.render(baseState({ openable: true, files: [file('a.js')] }));
  assert.strictEqual(openButtons(noListener.host).length, 0);
  const notOpenable = setup({ onOpenFile: () => {} });
  notOpenable.view.render(baseState({ files: [file('a.js')] }));
  assert.strictEqual(openButtons(notOpenable.host).length, 0, 'senza openable, come in modalità Unisci');
});

/* Linguetta trascinabile su e giù (docs/plans/68) */
const { clampTabTop } = require('../renderer/changes-view');

ok('linguetta: la posizione resta dentro l\'area dei terminali', () => {
  assert.strictEqual(clampTabTop(200, 600, 100), 200);
  assert.strictEqual(clampTabTop(-50, 600, 100), 4);
  assert.strictEqual(clampTabTop(9999, 600, 100), 496);
  // area più bassa della linguetta: resta in cima
  assert.strictEqual(clampTabTop(300, 50, 100), 4);
  assert.strictEqual(clampTabTop(Number.NaN, 600, 100), 4);
});

function dragSetup(extra = {}) {
  const moves = [];
  const s = setup({ onTabMove: (top) => moves.push(top), ...extra });
  const tab = one(s.host, 'changes-tab');
  s.host.rect = { top: 50, left: 0, width: 800, height: 600 };
  tab.rect = { top: 64, left: 778, width: 22, height: 100 };
  s.view.render(baseState({ open: false }));
  return { ...s, tab, moves };
}

ok('linguetta: trascinata scende col cursore, si ricorda e non apre il pannello', () => {
  const { host, tab, calls, moves } = dragSetup();
  fire(tab, 'pointerdown', { button: 0, clientY: 100, pointerId: 1 });
  fire(tab, 'pointermove', { clientY: 250, pointerId: 1 });
  assert.strictEqual(tab.style.top, '164px');
  assert.ok(host.classes.has('changes-tab-moved'), 'spostata: la barra di scorrimento torna lunga');
  fire(tab, 'pointerup', { clientY: 250, pointerId: 1 });
  assert.deepStrictEqual(moves, [164]);
  tab.onclick();
  assert.strictEqual(calls.toggle, 0, 'il rilascio del trascinamento non è un clic');
  tab.onclick();
  assert.strictEqual(calls.toggle, 1);
});

ok('linguetta: non esce in fondo all\'area', () => {
  const { tab, moves } = dragSetup();
  fire(tab, 'pointerdown', { button: 0, clientY: 100, pointerId: 1 });
  fire(tab, 'pointermove', { clientY: 5000, pointerId: 1 });
  fire(tab, 'pointerup', { clientY: 5000, pointerId: 1 });
  assert.deepStrictEqual(moves, [496]);
});

ok('linguetta: un tremolio sotto i 4 px resta un clic', () => {
  const { host, tab, calls, moves } = dragSetup();
  fire(tab, 'pointerdown', { button: 0, clientY: 100, pointerId: 1 });
  fire(tab, 'pointermove', { clientY: 102, pointerId: 1 });
  fire(tab, 'pointerup', { clientY: 102, pointerId: 1 });
  assert.deepStrictEqual(moves, []);
  assert.ok(!host.classes.has('changes-tab-moved'));
  tab.onclick();
  assert.strictEqual(calls.toggle, 1);
});

ok('linguetta: il tasto destro non trascina', () => {
  const { tab, moves } = dragSetup();
  fire(tab, 'pointerdown', { button: 2, clientY: 100, pointerId: 1 });
  fire(tab, 'pointermove', { clientY: 250, pointerId: 1 });
  fire(tab, 'pointerup', { clientY: 250, pointerId: 1 });
  assert.deepStrictEqual(moves, []);
});

ok('linguetta: la posizione salvata si applica, ristretta alla finestra di adesso', () => {
  const { host, tab } = dragSetup({ tabTop: 9999 });
  assert.strictEqual(tab.style.top, '496px');
  assert.ok(host.classes.has('changes-tab-moved'));
  const fresh = dragSetup({ tabTop: null });
  assert.strictEqual(fresh.tab.style.top || '', '');
  assert.ok(!fresh.host.classes.has('changes-tab-moved'));
});

ok('pannello: con i conflitti l elenco e il piè di pagina sono quelli dei conflitti', () => {
  const M = require('../renderer/conflicts-model');
  const acts = [];
  const { host, view } = setup({ onConflict: (a) => acts.push(a) });
  const c = { ok: true, root: '/r', op: 'merge', what: { incoming: 'feat/x', into: 'main', commit: 'a' },
    files: [{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }], resolved: [] };
  view.render(baseState({ files: [], conflicts: M.viewState(c, {}) }));
  assert.strictEqual(byClass(host, 'conflicts-file').length, 1);
  assert.strictEqual(byClass(host, 'changes-empty').length, 0);
  assert.strictEqual(one(host, 'conflicts-foot').hidden, false);
  fire(byClass(host, 'conflicts-action').find((b) => b.textContent === 'Segna risolto'), 'click');
  assert.deepStrictEqual(acts.map((a) => a.how), ['mark']);
});
