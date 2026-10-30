const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorHost, quietBuiltinDefinitions } = require('../renderer/editor-monaco');

/* Monaco non gira sotto Node: un finto con le sole cose che l'host usa
   (model con versione e decorazioni, editor con view state, comandi e zone). */
function fakeMonaco() {
  const models = [];
  const editor = {
    model: null, view: null, commands: [], disposed: false, options: null,
    zones: new Map(), zoneSeq: 0, layouts: [], overlays: new Map(), layout: null,
    // Gli overlay, al contrario delle zone, restano dopo setModel
    addOverlayWidget(w) { editor.overlays.set(w.getId(), w); },
    removeOverlayWidget(w) { editor.overlays.delete(w.getId()); },
    getLayoutInfo: () => ({ contentLeft: 60, contentWidth: 700 }),
    onDidLayoutChange(f) { editor.layout = f; },
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
    ran: [],
    getAction: (id) => ({ run() { editor.ran.push(id); } }),
    dispose() { editor.disposed = true; },
    selection: null, actions: [], mouse: {},
    getSelection: () => editor.selection,
    // Come Monaco: i tasti di un'azione valgono solo in questo editor, e il disposable li toglie
    addAction(a) { editor.actions.push(a); return { dispose() { editor.actions = editor.actions.filter((x) => x !== a); } }; },
    // Come Monaco: più ascoltatori per evento; mouse.<nome>(e) li chiama tutti
    listeners: {},
    onMouseDown: (f) => listen('down', f),
    onMouseUp: (f) => listen('up', f),
    onMouseMove: (f) => listen('move', f),
    onMouseLeave: (f) => listen('leave', f),
    onKeyUp: (f) => listen('keyup', f),
    // mouse.cursor({position}) come Monaco quando il cursore si sposta (docs/plans/73)
    onDidChangeCursorPosition: (f) => listen('cursor', f),
    messages: [],
    getPosition: () => editor.position,
    getContribution: (id) => (id === 'editor.contrib.messageController'
      ? { showMessage: (text, at) => editor.messages.push([text, at]) } : null),
  };
  function listen(name, f) {
    (editor.listeners[name] = editor.listeners[name] || []).push(f);
    editor.mouse[name] = (e) => editor.listeners[name].forEach((g) => g(e));
  }
  function createModel(text, language, uri) {
    const listeners = [];
    let value = text;
    let version = 1;
    const live = new Map(); // id → { range, options }: le decorazioni che ci sono adesso
    const lines = () => value.split(/\r\n|\r|\n/);
    const change = () => { version += 1; listeners.forEach((f) => f()); };
    const top = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
    const m = {
      uri, language, disposed: false, eol: null, decorations: [], removed: [], live,
      getValue: () => value,
      getLineCount: () => lines().length,
      getLineContent: (n) => lines()[n - 1],
      getLineMaxColumn: (n) => lines()[n - 1].length + 1,
      getWordAtPosition: ({ lineNumber, column }) => {
        const text = lines()[lineNumber - 1] || '';
        for (const w of text.matchAll(/[\w$]+/g)) {
          if (column >= w.index + 1 && column <= w.index + w[0].length + 1) {
            return { word: w[0], startColumn: w.index + 1, endColumn: w.index + w[0].length + 1 };
          }
        }
        return null;
      },
      getAlternativeVersionId: () => version,
      getFullModelRange: () => ({ all: true }),
      // Tutto il testo sostituito: le decorazioni si schiacciano in cima, come in Monaco
      pushEditOperations: (_sel, ops) => {
        value = ops[0].text;
        for (const [id, d] of live) live.set(id, { ...d, range: top });
        change();
      },
      pushEOL: (eol) => { m.eol = eol; },
      pushStackElement: () => { m.stack = (m.stack || 0) + 1; },
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
      MouseTargetType: { GUTTER_GLYPH_MARGIN: 2, GUTTER_LINE_NUMBERS: 3, GUTTER_LINE_DECORATIONS: 4, GUTTER_VIEW_ZONE: 5, CONTENT_TEXT: 6, CONTENT_EMPTY: 7, CONTENT_VIEW_ZONE: 8 },
    },
    Uri: { from: (o) => ({ ...o }) },
    KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
    KeyCode: { KeyS: 49, KeyF: 36, KeyH: 38 },
  };
  return { monaco, editor, models };
}

