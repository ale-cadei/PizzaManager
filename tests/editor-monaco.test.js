const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorHost } = require('../renderer/editor-monaco');

/* Monaco non gira sotto Node: un finto con le sole cose che l'host usa
   (model con versione e decorazioni, editor con view state, comandi e zone). */
function fakeMonaco() {
  const models = [];
  const editor = {
    model: null, view: null, commands: [], disposed: false, options: null,
    zones: new Map(), zoneSeq: 0, layouts: [],
    // Come Monaco: un model diverso è una vista nuova, senza le zone di prima
    setModel(m) { if (m !== editor.model) editor.zones = new Map(); editor.model = m; },
    changeViewZones(cb) {
      cb({
        addZone: (z) => { const id = `vz${++editor.zoneSeq}`; editor.zones.set(id, z); return id; },
        removeZone: (id) => { editor.zones.delete(id); },
        layoutZone: (id) => { editor.layouts.push(id); },
      });
    },
    saveViewState: () => ({ of: editor.model && editor.model.uri.path }),
    restoreViewState(v) { editor.view = v; },
    focus() {}, updateOptions() {},
    position: null, revealed: [],
    setPosition(p) { editor.position = p; },
    revealLineInCenter(line) { editor.revealed.push(line); },
    addCommand(keys, fn) { editor.commands.push({ keys, fn }); },
    dispose() { editor.disposed = true; },
  };
  function createModel(text, _language, uri) {
    const listeners = [];
    let value = text;
    let version = 1;
    const live = new Map(); // id → { range, options }: le decorazioni che ci sono adesso
    const lines = () => value.split(/\r\n|\r|\n/);
    const change = () => { version += 1; listeners.forEach((f) => f()); };
    const top = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
    const m = {
      uri, disposed: false, eol: null, decorations: [], removed: [], live,
      getValue: () => value,
      getLineCount: () => lines().length,
      getLineContent: (n) => lines()[n - 1],
      getLineMaxColumn: (n) => lines()[n - 1].length + 1,
      getAlternativeVersionId: () => version,
      getFullModelRange: () => ({ all: true }),
      // Tutto il testo sostituito: le decorazioni si schiacciano in cima, come in Monaco
      pushEditOperations: (_sel, ops) => {
        value = ops[0].text;
        for (const [id, d] of live) live.set(id, { ...d, range: top });
        change();
      },
      pushEOL: (eol) => { m.eol = eol; },
      deltaDecorations: (old, decorations) => {
        m.removed.push(old);
        m.decorations = decorations;
        old.forEach((id) => live.delete(id));
        const ids = decorations.map((_, i) => `${uri.path}#${m.removed.length}.${i}`);
        ids.forEach((id, i) => live.set(id, decorations[i]));
        return ids;
      },
      getDecorationRange: (id) => (live.has(id) ? live.get(id).range : null),
      onDidChangeContent: (f) => { listeners.push(f); return { dispose: () => listeners.splice(listeners.indexOf(f), 1) }; },
      dispose: () => { m.disposed = true; },
      type: (s) => { value += s; change(); }, // solo per il test: l'utente che scrive
      // solo per il test: `count` righe nuove sotto la riga `after`; le decorazioni sotto scendono
      insertLines: (after, count) => {
        const ls = lines();
        value = [...ls.slice(0, after), ...Array(count).fill('nuova'), ...ls.slice(after)].join('\n');
        const down = (n) => (n > after ? n + count : n);
        for (const [id, d] of live) {
          live.set(id, { ...d, range: { ...d.range, startLineNumber: down(d.range.startLineNumber), endLineNumber: down(d.range.endLineNumber) } });
        }
        change();
      },
    };
    models.push(m);
    return m;
  }
  const monaco = {
    editor: {
      create: (_container, options) => { editor.options = options; return editor; },
      createModel,
      EndOfLineSequence: { LF: 0, CRLF: 1 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
    Uri: { from: (o) => ({ ...o }) },
    KeyMod: { CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { KeyS: 49 },
  };
  return { monaco, editor, models };
}

function host(extra = {}) {
  const fake = fakeMonaco();
  const changes = [];
  const saved = [];
  const h = createEditorHost({ monaco: fake.monaco, container: {}, fontSize: 13,
    onChange: (rel, dirty) => changes.push([rel, dirty]), onSave: (rel) => saved.push(rel), onSaveAll: () => saved.push('*'), ...extra });
  return { h, fake, changes, saved };
}

ok('open: un model per file, URI col percorso relativo, pulito', () => {
  const { h, fake } = host();
  h.open('src/a.js', 'ciao');
  assert.strictEqual(fake.editor.model.uri.path, '/src/a.js');
  assert.strictEqual(fake.editor.model.uri.scheme, 'aisess');
  assert.strictEqual(h.isDirty('src/a.js'), false);
  assert.strictEqual(h.current(), 'src/a.js');
  h.open('src/a.js', 'altro');
  assert.strictEqual(fake.models.length, 1);
});

ok('scrivere sporca, markSaved pulisce, e lo dice a onChange', () => {
  const changes = [];
  const { h, fake } = host({ onChange: (...args) => changes.push(args) });
  h.open('a.js', 'x');
  fake.models[0].type('y');
  assert.strictEqual(h.isDirty('a.js'), true);
  h.markSaved('a.js');
  assert.strictEqual(h.isDirty('a.js'), false);
  // terzo argomento: il testo è cambiato (scrivendo sì, salvando no)
  assert.deepStrictEqual(changes, [['a.js', true, true], ['a.js', false, false]]);
});

ok('activate: conserva e rimette cursore e scroll', () => {
  const { h, fake } = host();
  h.open('a.js', '1');
  assert.strictEqual(fake.editor.view, null); // appena aperto: niente da rimettere
  h.open('b.js', '2');
  h.activate('a.js');
  assert.strictEqual(fake.editor.model, fake.models[0]);
  assert.deepStrictEqual(fake.editor.view, { of: '/a.js' });
});

ok('replaceText: testo nuovo, pulito, a capo del file', () => {
  const { h, fake } = host();
  h.open('a.js', 'vecchio');
  h.replaceText('a.js', 'nuovo\r\n');
  assert.strictEqual(h.getText('a.js'), 'nuovo\r\n');
  assert.strictEqual(h.isDirty('a.js'), false);
  assert.strictEqual(fake.models[0].eol, 1);
});

ok('rename: model nuovo col nome nuovo, sporco se lo era, vecchio buttato', () => {
  const { h, fake } = host();
  h.open('a.js', 'x');
  fake.models[0].type('y');
  h.rename('a.js', 'lib/b.ts');
  assert.strictEqual(fake.models[0].disposed, true);
  assert.strictEqual(fake.editor.model.uri.path, '/lib/b.ts');
  assert.strictEqual(h.getText('lib/b.ts'), 'xy');
  assert.strictEqual(h.isDirty('lib/b.ts'), true);
  assert.strictEqual(h.getText('a.js'), null);
  assert.strictEqual(h.current(), 'lib/b.ts');
});

ok('close e dispose buttano i model', () => {
  const { h, fake } = host();
  h.open('a.js', 'x');
  h.open('b.js', 'y');
  h.close('b.js');
  assert.strictEqual(fake.models[1].disposed, true);
  assert.strictEqual(fake.editor.model, null);
  h.dispose();
  assert.strictEqual(fake.models[0].disposed, true);
  assert.strictEqual(fake.editor.disposed, true);
});

ok('Ctrl+S salva il file attivo, Ctrl+Shift+S tutti; due host non si pestano gli URI', () => {
  const { h, fake, saved } = host();
  h.open('a.js', 'x');
  for (const c of fake.editor.commands) c.fn();
  assert.deepStrictEqual(saved, ['a.js', '*']);
  const other = host();
  other.h.open('a.js', 'x');
  assert.notStrictEqual(other.fake.models[0].uri.authority, fake.models[0].uri.authority);
});

ok('lineCount: le righe del model, 0 per un file non aperto', () => {
  const { h } = host();
  h.open('a.js', '1\n2\n3\n');
  assert.strictEqual(h.lineCount('a.js'), 4);
  assert.strictEqual(h.lineCount('nessuno.js'), 0);
});

ok('setGutter: barrette come decorazioni del margine, sostituite a ogni chiamata', () => {
  const { h, fake } = host();
  h.open('a.js', '1\n2\n3');
  const m = fake.models[0];
  h.setGutter('a.js', [{ kind: 'add', from: 1, to: 2 }, { kind: 'mod', from: 3, to: 3 }, { kind: 'del', after: 0 }, { kind: 'del', after: 2 }, { kind: 'del', after: 3 }]);
  assert.deepStrictEqual(m.decorations, [
    { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-add' } },
    { range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-mod' } },
    { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-del editor-gutter-del-top' } },
    { range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-del' } },
    // dopo l'ultima riga: dentro la riga, come in cima
    { range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-del editor-gutter-del-end' } },
  ]);
  h.setGutter('a.js', null);
  assert.deepStrictEqual(m.decorations, []);
  // la seconda chiamata toglie gli id dati dalla prima
  assert.deepStrictEqual(m.removed, [[], ['/a.js#1.0', '/a.js#1.1', '/a.js#1.2', '/a.js#1.3', '/a.js#1.4']]);
  h.setGutter('nessuno.js', [{ kind: 'add', from: 1, to: 1 }]); // file non aperto: niente
});

ok('reveal: attiva il file, cursore a inizio riga, riga al centro', () => {
  const { h, fake } = host();
  h.open('a.js', '1');
  h.open('b.js', '2');
  h.reveal('a.js', 7);
  assert.strictEqual(h.current(), 'a.js');
  assert.deepStrictEqual(fake.editor.position, { lineNumber: 7, column: 1 });
  assert.deepStrictEqual(fake.editor.revealed, [7]);
  h.reveal('nessuno.js', 3);
  assert.deepStrictEqual(fake.editor.revealed, [7]);
});

/* ---------- commenti (docs/plans/65): segni sulle righe e zone sotto ---------- */

const TEXT = 'uno\ndue\ntre\nquattro\ncinque';

ok('trackLines: righe intere col fondo dei commenti, che seguono il testo', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const m = fake.models[0];
  const id = h.trackLines('a.js', 2, 3);
  const [deco] = m.decorations;
  assert.deepStrictEqual(deco.range, { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 4 });
  assert.deepStrictEqual(deco.options, { isWholeLine: true, className: 'editor-note-line', stickiness: 1 });
  assert.deepStrictEqual(h.linesOf(id), { from: 2, to: 3 });
  m.insertLines(1, 2);
  assert.deepStrictEqual(h.linesOf(id), { from: 4, to: 5 });
  h.untrack(id);
  assert.strictEqual(h.linesOf(id), null);
  assert.strictEqual(m.live.size, 0);
});

ok('trackLines: righe fuori dal file o file non aperto, niente segno', () => {
  const { h } = host();
  h.open('a.js', TEXT);
  assert.strictEqual(h.trackLines('a.js', 0, 1), null);
  assert.strictEqual(h.trackLines('a.js', 3, 2), null);
  assert.strictEqual(h.trackLines('a.js', 6, 6), null);
  assert.strictEqual(h.trackLines('b.js', 1, 1), null);
  assert.deepStrictEqual(h.linesOf(h.trackLines('a.js', 4, 99)), { from: 4, to: 5 }, 'la fine si ferma all ultima riga');
  assert.strictEqual(h.linesOf('sconosciuto'), null);
  h.untrack('sconosciuto');
});

ok('lineText: il testo di una riga, null fuori dal file', () => {
  const { h } = host();
  h.open('a.js', TEXT);
  assert.strictEqual(h.lineText('a.js', 2), 'due');
  assert.strictEqual(h.lineText('a.js', 6), null);
  assert.strictEqual(h.lineText('a.js', 0), null);
  assert.strictEqual(h.lineText('b.js', 1), null);
});

ok('addZone: sotto la riga nel file attivo; negli altri compare quando si attivano', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  h.open('b.js', TEXT);
  const node = { tag: 'div' };
  assert.ok(h.addZone('a.js', 3, node, 80));
  assert.strictEqual(fake.editor.zones.size, 0, 'a.js non è davanti');
  h.activate('a.js');
  assert.deepStrictEqual([...fake.editor.zones.values()].map((z) => [z.afterLineNumber, z.heightInPx, z.domNode]), [[3, 80, node]]);
  h.activate('b.js');
  assert.strictEqual(fake.editor.zones.size, 0);
  h.activate('a.js');
  assert.strictEqual(fake.editor.zones.size, 1, 'setModel butta le zone: si rimettono');
  h.activate('a.js');
  assert.strictEqual(fake.editor.zones.size, 1, 'lo stesso file non le raddoppia');
  assert.strictEqual(h.addZone('a.js', 9, node), null);
  assert.strictEqual(h.addZone('c.js', 1, node), null);
});

ok('addZone: segue la riga quando il testo cambia sopra', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  h.addZone('a.js', 3, {});
  const [[vid, zone]] = [...fake.editor.zones];
  assert.strictEqual(zone.heightInPx, 64, 'altezza di partenza');
  fake.models[0].insertLines(1, 2);
  assert.strictEqual(zone.afterLineNumber, 5);
  assert.deepStrictEqual(fake.editor.layouts, [vid]);
  fake.models[0].insertLines(9, 1);
  assert.deepStrictEqual(fake.editor.layouts, [vid], 'righe sotto la zona: non si muove');
});

ok('removeZone e resizeZone', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const id = h.addZone('a.js', 2, {});
  const [[vid, zone]] = [...fake.editor.zones];
  h.resizeZone(id, 120);
  assert.strictEqual(zone.heightInPx, 120);
  assert.deepStrictEqual(fake.editor.layouts, [vid]);
  h.resizeZone(id, 120);
  h.resizeZone(id, 0);
  assert.deepStrictEqual(fake.editor.layouts, [vid], 'stessa altezza o zero: niente');
  h.removeZone(id);
  assert.strictEqual(fake.editor.zones.size, 0);
  assert.strictEqual(fake.models[0].live.size, 0, 'anche il segno della zona va via');
  h.removeZone(id);
});

ok('replaceText: i segni restano agli stessi numeri, fermati all ultima riga', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const a = h.trackLines('a.js', 2, 3);
  const b = h.trackLines('a.js', 4, 5);
  h.addZone('a.js', 5, {});
  h.replaceText('a.js', 'uno\ndue\ntre\nquattro');
  assert.deepStrictEqual(h.linesOf(a), { from: 2, to: 3 });
  assert.deepStrictEqual(h.linesOf(b), { from: 4, to: 4 });
  assert.strictEqual([...fake.editor.zones.values()][0].afterLineNumber, 4);
});

ok('rename: segni e zone passano al model nuovo con gli stessi id', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const id = h.trackLines('a.js', 2, 2);
  const node = {};
  const zone = h.addZone('a.js', 2, node);
  h.rename('a.js', 'b.js');
  assert.deepStrictEqual(h.linesOf(id), { from: 2, to: 2 });
  assert.strictEqual(fake.models[1].live.size, 2, 'il segno e quello della zona');
  assert.deepStrictEqual([...fake.editor.zones.values()].map((z) => z.domNode), [node]);
  h.removeZone(zone);
  assert.strictEqual(fake.editor.zones.size, 0);
  assert.strictEqual(h.lineText('b.js', 2), 'due');
});

ok('close: segni e zone del file si scordano', () => {
  const { h } = host();
  h.open('a.js', TEXT);
  const id = h.trackLines('a.js', 1, 1);
  const zone = h.addZone('a.js', 1, {});
  h.close('a.js');
  assert.strictEqual(h.linesOf(id), null);
  h.removeZone(zone);
  h.open('a.js', TEXT);
  assert.strictEqual(h.linesOf(id), null, 'un file riaperto non ritrova i segni di prima');
});
