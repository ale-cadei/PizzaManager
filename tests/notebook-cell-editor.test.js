const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createCellEditor, KEYS } = require('../renderer/notebook-cell-editor');

/* L'editor di una cella del notebook (renderer/notebook-cell-editor.js,
   docs/plans/78), con un Monaco finto: model, editor, azioni, altezza. */

function fakeMonaco({ languages = ['python', 'markdown', 'plaintext'] } = {}) {
  const made = { models: [], editors: [] };
  const monaco = {
    KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
    KeyCode: { KeyS: 49, Enter: 3, Escape: 9 },
    languages: { getLanguages: () => languages.map((id) => ({ id })) },
    editor: {
      createModel(text, language) {
        const listeners = [];
        const m = {
          value: text, language, disposed: false,
          getValue: () => m.value,
          onDidChangeContent: (f) => { listeners.push(f); return { dispose() {} }; },
          type(s) { m.value += s; listeners.forEach((f) => f()); },
          dispose() { m.disposed = true; },
        };
        made.models.push(m);
        return m;
      },
      create(node, options) {
        const sizeListeners = [];
        const e = {
          node, options, actions: [], focused: false, disposed: false, height: 57, layouts: 0,
          addAction(a) { e.actions.push(a); return { dispose() {} }; },
          getContentHeight: () => e.height,
          onDidContentSizeChange: (f) => { sizeListeners.push(f); return { dispose() {} }; },
          grow(h) { e.height = h; sizeListeners.forEach((f) => f()); },
          layout() { e.layouts += 1; },
          focus() { e.focused = true; },
          dispose() { e.disposed = true; },
          press(binding) { const a = e.actions.find((x) => x.keybindings.includes(binding)); a.run(); return a; },
        };
        made.editors.push(e);
        return e;
      },
    },
  };
  return { monaco, made };
}

function make(opts = {}) {
  const fake = fakeMonaco(opts);
  const node = { style: {} };
  const changes = [];
  const keys = [];
  const cell = createCellEditor({
    monaco: fake.monaco, node, text: 'x = 1', language: opts.language || 'python', fontSize: 13, theme: 't', font: 'F',
    onChange: (text) => changes.push(text), onKey: (k) => keys.push(k),
  });
  return { ...fake, node, changes, keys, cell, editor: fake.made.editors[0], model: fake.made.models[0] };
}

ok('cell editor: model col testo e il linguaggio, editor senza margini né minimappa', () => {
  const s = make();
  assert.deepStrictEqual([s.model.value, s.model.language], ['x = 1', 'python']);
  const o = s.editor.options;
  assert.strictEqual(o.model, s.model);
  assert.deepStrictEqual([o.theme, o.fontSize, o.fontFamily, o.lineNumbers, o.minimap.enabled, o.scrollBeyondLastLine], ['t', 13, 'F', 'off', false, false]);
  // La rotella scorre il notebook, non la cella
  assert.strictEqual(o.scrollbar.alwaysConsumeMouseWheel, false);
});

ok('cell editor: un linguaggio che Monaco non conosce diventa plaintext', () => {
  assert.strictEqual(make({ language: 'julia' }).model.language, 'plaintext');
});

ok('cell editor: alto quanto il contenuto, anche quando cresce', () => {
  const s = make();
  assert.strictEqual(s.node.style.height, '57px');
  s.editor.grow(99);
  assert.strictEqual(s.node.style.height, '99px');
  assert.ok(s.editor.layouts >= 2);
});

ok('cell editor: ogni modifica arriva col testo intero', () => {
  const s = make();
  s.model.type('0');
  assert.deepStrictEqual(s.changes, ['x = 10']);
  assert.strictEqual(s.cell.getValue(), 'x = 10');
});

ok('cell editor: Esc, Shift+Invio, Ctrl+Invio e Ctrl+S diventano nomi', () => {
  const s = make();
  const { KeyMod, KeyCode } = s.monaco;
  const esc = s.editor.press(KeyCode.Escape);
  s.editor.press(KeyMod.Shift | KeyCode.Enter);
  s.editor.press(KeyMod.CtrlCmd | KeyCode.Enter);
  s.editor.press(KeyMod.CtrlCmd | KeyCode.KeyS);
  assert.deepStrictEqual(s.keys, [KEYS.ESCAPE, KEYS.NEXT, KEYS.RUN, KEYS.SAVE]);
  // Esc prima chiude i suggerimenti e la ricerca di Monaco
  assert.match(esc.precondition, /!suggestWidgetVisible/);
});

ok('cell editor: focus e dispose chiudono editor e model', () => {
  const s = make();
  s.cell.focus();
  assert.strictEqual(s.editor.focused, true);
  s.cell.dispose();
  assert.deepStrictEqual([s.editor.disposed, s.model.disposed], [true, true]);
});