// Il minimo di DOM che l'host usa per le zone: div con stile e figli
const fakeDoc = { createElement: (tag) => ({ tag, style: {}, children: [], appendChild(c) { this.children.push(c); } }) };
const plainStyle = (node) => ({ ...node.style });
const overlaid = (fake) => [...fake.editor.overlays.values()].map((w) => w.getDomNode().children[0]);

function host(extra = {}) {
  const fake = fakeMonaco();
  const changes = [];
  const saved = [];
  const h = createEditorHost({ monaco: fake.monaco, container: { ownerDocument: fakeDoc }, fontSize: 13,
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

ok('open e rename: linguaggio dal nome del file, il resto lo sceglie Monaco', () => {
  const { h, fake } = host();
  h.open('.env', 'A=1');
  h.open('src/a.js', 'x');
  assert.deepStrictEqual(fake.models.map((m) => m.language), ['dotenv', undefined]);
  h.rename('.env', 'Makefile');
  assert.strictEqual(fake.models[2].language, 'makefile');
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

const KEY = { save: 2048 | 49, saveAll: 2048 | 1024 | 49, find: 2048 | 36, replace: 2048 | 38, replaceMac: 2048 | 512 | 36 };
const command = (fake, keys) => fake.editor.actions.find((a) => (a.keybindings || []).includes(keys));
const menuActions = (fake) => fake.editor.actions.filter((a) => a.contextMenuGroupId);

ok('Ctrl+S salva il file attivo, Ctrl+Shift+S tutti; due host non si pestano gli URI', () => {
  const { h, fake, saved } = host();
  h.open('a.js', 'x');
  command(fake, KEY.save).run(fake.editor);
  command(fake, KEY.saveAll).run(fake.editor);
  assert.deepStrictEqual(saved, ['a.js', '*']);
  const other = host();
  other.h.open('a.js', 'x');
  assert.notStrictEqual(other.fake.models[0].uri.authority, fake.models[0].uri.authority);
});

// addCommand di Monaco è globale e non si toglie: il tasto andava all'ultimo
// host creato. Le azioni sono dell'editor e si tolgono chiudendo l'host.
ok('scorciatoie come azioni dell editor, tolte con dispose', () => {
  const { h, fake } = host();
  assert.strictEqual(fake.editor.commands.length, 0, 'niente addCommand globali');
  for (const k of Object.values(KEY)) assert.ok(command(fake, k), `tasto ${k}`);
  h.dispose();
  assert.deepStrictEqual(fake.editor.actions, [], 'anche le voci dei commenti');
});

ok('Ctrl+F e Ctrl+H aprono cerca e sostituisci su questo editor', () => {
  const { fake } = host();
  command(fake, KEY.find).run(fake.editor);
  command(fake, KEY.replace).run(fake.editor);
  command(fake, KEY.replaceMac).run(fake.editor);
  assert.deepStrictEqual(fake.editor.ran,
    ['actions.find', 'editor.action.startFindReplaceAction', 'editor.action.startFindReplaceAction']);
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

/* ---------- conflitti (docs/plans/69): righe colorate ed editText ---------- */

ok('monaco: setConflicts colora marcatori, nostro, base e loro a righe intere', () => {
  const { h, fake } = host();
  h.open('a.txt', 'x\n<<<<<<< HEAD\nn\n||||||| b\nb\n=======\nl\n>>>>>>> f\n');
  const blocks = [{ start: 2, base: 4, sep: 6, end: 8, ours: [3, 3], theirs: [7, 7] }];
  h.setConflicts('a.txt', blocks);
  const m = fake.models[0];
  const classes = m.decorations.map((d) => [d.range.startLineNumber, d.range.endLineNumber, d.options.className]);
  assert.deepStrictEqual(classes.sort((a, b) => a[0] - b[0]), [
    [2, 2, 'editor-conflict-marker'], [3, 3, 'editor-conflict-ours'], [4, 5, 'editor-conflict-base'],
    [6, 6, 'editor-conflict-marker'], [7, 7, 'editor-conflict-theirs'], [8, 8, 'editor-conflict-marker'],
  ]);
  assert.ok(m.decorations.every((d) => d.options.isWholeLine));
  h.setConflicts('a.txt', []);
  assert.deepStrictEqual(m.decorations, []);
});

ok('monaco: editText è una modifica dell utente, annullabile, che lascia il file sporco', () => {
  const { h, fake, changes } = host();
  h.open('a.txt', 'uno\n');
  h.editText('a.txt', 'due\n');
  assert.strictEqual(h.getText('a.txt'), 'due\n');
  assert.strictEqual(h.isDirty('a.txt'), true);
  assert.deepStrictEqual(changes.pop(), ['a.txt', true]);
  assert.strictEqual(fake.models[0].stack, 2); // un passo di undo tutto suo
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
  const node = { tag: 'div', style: {} };
  assert.ok(h.addZone('a.js', 3, node, 80));
  assert.strictEqual(fake.editor.zones.size, 0, 'a.js non è davanti');
  h.activate('a.js');
  assert.deepStrictEqual([...fake.editor.zones.values()].map((z) => [z.afterLineNumber, z.heightInPx]), [[3, 80]]);
  assert.deepStrictEqual(overlaid(fake), [node], 'il nodo sta in un overlay, sopra lo strato delle righe');
  h.activate('b.js');
  assert.strictEqual(fake.editor.zones.size, 0);
  assert.strictEqual(fake.editor.overlays.size, 0, 'l overlay va via con la zona');
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
  h.addZone('a.js', 3, { style: {} });
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
  const id = h.addZone('a.js', 2, { style: {} });
  const [[vid, zone]] = [...fake.editor.zones];
  h.resizeZone(id, 120);
  assert.strictEqual(zone.heightInPx, 120);
  assert.deepStrictEqual(fake.editor.layouts, [vid]);
  h.resizeZone(id, 120);
  h.resizeZone(id, 0);
  assert.deepStrictEqual(fake.editor.layouts, [vid], 'stessa altezza o zero: niente');
  h.removeZone(id);
  assert.strictEqual(fake.editor.zones.size, 0);
  assert.strictEqual(fake.editor.overlays.size, 0, 'e il suo overlay');
  assert.strictEqual(fake.models[0].live.size, 0, 'anche il segno della zona va via');
  h.removeZone(id);
});

ok('addZone: il nodo va all altezza della zona e largo quanto il testo', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const node = { style: {} };
  h.addZone('a.js', 2, node);
  const [zone] = fake.editor.zones.values();
  assert.notStrictEqual(zone.domNode, node, 'la zona tiene solo lo spazio');
  zone.onDomNodeTop(140);
  assert.deepStrictEqual(plainStyle(node), { position: 'absolute', top: '140px', left: '60px', width: '700px' });
  fake.editor.getLayoutInfo = () => ({ contentLeft: 50, contentWidth: 400 });
  fake.editor.layout();
  assert.strictEqual(node.style.width, '400px', 'la finestra cambia: il riquadro la segue');
});

ok('replaceText: i segni restano agli stessi numeri, fermati all ultima riga', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const a = h.trackLines('a.js', 2, 3);
  const b = h.trackLines('a.js', 4, 5);
  h.addZone('a.js', 5, { style: {} });
  h.replaceText('a.js', 'uno\ndue\ntre\nquattro');
  assert.deepStrictEqual(h.linesOf(a), { from: 2, to: 3 });
  assert.deepStrictEqual(h.linesOf(b), { from: 4, to: 4 });
  assert.strictEqual([...fake.editor.zones.values()][0].afterLineNumber, 4);
});

ok('rename: segni e zone passano al model nuovo con gli stessi id', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const id = h.trackLines('a.js', 2, 2);
  const node = { style: {} };
  const zone = h.addZone('a.js', 2, node);
  h.rename('a.js', 'b.js');
  assert.deepStrictEqual(h.linesOf(id), { from: 2, to: 2 });
  assert.strictEqual(fake.models[1].live.size, 2, 'il segno e quello della zona');
  assert.strictEqual(fake.editor.zones.size, 1);
  assert.deepStrictEqual(overlaid(fake), [node], 'un overlay solo, non quello vecchio in più');
  h.removeZone(zone);
  assert.strictEqual(fake.editor.zones.size, 0);
  assert.strictEqual(fake.editor.overlays.size, 0);
  assert.strictEqual(h.lineText('b.js', 2), 'due');
});

ok('close: segni e zone del file si scordano', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const id = h.trackLines('a.js', 1, 1);
  const zone = h.addZone('a.js', 1, { style: {} });
  h.close('a.js');
  assert.strictEqual(h.linesOf(id), null);
  assert.strictEqual(fake.editor.overlays.size, 0, 'setModel(null) non toglie gli overlay: li toglie close');
  h.removeZone(zone);
  h.open('a.js', TEXT);
  assert.strictEqual(h.linesOf(id), null, 'un file riaperto non ritrova i segni di prima');
});

const sel = (startLineNumber, endLineNumber, endColumn = 5, startColumn = 1) => ({ startLineNumber, startColumn, endLineNumber, endColumn });
const at = (type, lineNumber) => ({ target: { type, position: lineNumber ? { lineNumber, column: 1 } : null }, event: { leftButton: true, rightButton: false } });

ok('commenti: margine dei glifi acceso e due voci nel menu, una per la riga e una per la selezione', () => {
  const asked = [];
  const { h, fake } = host({ onComment: (...a) => asked.push(a) });
  assert.strictEqual(fake.editor.options.glyphMargin, true);
  assert.deepStrictEqual(menuActions(fake).map((a) => [a.id, a.label, a.precondition, a.contextMenuGroupId]), [
    ['aisess.comment-line', 'Commenta riga', '!editorHasSelection', 'navigation'],
    ['aisess.comment-selection', 'Commenta selezione', 'editorHasSelection', 'navigation'],
  ]);
  const [line, selection] = menuActions(fake);
  line.run(fake.editor);
  assert.deepStrictEqual(asked, [], 'nessun file aperto');
  h.open('a.js', TEXT);
  fake.editor.selection = sel(4, 4, 3, 3); // il cursore, fermo sulla riga 4
  line.run(fake.editor);
  fake.editor.selection = sel(3, 6, 1); // fino a inizio riga 6: la 6 non c'è
  selection.run(fake.editor);
  fake.editor.selection = sel(2, 3, 2);
  selection.run(fake.editor);
  assert.deepStrictEqual(asked, [['a.js', 4, 4], ['a.js', 3, 5], ['a.js', 2, 3]]);
});

ok('commenti: il clic nel margine dei glifi commenta la riga, o la selezione se ci sta dentro', () => {
  const asked = [];
  const { h, fake } = host({ onComment: (...a) => asked.push(a) });
  h.open('a.js', TEXT);
  const down = fake.editor.mouse.down;
  down(at(2, 3));
  fake.editor.selection = sel(2, 4);
  down(at(2, 3));
  down(at(2, 5));
  down({ ...at(2, 1), event: { rightButton: true } });
  down(at(6, 1)); // nel testo: è un clic nel testo
  down(at(2, 0));
  assert.deepStrictEqual(asked, [['a.js', 3, 3], ['a.js', 2, 4], ['a.js', 5, 5]]);
});

ok('commenti: il clic centrale (tasto rotella) nel margine dei glifi non apre un commento', () => {
  const asked = [];
  const { h, fake } = host({ onComment: (...a) => asked.push(a) });
  h.open('a.js', TEXT);
  const down = fake.editor.mouse.down;
  down({ ...at(2, 3), event: { leftButton: false, rightButton: false } });
  assert.deepStrictEqual(asked, []);
});

ok('commenti: il «+» compare nel margine della riga sotto il mouse e sparisce uscendo', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const m = fake.models[0];
  const plus = () => [...m.live.values()].filter((d) => d.options.glyphMarginClassName === 'editor-note-add').map((d) => d.range.startLineNumber);
  fake.editor.mouse.move(at(6, 2));
  assert.deepStrictEqual(plus(), [2]);
  fake.editor.mouse.move(at(2, 2));
  assert.strictEqual(m.removed.length, 1, 'stessa riga: non si ridisegna');
  fake.editor.mouse.move(at(3, 4));
  assert.deepStrictEqual(plus(), [4]);
  fake.editor.mouse.move(at(8, 4));
  assert.deepStrictEqual(plus(), [], 'sopra una zona dei commenti no');
  fake.editor.mouse.move(at(6, 1));
  fake.editor.mouse.leave({});
  assert.deepStrictEqual(plus(), []);
});

/* ---------- vai alla definizione (docs/plans/71) ---------- */

const CODE = 'const a = helper(1);\nfunction helper() {}\n';
const onText = (lineNumber, column, event = {}) => ({
  target: { type: 6, position: { lineNumber, column } },
  event: { leftButton: true, rightButton: false, ctrlKey: false, metaKey: false, ...event },
});
const ctrl = (lineNumber, column, more = {}) => onText(lineNumber, column, { ctrlKey: true, ...more });
const click = (fake, e) => { fake.editor.mouse.down(e); fake.editor.mouse.up(e); };

ok('definizione: Ctrl+click su un nome chiama onDefinition con file, nome e inizio del nome', () => {
  const asked = [];
  const { h, fake } = host({ onDefinition: (...a) => asked.push(a) });
  h.open('src/a.js', CODE);
  click(fake, ctrl(1, 13));
  assert.deepStrictEqual(asked, [['src/a.js', 'helper', { lineNumber: 1, column: 11 }]]);
});

ok('definizione: senza modificatore, col modificatore sbagliato, fuori dal testo o trascinando non parte', () => {
  const asked = [];
  const { h, fake } = host({ onDefinition: (...a) => asked.push(a) });
  h.open('a.js', CODE);
  click(fake, onText(1, 13));
  click(fake, onText(1, 13, { metaKey: true })); // ⌘ fuori dal Mac
  click(fake, { ...ctrl(1, 13), target: { type: 3, position: { lineNumber: 1, column: 1 } } });
  click(fake, ctrl(1, 9)); // `=`: nessun nome
  click(fake, ctrl(1, 13, { leftButton: false }));
  fake.editor.mouse.down(ctrl(1, 13));
  fake.editor.mouse.up(ctrl(2, 12)); // giù su un nome, su altrove
  assert.deepStrictEqual(asked, []);
});

ok('definizione: su Mac vale ⌘, non Ctrl', () => {
  const asked = [];
  const { h, fake } = host({ onDefinition: (...a) => asked.push(a), mac: true });
  h.open('a.js', CODE);
  click(fake, ctrl(1, 13));
  click(fake, onText(2, 12, { metaKey: true }));
  assert.deepStrictEqual(asked, [['a.js', 'helper', { lineNumber: 2, column: 10 }]]);
});

ok('definizione: col modificatore il nome sotto il mouse si sottolinea, senza no', () => {
  const { h, fake } = host({ onDefinition: () => {} });
  h.open('a.js', CODE);
  const m = fake.models[0];
  const links = () => [...m.live.values()].filter((d) => d.options.inlineClassName === 'editor-def-link').map((d) => d.range);
  fake.editor.mouse.move(ctrl(1, 13));
  assert.deepStrictEqual(links(), [{ startLineNumber: 1, startColumn: 11, endLineNumber: 1, endColumn: 17 }]);
  fake.editor.mouse.move(onText(1, 13));
  assert.deepStrictEqual(links(), []);
  fake.editor.mouse.move(ctrl(2, 3));
  assert.strictEqual(links().length, 1);
  fake.editor.mouse.keyup({ ctrlKey: false });
  assert.deepStrictEqual(links(), [], 'Ctrl lasciato');
  fake.editor.mouse.move(ctrl(2, 3));
  fake.editor.mouse.leave({});
  assert.deepStrictEqual(links(), []);
});

ok('definizione: senza onDefinition l\'host non ascolta il Ctrl+click', () => {
  const { h, fake } = host();
  h.open('a.js', CODE);
  assert.ok(!fake.editor.listeners.up, 'nessun onMouseUp');
  assert.ok(!fake.editor.listeners.keyup, 'nessun onKeyUp');
});

ok('definizione: reveal porta alla colonna, hint usa il fumetto di Monaco', () => {
  const { h, fake } = host();
  h.open('a.js', CODE);
  h.reveal('a.js', 2, 10);
  assert.deepStrictEqual(fake.editor.position, { lineNumber: 2, column: 10 });
  h.reveal('a.js', 1);
  assert.deepStrictEqual(fake.editor.position, { lineNumber: 1, column: 1 }, 'senza colonna: inizio riga');
  assert.strictEqual(h.hint('Nessuna definizione'), true);
  assert.deepStrictEqual(fake.editor.messages, [['Nessuna definizione', { lineNumber: 1, column: 1 }]]);
  fake.editor.getContribution = () => null;
  assert.strictEqual(h.hint('x'), false);
});

ok('definizione: le definizioni interne di Monaco (JS/TS, CSS) si spengono, il resto della configurazione resta', () => {
  const defaults = (name) => ({
    name, modeConfiguration: { completionItems: true, definitions: true, hovers: true }, set: null,
    setModeConfiguration(c) { this.set = c; },
  });
  const monaco = {
    typescript: { typescriptDefaults: defaults('ts'), javascriptDefaults: defaults('js') },
    css: { cssDefaults: defaults('css'), scssDefaults: defaults('scss'), lessDefaults: defaults('less') },
  };
  quietBuiltinDefinitions(monaco);
  for (const d of [...Object.values(monaco.typescript), ...Object.values(monaco.css)]) {
    assert.deepStrictEqual(d.set, { completionItems: true, definitions: false, hovers: true }, d.name);
  }
  quietBuiltinDefinitions({}); // senza i linguaggi non si rompe
});

/* Chi ha toccato la riga del cursore (docs/plans/73) */
const blameOf = (fake) => [...fake.editor.model.live.values()].filter((d) => d.options.after);

ok('riga del cursore: onCursorLine col file e la riga, anche quando il testo cambia', () => {
  const lines = [];
  const { h, fake } = host({ onCursorLine: (...a) => lines.push(a) });
  h.open('a.js', 'uno\ndue');
  lines.length = 0;
  fake.editor.position = { lineNumber: 2, column: 1 };
  fake.editor.mouse.cursor({ position: fake.editor.position });
  fake.editor.model.type('!');
  assert.deepStrictEqual(lines, [['a.js', 2], ['a.js', 2]]);
});

ok('riga del cursore: aprire un file lo dice subito', () => {
  const lines = [];
  const { h, fake } = host({ onCursorLine: (...a) => lines.push(a) });
  fake.editor.position = { lineNumber: 1, column: 1 };
  h.open('a.js', 'uno');
  assert.deepStrictEqual(lines, [['a.js', 1]]);
});

ok('setLineInfo: testo in fondo alla riga, fumetto con markdown escapato; uno solo alla volta', () => {
  const { h, fake } = host({ onCursorLine: () => {} });
  h.open('a.js', 'uno\ndue');
  h.setLineInfo('a.js', 2, { text: 'Ale, ieri · fix', title: 'abc · *Ale*\n\n[x](http://y)' });
  const [d] = blameOf(fake);
  assert.deepStrictEqual(d.range, { startLineNumber: 2, startColumn: 4, endLineNumber: 2, endColumn: 4 });
  assert.strictEqual(d.options.after.content.trimStart(), 'Ale, ieri · fix');
  assert.strictEqual(d.options.after.inlineClassName, 'editor-blame');
  assert.strictEqual(d.options.showIfCollapsed, true);
  assert.strictEqual(d.options.hoverMessage.value, 'abc · \\*Ale\\*  \n  \n\\[x\\]\\(http://y\\)');
  h.setLineInfo('a.js', 1, { text: 'b', title: 'b' });
  assert.deepStrictEqual(blameOf(fake).map((x) => x.range.startLineNumber), [1]);
  h.setLineInfo('a.js', 1, null);
  assert.deepStrictEqual(blameOf(fake), []);
});

ok('setLineInfo: si toglie quando il cursore si sposta o il testo cambia; file non attivo o riga fuori → niente', () => {
  const { h, fake } = host({ onCursorLine: () => {} });
  h.open('b.js', 'b');
  h.open('a.js', 'uno\ndue');
  h.setLineInfo('a.js', 1, { text: 't', title: 't' });
  fake.editor.position = { lineNumber: 2, column: 1 };
  fake.editor.mouse.cursor({ position: fake.editor.position });
  assert.deepStrictEqual(blameOf(fake), []);
  h.setLineInfo('a.js', 1, { text: 't', title: 't' });
  fake.editor.model.type('x');
  assert.deepStrictEqual(blameOf(fake), []);
  h.setLineInfo('b.js', 1, { text: 't', title: 't' });
  h.setLineInfo('a.js', 9, { text: 't', title: 't' });
  assert.deepStrictEqual(blameOf(fake), []);
});

ok('version: cambia col testo, per la cache della scheda', () => {
  const { h, fake } = host();
  h.open('a.js', 'uno');
  const v = h.version('a.js');
  fake.editor.model.type('x');
  assert.notStrictEqual(h.version('a.js'), v);
  assert.strictEqual(h.version('nessuno.js'), null);
});
