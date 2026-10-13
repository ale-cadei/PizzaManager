const vm = require('vm');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { loadPage, stub } = require('./renderer-page');

/* La scheda editor (renderer/editor-tab.js) vive nello scope globale del
   renderer: si carica la pagina vera (renderer-page.js) e si chiamano le sue
   funzioni su una scheda finta. Monaco è un `host` finto che ricorda il testo
   e le modifiche; il main è un `window.aisess` finto. Si guarda lo stato dei
   file (editor-files.js), non il disegno. */

const settle = () => new Promise((r) => setImmediate(r));

/** Una promise da risolvere a mano: un salvataggio ancora in volo. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeHost(texts) {
  const calls = [];
  const dirty = new Set();
  return {
    calls,
    texts,
    dirty,
    isDirty: (rel) => dirty.has(rel),
    getText: (rel) => texts[rel],
    markSaved: (rel) => { calls.push(['markSaved', rel]); dirty.delete(rel); },
    replaceText: (rel, text) => { calls.push(['replaceText', rel, text]); texts[rel] = text; dirty.delete(rel); },
    activate: (rel) => calls.push(['activate', rel]),
    open: () => {}, close: () => {}, rename: () => {}, dispose: () => {},
  };
}

/**
 * La pagina caricata, il main finto e una scheda editor con i file `files`
 * già aperti ({rel: {text, mtime, dirty}}); l'ultimo è quello attivo.
 * `main`: risposte del main per canale (funzioni), il resto risponde ok.
 */
function setup({ files = {}, main = {} } = {}) {
  const calls = [];
  const handlers = {
    editorWatch: async (root, rel) => ({ ok: true, path: `${root}/${rel}` }),
    editorUnwatch: async () => ({ ok: true }),
    saveEditorSessions: async () => ({ ok: true }),
    onEditorFileChanged: () => {},
    ...main,
  };
  const aisess = new Proxy({}, {
    get: (t, k) => (k in handlers
      ? (...args) => { calls.push([k, ...args]); return handlers[k](...args); }
      : (...args) => { calls.push([k, ...args]); return Promise.resolve({ ok: true }); }),
  });
  const page = loadPage({ aisess });
  const run = (code) => vm.runInContext(code, page.ctx);
  const Files = page.ctx.AisessEditorFiles;
  const host = fakeHost(Object.fromEntries(Object.entries(files).map(([rel, f]) => [rel, f.text])));
  let state = Files.empty();
  for (const [rel, f] of Object.entries(files)) {
    state = Files.open(state, rel, { path: `/w/${rel}`, mtime: f.mtime, bom: false });
    if (f.dirty) { state = Files.update(state, rel, { dirty: true }); host.dirty.add(rel); }
  }
  const tab = {
    id: 'tab-ed', type: 'editor', cwd: '/w', name: 'w', wrap: stub(),
    editor: {
      ui: { tree: stub(), treeHost: stub(), subtabs: stub(), bar: stub(), message: stub(), host: stub() },
      files: state, tree: page.ctx.AisessEditorTree.emptyTree(),
      host, hostPending: null, saving: new Set(), pendingChanges: new Map(),
    },
  };
  run('tabs').set(tab.id, tab);
  const file = (rel) => tab.editor.files.files[rel];
  const sent = (channel) => calls.filter((c) => c[0] === channel);
  return { page, run, tab, host, calls, sent, file, fn: (name) => run(name) };
}

/* ---------- handleEditorFileChange ---------- */

ok('scheda editor: un cambio col mtime del nostro salvataggio non fa niente', async () => {
  const { tab, fn, file, sent, host } = setup({ files: { 'a.js': { text: 'uno', mtime: 100 } } });
  fn('handleEditorFileChange')(tab, 'a.js', { path: '/w/a.js', exists: true, mtime: 100 });
  await settle();
  assert.deepStrictEqual(sent('editorRead'), []);
  assert.strictEqual(file('a.js').conflict, null);
  assert.deepStrictEqual(host.calls, []);
});

