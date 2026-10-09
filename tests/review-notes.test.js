const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Commenti sulle righe del diff, inviati all'agente (docs/plans/44): il
   modello puro. Il testo delle righe è quello dei file dell'utente e arriva
   nel pty: non deve poter contenere sequenze di controllo. */
const R = require('../renderer/review-notes');

const add = (no, text) => ({ kind: 'add', oldNo: null, newNo: no, text });
const del = (no, text) => ({ kind: 'del', oldNo: no, newNo: null, text });
const ctx = (o, n, text) => ({ kind: 'ctx', oldNo: o, newNo: n, text });
const diffOf = (...lines) => ({ ok: true, binary: false, truncated: false, hunks: [{ header: '@@', lines }] });

ok('review: l\'ancora di una riga aggiunta o di contesto è il numero nuovo, di una tolta il vecchio', () => {
  assert.deepStrictEqual(R.anchorOf('a.js', add(42, 'x();')), { path: 'a.js', side: 'new', no: 42, text: 'x();' });
  assert.deepStrictEqual(R.anchorOf('a.js', ctx(9, 11, 'y')), { path: 'a.js', side: 'new', no: 11, text: 'y' });
  assert.deepStrictEqual(R.anchorOf('a.js', del(10, 'old();')), { path: 'a.js', side: 'old', no: 10, text: 'old();' });
  assert.strictEqual(R.anchorOf('a.js', { kind: 'note', oldNo: null, newNo: null, text: 'No newline' }), null);
  assert.strictEqual(R.anchorOf('', add(1, 'x')), null);
});

ok('review: aggiungere, riscrivere e togliere restituiscono un elenco nuovo', () => {
  const a = R.anchorOf('a.js', add(42, 'x();'));
  const first = R.addNote([], a, '  manca il controllo  ');
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.notes.length, 1);
  assert.strictEqual(first.notes[0].body, 'manca il controllo');
  assert.strictEqual(first.notes[0].id, R.noteId(a));
  const again = R.addNote(first.notes, a, 'altro');
  assert.strictEqual(again.notes.length, 1, 'stessa riga: si riscrive, non si duplica');
  assert.strictEqual(again.notes[0].body, 'altro');
  assert.strictEqual(first.notes[0].body, 'manca il controllo', 'l\'elenco di prima non si tocca');
  const gone = R.removeNote(again.notes, again.notes[0].id);
  assert.deepStrictEqual(gone, []);
  assert.strictEqual(again.notes.length, 1);
});

ok('review: nota vuota o fuori dai limiti rifiutata con un motivo', () => {
  const a = R.anchorOf('a.js', add(1, 'x'));
  const empty = R.addNote([], a, '   ');
  assert.strictEqual(empty.ok, false);
  assert.ok(empty.error);
  const long = R.addNote([], a, 'x'.repeat(R.MAX_BODY + 1));
  assert.strictEqual(long.ok, false);
  let notes = [];
  for (let i = 1; i <= R.MAX_NOTES; i++) notes = R.addNote(notes, R.anchorOf('a.js', add(i, 'x')), 'n').notes;
  const over = R.addNote(notes, R.anchorOf('a.js', add(R.MAX_NOTES + 1, 'x')), 'n');
  assert.strictEqual(over.ok, false);
  // riscrivere una nota che c'è già resta permesso anche al limite
  assert.strictEqual(R.addNote(notes, R.anchorOf('a.js', add(1, 'x')), 'nuova').ok, true);
  assert.strictEqual(R.addNote([], null, 'n').ok, false);
});

