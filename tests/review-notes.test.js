const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Commenti sulle righe del diff, inviati all'agente (docs/plans/44 e 57): il
   modello puro. Il testo delle righe è quello dei file dell'utente e arriva
   nel pty: non deve poter contenere sequenze di controllo. */
const R = require('../renderer/review-notes');

const add = (no, text) => ({ kind: 'add', oldNo: null, newNo: no, text });
const del = (no, text) => ({ kind: 'del', oldNo: no, newNo: null, text });
const ctx = (o, n, text) => ({ kind: 'ctx', oldNo: o, newNo: n, text });
const NOTE = { kind: 'note', oldNo: null, newNo: null, text: 'No newline at end of file' };
const diffOf = (...hunks) => ({ ok: true, binary: false, truncated: false, hunks: hunks.map((lines) => ({ header: '@@', lines })) });
const ref = (line) => R.anchorOf('x', line).lines[0];
const range = (path, hunk, a, b) => R.rangeAnchor(path, hunk, ref(a), ref(b));
const bodies = (notes) => notes.map((n) => n.body);

ok('review: l\'ancora di una riga aggiunta o di contesto è il numero nuovo, di una tolta il vecchio', () => {
  assert.deepStrictEqual(R.anchorOf('a.js', add(42, 'x();')), { path: 'a.js', lines: [{ side: 'new', no: 42, kind: 'add', text: 'x();' }] });
  assert.deepStrictEqual(R.anchorOf('a.js', ctx(9, 11, 'y')), { path: 'a.js', lines: [{ side: 'new', no: 11, kind: 'ctx', text: 'y' }] });
  assert.deepStrictEqual(R.anchorOf('a.js', del(10, 'old();')), { path: 'a.js', lines: [{ side: 'old', no: 10, kind: 'del', text: 'old();' }] });
  assert.strictEqual(R.anchorOf('a.js', NOTE), null);
  assert.strictEqual(R.anchorOf('', add(1, 'x')), null);
});

ok('review: un gruppo sono le righe del hunk fra le due, in qualunque ordine, senza le note di git', () => {
  const lines = [ctx(1, 1, 'a'), del(2, 'b'), add(2, 'B'), NOTE, add(3, 'c'), ctx(3, 4, 'd')];
  const hunk = { header: '@@', lines };
  const down = range('a.js', hunk, del(2, 'b'), add(3, 'c'));
  assert.strictEqual(down.ok, true);
  assert.deepStrictEqual(down.anchor.lines.map((l) => `${l.side}:${l.no}`), ['old:2', 'new:2', 'new:3']);
  const up = range('a.js', hunk, add(3, 'c'), del(2, 'b'));
  assert.deepStrictEqual(up.anchor, down.anchor, 'l\'ordine dei clic non conta');
  assert.deepStrictEqual(range('a.js', hunk, add(2, 'B'), add(2, 'B')).anchor, R.anchorOf('a.js', add(2, 'B')), 'da = a: una riga sola');
});

ok('review: un gruppo non scavalca i hunk e ha un limite di righe', () => {
  const hunk = { header: '@@', lines: [add(1, 'a'), add(2, 'b')] };
  const out = range('a.js', hunk, add(1, 'a'), add(50, 'altro hunk'));
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /stesso blocco/);
  const long = { header: '@@', lines: Array.from({ length: R.MAX_LINES + 1 }, (_, i) => add(i + 1, `r${i}`)) };
  const over = range('a.js', long, add(1, 'r0'), add(R.MAX_LINES + 1, `r${R.MAX_LINES}`));
  assert.strictEqual(over.ok, false);
  assert.match(over.error, new RegExp(String(R.MAX_LINES)));
  assert.strictEqual(range('a.js', long, add(1, 'r0'), add(R.MAX_LINES, `r${R.MAX_LINES - 1}`)).ok, true);
});

