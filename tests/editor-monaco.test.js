const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorHost } = require('../renderer/editor-monaco');

/* Monaco non gira sotto Node: un finto con le sole cose che l'host usa
   (model con versione, editor con view state e comandi). */
function fakeMonaco() {
  const models = [];
  const editor = {
    model: null, view: null, commands: [], disposed: false,
    setModel(m) { editor.model = m; },
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
    const change = () => { version += 1; listeners.forEach((f) => f()); };
    const m = {
      uri, disposed: false, eol: null, decorations: [], removed: [],
      getValue: () => value,
      getLineCount: () => value.split(/\r\n|\r|\n/).length,
      getAlternativeVersionId: () => version,
      getFullModelRange: () => ({ all: true }),
      pushEditOperations: (_sel, ops) => { value = ops[0].text; change(); },
      pushEOL: (eol) => { m.eol = eol; },
      deltaDecorations: (old, decorations) => {
        m.removed.push(old);
        m.decorations = decorations;
        return decorations.map((_, i) => `${uri.path}#${m.removed.length}.${i}`);
      },
      onDidChangeContent: (f) => { listeners.push(f); return { dispose: () => listeners.splice(listeners.indexOf(f), 1) }; },
      dispose: () => { m.disposed = true; },
      type: (s) => { value += s; change(); }, // solo per il test: l'utente che scrive
    };
    models.push(m);
    return m;
  }
  const monaco = {
    editor: { create: () => editor, createModel, EndOfLineSequence: { LF: 0, CRLF: 1 } },
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