ok('scheda editor: un file pulito cambiato sul disco si ricarica', async () => {
  const { tab, fn, file, sent, host } = setup({
    files: { 'a.js': { text: 'uno', mtime: 100 } },
    main: { editorRead: async () => ({ ok: true, text: 'due', mtime: 200, path: '/w/a.js', bom: false }) },
  });
  fn('handleEditorFileChange')(tab, 'a.js', { path: '/w/a.js', exists: true, mtime: 200 });
  await settle();
  assert.deepStrictEqual(sent('editorRead').map((c) => c.slice(1)), [['/w', 'a.js']]);
  assert.deepStrictEqual(host.calls, [['replaceText', 'a.js', 'due']]);
  assert.strictEqual(file('a.js').mtime, 200);
  assert.strictEqual(file('a.js').dirty, false);
});

ok('scheda editor: un file con modifiche cambiato sul disco va in conflitto «disk», senza ricaricare', async () => {
  const { tab, fn, file, sent, host } = setup({ files: { 'a.js': { text: 'mio', mtime: 100, dirty: true } } });
  fn('handleEditorFileChange')(tab, 'a.js', { path: '/w/a.js', exists: true, mtime: 200 });
  await settle();
  assert.deepStrictEqual(sent('editorRead'), []);
  assert.strictEqual(file('a.js').conflict, 'disk');
  assert.strictEqual(file('a.js').diskMtime, 200);
  assert.strictEqual(host.texts['a.js'], 'mio', 'le modifiche non si toccano');
});

ok('scheda editor: un file sparito dal disco si segna eliminato', async () => {
  const { tab, fn, file } = setup({ files: { 'a.js': { text: 'uno', mtime: 100 } } });
  fn('handleEditorFileChange')(tab, 'a.js', { path: '/w/a.js', exists: false, mtime: null });
  assert.strictEqual(file('a.js').deleted, true);
});

ok('scheda editor: un cambio durante un salvataggio si rimanda e si guarda dopo, col mtime nuovo', async () => {
  const write = deferred();
  const { tab, fn, file, sent } = setup({
    files: { 'a.js': { text: 'mio', mtime: 100, dirty: true } },
    main: {
      editorWrite: () => write.promise,
      editorRead: async () => ({ ok: true, text: 'altro', mtime: 300, path: '/w/a.js', bom: false }),
    },
  });
  const saving = fn('saveEditorFile')(tab, 'a.js');
  // Il watch vede il nostro salvataggio mentre è in volo: non si decide adesso
  fn('handleEditorFileChange')(tab, 'a.js', { path: '/w/a.js', exists: true, mtime: 250 });
  assert.strictEqual(tab.editor.pendingChanges.get('a.js').mtime, 250);
  assert.strictEqual(file('a.js').conflict, null, 'durante il salvataggio niente conflitto');
  write.resolve({ ok: true, mtime: 250 });
  assert.strictEqual(await saving, true);
  await settle();
  assert.strictEqual(tab.editor.pendingChanges.size, 0);
  assert.deepStrictEqual(sent('editorRead'), [], 'era il nostro salvataggio: niente da ricaricare');

  // Un altro processo scrive durante il salvataggio: rigiocato dopo, si ricarica
  const again = deferred();
  const s2 = setup({
    files: { 'a.js': { text: 'mio', mtime: 100, dirty: true } },
    main: {
      editorWrite: () => again.promise,
      editorRead: async () => ({ ok: true, text: 'altro', mtime: 300, path: '/w/a.js', bom: false }),
    },
  });
  const p2 = s2.fn('saveEditorFile')(s2.tab, 'a.js');
  s2.fn('handleEditorFileChange')(s2.tab, 'a.js', { path: '/w/a.js', exists: true, mtime: 300 });
  again.resolve({ ok: true, mtime: 250 });
  await p2;
  await settle();
  assert.strictEqual(s2.sent('editorRead').length, 1);
  assert.strictEqual(s2.file('a.js').mtime, 300);
  assert.strictEqual(s2.host.texts['a.js'], 'altro');
});

/* ---------- saveEditorFile ---------- */

ok('scheda editor: salvare scrive il testo con l mtime atteso, poi segna salvato e prende il nuovo mtime', async () => {
  const { tab, fn, file, sent, host } = setup({
    files: { 'a.js': { text: 'mio', mtime: 100, dirty: true } },
    main: { editorWrite: async () => ({ ok: true, mtime: 150 }) },
  });
  assert.strictEqual(await fn('saveEditorFile')(tab, 'a.js'), true);
  assert.deepStrictEqual(sent('editorWrite').map((c) => c.slice(1)), [['/w', 'a.js', 'mio', 100, false]]);
  assert.deepStrictEqual(host.calls, [['markSaved', 'a.js']]);
  assert.strictEqual(file('a.js').mtime, 150);
  assert.strictEqual(tab.editor.saving.size, 0);
});

