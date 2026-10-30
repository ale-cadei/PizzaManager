const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Schermo diviso (docs/plans/75-schermo-diviso.md): le regole stanno in un
   modulo puro, il DOM lo tocca split-view.js. */
const Split = require('../renderer/split-layout');

const RECT = { width: 1000, height: 600 };
const row = (first, second, ratio = 0.5) => ({ orientation: 'row', first, second, ratio });

ok('split: la zona è il bordo più vicino al cursore', () => {
  assert.strictEqual(Split.dropZone(RECT, 950, 300), 'right');
  assert.strictEqual(Split.dropZone(RECT, 40, 300), 'left');
  assert.strictEqual(Split.dropZone(RECT, 500, 20), 'top');
  assert.strictEqual(Split.dropZone(RECT, 500, 590), 'bottom');
  // Distanze in proporzione: in un'area larga il bordo basso vince prima
  assert.strictEqual(Split.dropZone(RECT, 700, 500), 'bottom');
});

ok('split: una card trascinata divide con la sessione in primo piano', () => {
  assert.deepStrictEqual(Split.place(null, { focusedId: 'a', droppedId: 'b', zone: 'right' }), row('a', 'b'));
  assert.deepStrictEqual(Split.place(null, { focusedId: 'a', droppedId: 'b', zone: 'left' }), row('b', 'a'));
  assert.deepStrictEqual(Split.place(null, { focusedId: 'a', droppedId: 'b', zone: 'top' }),
    { orientation: 'column', first: 'b', second: 'a', ratio: 0.5 });
  assert.deepStrictEqual(Split.place(null, { focusedId: 'a', droppedId: 'b', zone: 'bottom' }),
    { orientation: 'column', first: 'a', second: 'b', ratio: 0.5 });
});

ok('split: niente divisione con sé stessa o senza sessione in primo piano', () => {
  assert.strictEqual(Split.place(null, { focusedId: 'a', droppedId: 'a', zone: 'right' }), null);
  assert.strictEqual(Split.place(null, { focusedId: null, droppedId: 'b', zone: 'right' }), null);
  assert.strictEqual(Split.canPlace(null, { focusedId: 'a', droppedId: 'a' }), false);
  assert.strictEqual(Split.canPlace(null, { focusedId: 'a', droppedId: 'b' }), true);
});

ok('split: una card già divisa cambia lato e orientamento, la proporzione resta se l orientamento è lo stesso', () => {
  const s = row('a', 'b', 0.3);
  assert.deepStrictEqual(Split.place(s, { focusedId: 'a', droppedId: 'b', zone: 'left' }), row('b', 'a', 0.3));
  // Anche trascinando quella in primo piano
  assert.deepStrictEqual(Split.place(s, { focusedId: 'a', droppedId: 'a', zone: 'right' }), row('b', 'a', 0.3));
  assert.deepStrictEqual(Split.place(s, { focusedId: 'a', droppedId: 'b', zone: 'bottom' }),
    { orientation: 'column', first: 'a', second: 'b', ratio: 0.5 });
});

ok('split: una terza card sostituisce la metà non in primo piano', () => {
  const s = row('a', 'b', 0.4);
  assert.deepStrictEqual(Split.place(s, { focusedId: 'a', droppedId: 'c', zone: 'right' }), row('a', 'c', 0.4));
  assert.deepStrictEqual(Split.place(s, { focusedId: 'b', droppedId: 'c', zone: 'left' }), row('c', 'b', 0.4));
});

ok('split: place non tocca lo stato ricevuto', () => {
  const s = Object.freeze(row('a', 'b'));
  Split.place(s, { focusedId: 'a', droppedId: 'b', zone: 'left' });
  assert.deepStrictEqual(s, row('a', 'b'));
});

ok('split: lo scambio inverte le sessioni e lascia la linea dov è', () => {
  const s = row('a', 'b', 0.3);
  assert.deepStrictEqual(Split.swap(s), row('b', 'a', 0.3));
  assert.deepStrictEqual(s, row('a', 'b', 0.3));
  assert.strictEqual(Split.swap(null), null);
});

ok('split: chiudere una delle due toglie la divisione, una estranea no', () => {
  const s = row('a', 'b');
  assert.strictEqual(Split.without(s, 'a'), null);
  assert.strictEqual(Split.without(s, 'b'), null);
  assert.strictEqual(Split.without(s, 'c'), s);
  assert.strictEqual(Split.partnerOf(s, 'a'), 'b');
  assert.strictEqual(Split.partnerOf(s, 'b'), 'a');
  assert.strictEqual(Split.partnerOf(s, 'c'), null);
  assert.strictEqual(Split.partnerOf(null, 'a'), null);
});