ok('review: l\'id di una nota è prima e ultima riga, una riga sola come prima', () => {
  const hunk = { header: '@@', lines: [add(12, 'a'), add(13, 'b'), add(14, 'c')] };
  assert.strictEqual(R.noteId(range('lib/a.js', hunk, add(12, 'a'), add(14, 'c')).anchor), 'new:12-new:14:lib/a.js');
  assert.strictEqual(R.noteId(R.anchorOf('lib/a.js', add(12, 'a'))), 'new:12:lib/a.js');
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

ok('review: cambiare il gruppo di una nota la sostituisce, non ne lascia due', () => {
  const hunk = { header: '@@', lines: [add(1, 'a'), add(2, 'b'), add(3, 'c')] };
  const one = R.addNote([], R.anchorOf('a.js', add(1, 'a')), 'n').notes;
  const wider = R.addNote(one, range('a.js', hunk, add(1, 'a'), add(3, 'c')).anchor, 'n2', { replaces: one[0].id });
  assert.deepStrictEqual(wider.notes.map((n) => n.id), ['new:1-new:3:a.js']);
  assert.strictEqual(wider.notes[0].body, 'n2');
  // rifiutata: la nota di prima resta dov'era
  const bad = R.addNote(one, null, 'n2', { replaces: one[0].id });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.notes, one);
});

ok('review: cambiare il gruppo sulle righe esatte di un\'altra nota non la cancella', () => {
  const hunk = { header: '@@', lines: [add(1, 'a'), add(2, 'b'), add(3, 'c')] };
  const group = range('a.js', hunk, add(1, 'a'), add(3, 'c')).anchor;
  const notes = R.addNote(R.addNote([], R.anchorOf('a.js', add(1, 'a')), 'mia').notes, group, 'altra').notes;
  const res = R.addNote(notes, group, 'mia allargata', { replaces: notes[0].id });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, R.TAKEN);
  assert.strictEqual(res.notes, notes);
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
  assert.strictEqual(R.addNote(notes, R.anchorOf('a.js', add(R.MAX_NOTES + 1, 'x')), 'n', { replaces: notes[0].id }).ok, true,
    'spostarne una non ne aggiunge');
  assert.strictEqual(R.addNote([], null, 'n').ok, false);
  const huge = { path: 'a.js', lines: Array.from({ length: R.MAX_LINES + 1 }, (_, i) => ref(add(i + 1, 'x'))) };
  assert.strictEqual(R.addNote([], huge, 'n').ok, false);
});

ok('review: una nota sta sotto la sua ultima riga finché numero e testo coincidono, altrimenti è orfana', () => {
  const lines = [ctx(9, 9, 'a'), add(10, 'x();'), del(10, 'old();')];
  const diff = diffOf(lines);
  let notes = R.addNote([], R.anchorOf('a.js', add(10, 'x();')), 'uno').notes;
  notes = R.addNote(notes, R.anchorOf('a.js', del(10, 'old();')), 'due').notes;
  notes = R.addNote(notes, R.anchorOf('a.js', add(30, 'sparita')), 'tre').notes;
  notes = R.addNote(notes, R.anchorOf('b.js', add(1, 'altro file')), 'quattro').notes;
  const placed = R.placeNotes(notes, 'a.js', diff);
  assert.deepStrictEqual(bodies(placed.endsAt.get(lines[1])), ['uno']);
  assert.deepStrictEqual(bodies(placed.endsAt.get(lines[2])), ['due']);
  assert.strictEqual(placed.endsAt.get(lines[0]), undefined);
  assert.deepStrictEqual(bodies(placed.orphans), ['tre']);
  const changed = R.placeNotes(notes, 'a.js', diffOf([ctx(9, 9, 'a'), add(10, 'cambiata')]));
  assert.deepStrictEqual(bodies(changed.orphans), ['uno', 'due', 'tre'], 'stesso numero, testo diverso: non è più quella riga');
  assert.strictEqual(R.countFor(notes, 'a.js'), 3);
  assert.strictEqual(R.countFor(notes, 'b.js'), 1);
});

ok('review: un gruppo si mostra solo se tutte le sue righe ci sono ancora, di fila', () => {
  const lines = [add(12, 'a'), add(13, 'b'), NOTE, add(14, 'c'), add(15, 'd')];
  const hunk = { header: '@@', lines };
  const notes = R.addNote([], range('a.js', hunk, add(12, 'a'), add(14, 'c')).anchor, 'gruppo').notes;
  const placed = R.placeNotes(notes, 'a.js', diffOf(lines));
  assert.deepStrictEqual(bodies(placed.endsAt.get(lines[3])), ['gruppo'], 'sotto l\'ultima riga');
  assert.deepStrictEqual([0, 1, 3].map((i) => placed.covered.has(lines[i])), [true, true, true]);
  assert.strictEqual(placed.covered.has(lines[4]), false);
  assert.deepStrictEqual(placed.orphans, []);
  // una riga in mezzo cambiata: orfana, non si perde
  const edited = R.placeNotes(notes, 'a.js', diffOf([add(12, 'a'), add(13, 'B'), add(14, 'c')]));
  assert.deepStrictEqual(bodies(edited.orphans), ['gruppo']);
  assert.strictEqual(edited.covered.size, 0);
  // una riga in più in mezzo: le righe non sono più di fila
  const split = R.placeNotes(notes, 'a.js', diffOf([add(12, 'a'), add(13, 'b'), del(7, 'z'), add(14, 'c')]));
  assert.deepStrictEqual(bodies(split.orphans), ['gruppo']);
  // spezzato su due hunk
  const two = R.placeNotes(notes, 'a.js', diffOf([add(12, 'a'), add(13, 'b')], [add(14, 'c')]));
  assert.deepStrictEqual(bodies(two.orphans), ['gruppo']);
});