ok('scheda editor: un salvataggio in conflitto col disco va in stato «save» e non segna salvato', async () => {
  const { tab, fn, file, host } = setup({
    files: { 'a.js': { text: 'mio', mtime: 100, dirty: true } },
    main: { editorWrite: async () => ({ ok: false, conflict: true, mtime: 180 }) },
  });
  assert.strictEqual(await fn('saveEditorFile')(tab, 'a.js'), false);
  assert.strictEqual(file('a.js').conflict, 'save');
  assert.strictEqual(file('a.js').diskMtime, 180);
  assert.strictEqual(file('a.js').mtime, 100);
  assert.deepStrictEqual(host.calls, []);
});

ok('scheda editor: un errore di scrittura resta sul file, col messaggio del main', async () => {
  const { tab, fn, file, host } = setup({
    files: { 'a.js': { text: 'mio', mtime: 100, dirty: true } },
    main: { editorWrite: async () => ({ ok: false, error: 'Permesso negato.' }) },
  });
  assert.strictEqual(await fn('saveEditorFile')(tab, 'a.js'), false);
  assert.strictEqual(file('a.js').error, 'Salvataggio non riuscito: Permesso negato.');
  assert.deepStrictEqual(host.calls, []);
});

/* ---------- saveAllEditorFiles ---------- */

ok('scheda editor: «Salva tutto» porta davanti il primo file non salvato', async () => {
  const { tab, fn, file, sent } = setup({
    files: {
      'a.js': { text: 'A', mtime: 1, dirty: true },
      'b.js': { text: 'B', mtime: 2, dirty: true },
      'c.js': { text: 'C', mtime: 3, dirty: true },
    },
    main: { editorWrite: async (root, rel) => (rel === 'a.js' ? { ok: true, mtime: 10 } : { ok: false, error: 'Disco pieno.' }) },
  });
  tab.editor.files = { ...tab.editor.files, active: 'a.js' };
  assert.strictEqual(await fn('saveAllEditorFiles')(tab), false);
  assert.deepStrictEqual(sent('editorWrite').map((c) => c[2]), ['a.js', 'b.js', 'c.js'], 'un fallimento non ferma gli altri');
  assert.strictEqual(tab.editor.files.active, 'b.js');
  assert.match(file('b.js').error, /Disco pieno/);
  assert.strictEqual(file('a.js').mtime, 10);
});

ok('scheda editor: «Salva tutto» riuscito lascia attivo il file di prima', async () => {
  const { tab, fn } = setup({
    files: { 'a.js': { text: 'A', mtime: 1, dirty: true }, 'b.js': { text: 'B', mtime: 2, dirty: true } },
    main: { editorWrite: async () => ({ ok: true, mtime: 10 }) },
  });
  assert.strictEqual(await fn('saveAllEditorFiles')(tab), true);
  assert.strictEqual(tab.editor.files.active, 'b.js');
});

/* ---------- uscita: beforeunload ---------- */

function unloadEvent() {
  return { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
}

ok('scheda editor: il beforeunload ferma l uscita solo con file non salvati, e chiede', () => {
  const { page, run, tab, fn } = setup({ files: { 'a.js': { text: 'A', mtime: 1 } } });
  fn('initEditorTabs')();
  let asked = 0;
  page.ctx.askEditorExit = () => { asked += 1; };
  const handler = page.windowListeners.beforeunload;
  assert.strictEqual(typeof handler, 'function');

  const clean = unloadEvent();
  handler(clean);
  assert.strictEqual(clean.prevented, false, 'niente da salvare: si esce');
  assert.strictEqual(asked, 0);

  tab.editor.files = page.ctx.AisessEditorFiles.update(tab.editor.files, 'a.js', { dirty: true });
  const dirty = unloadEvent();
  handler(dirty);
  assert.strictEqual(dirty.prevented, true);
  assert.strictEqual(dirty.returnValue, false);
  assert.strictEqual(asked, 1);

  run('editorExitConfirmed = true');
  const confirmed = unloadEvent();
  handler(confirmed);
  assert.strictEqual(confirmed.prevented, false, 'dopo la conferma l uscita passa');
  assert.strictEqual(asked, 1);
});