ok('split: click su una card dentro la divisione la porta solo in primo piano', () => {
  const s = row('a', 'b');
  assert.deepStrictEqual(Split.select(s, 'a', 'b'), { state: s, focus: 'b' });
});

ok('split: click su una card fuori prende il posto della metà in primo piano', () => {
  const s = row('a', 'b', 0.6);
  assert.deepStrictEqual(Split.select(s, 'a', 'c'), { state: row('c', 'b', 0.6), focus: 'c' });
  assert.deepStrictEqual(Split.select(s, 'b', 'c'), { state: row('a', 'c', 0.6), focus: 'c' });
  assert.deepStrictEqual(Split.select(null, 'a', 'c'), { state: null, focus: 'c' });
});

ok('split: sessioni visibili', () => {
  assert.deepStrictEqual(Split.visibleIds(row('a', 'b'), 'a'), ['a', 'b']);
  assert.deepStrictEqual(Split.visibleIds(null, 'a'), ['a']);
  assert.deepStrictEqual(Split.visibleIds(null, null), []);
});

ok('split: proporzione limitata e letta dal puntatore', () => {
  assert.strictEqual(Split.clampRatio(0.05), Split.MIN_RATIO);
  assert.strictEqual(Split.clampRatio(0.95), Split.MAX_RATIO);
  assert.strictEqual(Split.clampRatio(0.42), 0.42);
  assert.strictEqual(Split.clampRatio(NaN), 0.5);
  const rect = { left: 100, top: 50, width: 1000, height: 400 };
  assert.strictEqual(Split.ratioAt(rect, 'row', 400, 0), 0.3);
  assert.strictEqual(Split.ratioAt(rect, 'column', 0, 250), 0.5);
  assert.strictEqual(Split.ratioAt(rect, 'row', 0, 0), Split.MIN_RATIO);
});

ok('split: si salva con chiavi stabili e si ritrova al riavvio', () => {
  const keys = { a: ['claude:c1', 'tmux:s1'], b: ['git:/repo'] };
  const saved = Split.toSaved(row('a', 'b', 0.35), (id) => keys[id]);
  assert.deepStrictEqual(saved, { orientation: 'row', ratio: 0.35, first: keys.a, second: keys.b });
  const raw = JSON.stringify(saved);
  const reopened = [{ id: 'x', keys: ['git:/repo'] }, { id: 'y', keys: ['tmux:s1'] }, { id: 'z', keys: [] }];
  assert.deepStrictEqual(Split.fromSaved(Split.parseSaved(raw), reopened), row('y', 'x', 0.35));
});

ok('split: non si salva una metà senza chiavi, non si ricompone se ne manca una', () => {
  assert.strictEqual(Split.toSaved(row('a', 'b'), (id) => (id === 'a' ? ['k'] : [])), null);
  assert.strictEqual(Split.toSaved(null, () => ['k']), null);
  const saved = { orientation: 'row', ratio: 0.5, first: ['k1'], second: ['k2'] };
  assert.strictEqual(Split.fromSaved(saved, [{ id: 'x', keys: ['k1'] }]), null);
  // Le due chiavi sulla stessa scheda non fanno una divisione
  assert.strictEqual(Split.fromSaved(saved, [{ id: 'x', keys: ['k1', 'k2'] }]), null);
});

ok('split: dati salvati malformati non rompono niente', () => {
  for (const raw of [null, '', 'non json', '42', '{"orientation":"diag","ratio":0.5,"first":["a"],"second":["b"]}',
    '{"orientation":"row","ratio":"x","first":["a"],"second":["b"]}', '{"orientation":"row","ratio":0.5,"first":"a","second":["b"]}']) {
    assert.strictEqual(Split.parseSaved(raw), null, String(raw));
  }
  assert.strictEqual(Split.fromSaved(null, [{ id: 'x', keys: ['a'] }]), null);
  // Una proporzione fuori misura rientra nei limiti
  const p = Split.parseSaved('{"orientation":"column","ratio":3,"first":["a"],"second":["b"]}');
  assert.strictEqual(p.ratio, Split.MAX_RATIO);
});