ok('review: una nota sta sulla sua riga finché numero e testo coincidono, altrimenti è orfana', () => {
  const diff = diffOf(ctx(9, 9, 'a'), add(10, 'x();'), del(10, 'old();'));
  let notes = R.addNote([], R.anchorOf('a.js', add(10, 'x();')), 'uno').notes;
  notes = R.addNote(notes, R.anchorOf('a.js', del(10, 'old();')), 'due').notes;
  notes = R.addNote(notes, R.anchorOf('a.js', add(30, 'sparita')), 'tre').notes;
  notes = R.addNote(notes, R.anchorOf('b.js', add(1, 'altro file')), 'quattro').notes;
  assert.deepStrictEqual(R.notesAt(notes, 'a.js', add(10, 'x();')).map((n) => n.body), ['uno']);
  assert.deepStrictEqual(R.notesAt(notes, 'a.js', del(10, 'old();')).map((n) => n.body), ['due']);
  assert.deepStrictEqual(R.notesAt(notes, 'a.js', add(10, 'cambiata')), [], 'stesso numero, testo diverso: non è più quella riga');
  assert.deepStrictEqual(R.orphansOf(notes, 'a.js', diff).map((n) => n.body), ['tre']);
  assert.strictEqual(R.countFor(notes, 'a.js'), 3);
  assert.strictEqual(R.countFor(notes, 'b.js'), 1);
});

ok('review: senza diff caricato non ci sono orfane (non si sa ancora)', () => {
  const notes = R.addNote([], R.anchorOf('a.js', add(3, 'x')), 'n').notes;
  assert.deepStrictEqual(R.orphansOf(notes, 'a.js', { loading: true }), []);
  assert.deepStrictEqual(R.orphansOf(notes, 'a.js', null), []);
  assert.deepStrictEqual(R.orphansOf(notes, 'a.js', { ok: false, error: 'x' }), []);
});

ok('review: il prompt elenca le note per file e riga, citando la riga', () => {
  let notes = R.addNote([], R.anchorOf('lib/b.js', del(10, '  old();')), 'Perché è stata tolta?').notes;
  notes = R.addNote(notes, R.anchorOf('lib/a.js', add(42, '    const x = foo();')), 'Qui manca il controllo su null.\nE un test.').notes;
  notes = R.addNote(notes, R.anchorOf('lib/a.js', add(7, 'a')), 'Prima').notes;
  assert.strictEqual(R.formatPrompt(notes), [
    'Review delle modifiche, correggi questi punti:',
    '',
    '1. lib/a.js:7',
    '   > a',
    '   Prima',
    '',
    '2. lib/a.js:42',
    '   > const x = foo();',
    '   Qui manca il controllo su null.',
    '   E un test.',
    '',
    '3. lib/b.js (riga 10 tolta)',
    '   > old();',
    '   Perché è stata tolta?',
  ].join('\n'));
  assert.strictEqual(R.formatPrompt([]), '');
});

ok('review: dal testo spariscono ESC e gli altri caratteri di controllo, restano a capo e tab', () => {
  assert.strictEqual(R.sanitize('a\x1b[201~b\x07c\x9bd\r\ne\tf\x7f'), 'a[201~bcd\ne\tf');
  // la fine dell'incolla dentro un file non deve arrivare al pty
  let notes = R.addNote([], R.anchorOf('x.js', add(1, 'evil\x1b[201~\x03rm -rf ~\r')), 'nota\x1b]0;t\x07').notes;
  const text = R.formatPrompt(notes);
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text), JSON.stringify(text));
  assert.ok(text.includes('evil[201~rm -rf ~'));
  notes = R.addNote([], R.anchorOf('x\x1b.js', add(1, 'a')), 'b').notes;
  assert.ok(!R.formatPrompt(notes).includes('\x1b'), 'anche il percorso');
});

ok('review: l\'incolla si prepara solo se l\'agente accetta un incolla su più righe', () => {
  const notes = R.addNote([], R.anchorOf('a.js', add(1, 'x')), 'n').notes;
  const ready = R.pasteFor(notes, { bracketed: true });
  assert.deepStrictEqual(ready, { ok: true, text: R.formatPrompt(notes) });
  // senza bracketed paste ogni a capo arriverebbe come Invio
  const raw = R.pasteFor(notes, { bracketed: false });
  assert.strictEqual(raw.ok, false);
  assert.match(raw.error, /Invio/);
  assert.strictEqual(R.pasteFor([], { bracketed: true }).ok, false);
});
