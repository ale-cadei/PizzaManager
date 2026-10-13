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
    addCommand(keys, fn) { editor.commands.push({ keys, fn }); },
    dispose() { editor.disposed = true; },
  };
  function createModel(text, _language, uri) {
    const listeners = [];
    let value = text;
    let version = 1;
    const change = () => { version += 1; listeners.forEach((f) => f()); };
    const m = {
      uri, disposed: false, eol: null,
      getValue: () => value,
      getAlternativeVersionId: () => version,
      getFullModelRange: () => ({ all: true }),
      pushEditOperations: (_sel, ops) => { value = ops[0].text; change(); },
      pushEOL: (eol) => { m.eol = eol; },
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
  const { h, fake, changes } = host();
  h.open('a.js', 'x');
  fake.models[0].type('y');
  assert.strictEqual(h.isDirty('a.js'), true);
  h.markSaved('a.js');
  assert.strictEqual(h.isDirty('a.js'), false);
  assert.deepStrictEqual(changes, [['a.js', true], ['a.js', false]]);
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
