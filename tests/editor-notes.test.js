const assert = require('node:assert');
const { test: ok } = require('node:test');
const N = require('../renderer/editor-notes');

/* I commenti della scheda editor (docs/plans/65): solo il modello. Dove
   stanno le righe adesso lo sa l'host di Monaco; qui l'ultimo numero visto. */

const put = (state, rel, from, to, body = 'x', track = null) => N.add(state, { rel, from, to, body, track });

ok('commenti editor: add dà un id nuovo e non tocca lo stato di prima', () => {
  const s0 = N.empty();
  const r = put(s0, 'lib/a.js', 3, 5, '  Qui manca un controllo.  ', 'm1');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.note, { id: 'n1', rel: 'lib/a.js', from: 3, to: 5, body: 'Qui manca un controllo.', track: 'm1' });
  assert.deepStrictEqual(r.state.notes, [r.note]);
  assert.deepStrictEqual(s0, { notes: [], seq: 0 });
  assert.strictEqual(put(r.state, 'lib/a.js', 9, 9).note.id, 'n2');
});

ok('commenti editor: add rifiuta testo vuoto o troppo lungo, righe sbagliate, troppi commenti', () => {
  const s = N.empty();
  assert.deepStrictEqual(put(s, 'a.js', 1, 1, '   '), { ok: false, state: s, error: 'Il commento è vuoto.' });
  assert.match(put(s, 'a.js', 1, 1, 'x'.repeat(2001)).error, /al massimo 2000 caratteri/);
  assert.strictEqual(put(s, 'a.js', 0, 1).error, 'Righe non commentabili.');
  assert.strictEqual(put(s, 'a.js', 5, 4).error, 'Righe non commentabili.');
  assert.strictEqual(put(s, 'a.js', 1.5, 2).error, 'Righe non commentabili.');
  assert.match(put(s, 'a.js', 1, 201).error, /al massimo 200 righe/);
  assert.strictEqual(put(s, 'a.js', 1, 200).ok, true);
  assert.strictEqual(put(s, '', 1, 1).error, 'File non valido.');
  let full = s;
  for (let i = 1; i <= 50; i += 1) full = put(full, 'a.js', i, i).state;
  const r = put(full, 'a.js', 60, 60);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Al massimo 50 commenti/);
  assert.strictEqual(r.state, full);
});

ok('commenti editor: update cambia solo il testo, e rifiuta un testo vuoto o un id che non c è', () => {
  const s = put(N.empty(), 'a.js', 2, 2, 'prima', 'm1').state;
  const r = N.update(s, 'n1', ' dopo ');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.state.notes, [{ id: 'n1', rel: 'a.js', from: 2, to: 2, body: 'dopo', track: 'm1' }]);
  assert.strictEqual(s.notes[0].body, 'prima');
  assert.deepStrictEqual(N.update(s, 'n1', ''), { ok: false, state: s, error: 'Il commento è vuoto.' });
  assert.strictEqual(N.update(s, 'n9', 'x').ok, false);
});

ok('commenti editor: remove e clear; dopo clear gli id non ricominciano', () => {
  let s = put(N.empty(), 'a.js', 1, 1).state;
  s = put(s, 'b.js', 1, 1).state;
  assert.deepStrictEqual(N.remove(s, 'n1').notes.map((n) => n.id), ['n2']);
  assert.strictEqual(N.remove(s, 'n9'), s, 'niente da togliere: stesso stato');
  const cleared = N.clear(s);
  assert.deepStrictEqual(cleared.notes, []);
  assert.strictEqual(put(cleared, 'a.js', 1, 1).note.id, 'n3');
  assert.strictEqual(s.notes.length, 2);
});

ok('commenti editor: forFile in ordine di riga, count per file e in tutto, find', () => {
  let s = N.empty();
  s = put(s, 'a.js', 9, 9).state;
  s = put(s, 'b.js', 1, 1).state;
  s = put(s, 'a.js', 2, 4).state;
  s = put(s, 'a.js', 2, 2).state;
  assert.deepStrictEqual(N.forFile(s, 'a.js').map((n) => [n.from, n.to]), [[2, 2], [2, 4], [9, 9]]);
  assert.deepStrictEqual(s.notes.map((n) => n.id), ['n1', 'n2', 'n3', 'n4'], 'forFile non riordina lo stato');
  assert.strictEqual(N.count(s, 'a.js'), 3);
  assert.strictEqual(N.count(s), 4);
  assert.strictEqual(N.count(s, 'c.js'), 0);
  assert.strictEqual(N.find(s, 'n2').rel, 'b.js');
  assert.strictEqual(N.find(s, 'n9'), null);
});