ok('review: placeOf dice dove sta un\'ancora che si sta scrivendo', () => {
  const lines = [add(1, 'a'), add(2, 'b'), add(3, 'c')];
  const diff = diffOf(lines);
  const at = R.placeOf(range('a.js', diff.hunks[0], add(1, 'a'), add(2, 'b')).anchor, diff);
  assert.strictEqual(at.last, lines[1]);
  assert.deepStrictEqual([...at.lines], [lines[0], lines[1]]);
  assert.strictEqual(R.placeOf(R.anchorOf('a.js', add(9, 'via')), diff), null);
});

ok('review: senza diff caricato non ci sono orfane (non si sa ancora)', () => {
  const notes = R.addNote([], R.anchorOf('a.js', add(3, 'x')), 'n').notes;
  for (const diff of [{ loading: true }, null, { ok: false, error: 'x' }]) {
    assert.deepStrictEqual(R.placeNotes(notes, 'a.js', diff).orphans, []);
  }
});

ok('review: l\'etichetta del gruppo nella textarea', () => {
  const hunk = { header: '@@', lines: [del(5, 'a'), del(6, 'b'), add(12, 'A'), add(13, 'B'), ctx(7, 14, 'c')] };
  assert.strictEqual(R.linesLabel(R.anchorOf('a.js', add(12, 'A')).lines), 'Riga 12');
  assert.strictEqual(R.linesLabel(R.anchorOf('a.js', del(5, 'a')).lines), 'Riga 5 tolta');
  assert.strictEqual(R.linesLabel(range('a.js', hunk, add(12, 'A'), ctx(7, 14, 'c')).anchor.lines), 'Righe 12–14');
  assert.strictEqual(R.linesLabel(range('a.js', hunk, del(5, 'a'), del(6, 'b')).anchor.lines), 'Righe 5–6 tolte');
  assert.strictEqual(R.linesLabel(range('a.js', hunk, del(6, 'b'), add(13, 'B')).anchor.lines), 'Righe 12–13 e 1 tolta');
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

ok('review: un gruppo nel prompt ha l\'intervallo e le righe col segno del diff', () => {
  const hunk = { header: '@@', lines: [del(5, 'vecchia'), del(6, 'vecchia2'), add(12, 'const a = 1;'), ctx(7, 13, 'return a;')] };
  let notes = R.addNote([], range('lib/a.js', hunk, add(12, 'const a = 1;'), ctx(7, 13, 'return a;')).anchor, 'usa una funzione').notes;
  notes = R.addNote(notes, range('lib/b.js', hunk, del(5, 'vecchia'), del(6, 'vecchia2')).anchor, 'perché?').notes;
  notes = R.addNote(notes, range('lib/c.js', hunk, del(6, 'vecchia2'), add(12, 'const a = 1;')).anchor, 'misto').notes;
  assert.strictEqual(R.formatPrompt(notes), [
    'Review delle modifiche, correggi questi punti:',
    '',
    '1. lib/a.js:12-13',
    '   + const a = 1;',
    '     return a;',
    '   usa una funzione',
    '',
    '2. lib/b.js (righe 5-6 tolte)',
    '   - vecchia',
    '   - vecchia2',
    '   perché?',
    '',
    '3. lib/c.js:12 (e 1 riga tolta)',
    '   - vecchia2',
    '   + const a = 1;',
    '   misto',
  ].join('\n'));
});

ok('review: un gruppo lungo si cita fino a 20 righe', () => {
  const lines = Array.from({ length: 25 }, (_, i) => add(i + 1, `r${i + 1}`));
  const hunk = { header: '@@', lines };
  const notes = R.addNote([], range('a.js', hunk, lines[0], lines[24]).anchor, 'troppo').notes;
  const text = R.formatPrompt(notes).split('\n');
  assert.strictEqual(text[2], '1. a.js:1-25');
  assert.strictEqual(text[3], '   + r1');
  assert.strictEqual(text[22], '   + r20');
  assert.strictEqual(text[23], '   … (altre 5 righe)');
  assert.strictEqual(text[24], '   troppo');
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
  const hunk = { header: '@@', lines: [add(1, 'a\x1b[201~'), add(2, 'b\x03')] };
  notes = R.addNote([], range('x.js', hunk, hunk.lines[0], hunk.lines[1]).anchor, 'c').notes;
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(R.formatPrompt(notes)), 'anche le righe di un gruppo');
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

ok('review: il prompt prende un\'intestazione diversa, senza resta quella di sempre', () => {
  const notes = R.addNote([], R.anchorOf('lib/a.js', add(7, 'a')), 'Prima').notes;
  const header = 'Correggi questi punti del codice:';
  assert.deepStrictEqual(R.formatPrompt(notes, { header }).split('\n').slice(0, 3), [header, '', '1. lib/a.js:7']);
  assert.strictEqual(R.formatPrompt(notes).split('\n')[0], 'Review delle modifiche, correggi questi punti:');
  assert.strictEqual(R.formatPrompt([], { header }), '');
});