ok('commenti editor: move segue le righe; uguali, non valide o id sconosciuto: stesso stato', () => {
  const s = put(N.empty(), 'a.js', 3, 5).state;
  const moved = N.move(s, 'n1', { from: 6, to: 8 });
  assert.deepStrictEqual([moved.notes[0].from, moved.notes[0].to], [6, 8]);
  assert.strictEqual(s.notes[0].from, 3);
  assert.strictEqual(N.move(s, 'n1', { from: 3, to: 5 }), s);
  assert.strictEqual(N.move(s, 'n1', { from: 0, to: 2 }), s);
  assert.strictEqual(N.move(s, 'n9', { from: 1, to: 1 }), s);
  assert.strictEqual(N.move(s, 'n1', { from: 1, to: 400 }).notes[0].to, 400, 'righe scritte in mezzo lo allungano anche oltre 200');
});

ok('commenti editor: dropFile toglie i commenti di un file, renameFile li sposta', () => {
  let s = put(N.empty(), 'a.js', 1, 1).state;
  s = put(s, 'b.js', 2, 2).state;
  assert.deepStrictEqual(N.dropFile(s, 'a.js').notes.map((n) => n.rel), ['b.js']);
  assert.strictEqual(N.dropFile(s, 'c.js'), s);
  assert.deepStrictEqual(N.renameFile(s, 'a.js', 'lib/a.js').notes.map((n) => n.rel), ['lib/a.js', 'b.js']);
  assert.strictEqual(N.renameFile(s, 'c.js', 'd.js'), s);
});

ok('commenti editor: etichette delle righe e del conteggio', () => {
  assert.strictEqual(N.labelOf({ from: 12, to: 12 }), 'Riga 12');
  assert.strictEqual(N.labelOf({ from: 12, to: 14 }), 'Righe 12–14');
  assert.strictEqual(N.countLabel(1), '1 commento');
  assert.strictEqual(N.countLabel(3), '3 commenti');
});

ok('commenti editor: toReviewNotes dà righe nuove di contesto col testo di adesso', () => {
  const s = put(N.empty(), 'a.js', 2, 3, 'corto').state;
  const text = (rel, line) => `${rel}:${line}`;
  assert.deepStrictEqual(N.toReviewNotes(s.notes, text), [{
    id: 'n1', path: 'a.js', body: 'corto',
    lines: [{ side: 'new', no: 2, kind: 'ctx', text: 'a.js:2' }, { side: 'new', no: 3, kind: 'ctx', text: 'a.js:3' }],
  }]);
  // Oltre 200 righe formatPrompt la scarterebbe: si citano le prime, l'ultima tiene giusto l'intervallo
  const long = N.move(put(N.empty(), 'a.js', 1, 1).state, 'n1', { from: 1, to: 300 });
  const [n] = N.toReviewNotes(long.notes, () => null);
  assert.strictEqual(n.lines.length, 200);
  assert.deepStrictEqual([n.lines[0].no, n.lines[198].no, n.lines[199].no], [1, 199, 300]);
  assert.strictEqual(n.lines[0].text, '');
});

ok('commenti editor: il prompt ha la sua intestazione, i file in ordine e le righe citate', () => {
  let s = N.empty();
  s = put(s, 'lib/b.js', 4, 4, 'Nome sbagliato.').state;
  s = put(s, 'lib/a.js', 10, 11, 'Togli il doppione.\nE un test.').state;
  s = put(s, 'lib/a.js', 2, 2, 'Manca il null.').state;
  const files = {
    'lib/a.js': ['', '  const x = foo();', '', '', '', '', '', '', '', 'bar();', 'bar();'],
    'lib/b.js': ['', '', '', 'function fo() {}'],
  };
  const text = (rel, line) => files[rel][line - 1];
  assert.strictEqual(N.promptFor(s, text), [
    'Correggi questi punti del codice:',
    '',
    '1. lib/a.js:2',
    '   > const x = foo();',
    '   Manca il null.',
    '',
    '2. lib/a.js:10-11',
    '     bar();',
    '     bar();',
    '   Togli il doppione.',
    '   E un test.',
    '',
    '3. lib/b.js:4',
    '   > function fo() {}',
    '   Nome sbagliato.',
  ].join('\n'));
  assert.strictEqual(N.promptFor(N.empty(), text), '');
});
