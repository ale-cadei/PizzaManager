const vm = require('vm');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { loadPage, stub } = require('./renderer-page');
const { createElement } = require('./fake-dom');

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
  const gutters = []; // a parte: le barrette arrivano anche da sole, dopo ogni lettura di HEAD
  const dirty = new Set();
  return {
    calls,
    gutters,
    texts,
    dirty,
    setGutter: (rel, ranges) => gutters.push([rel, ranges]),
    isDirty: (rel) => dirty.has(rel),
    getText: (rel) => texts[rel],
    markSaved: (rel) => { calls.push(['markSaved', rel]); dirty.delete(rel); },
    replaceText: (rel, text) => { calls.push(['replaceText', rel, text]); texts[rel] = text; dirty.delete(rel); },
    activate: (rel) => calls.push(['activate', rel]),
    open: (rel, text) => { texts[rel] = text; }, close: () => {}, rename: () => {}, dispose: () => {},
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

/* ---------- watch dopo la chiusura ---------- */

ok('scheda editor: chiusa la scheda, un watch che arriva tardi non resta armato', async () => {
  // Un salvataggio, una rinomina o una ricarica finiti dopo disposeEditorTab
  const { tab, fn, run, sent } = setup({ files: { 'a.js': { text: 'A', mtime: 1 } } });
  run('tabs').delete(tab.id);
  await fn('watchEditorFile')(tab, 'a.js');
  assert.deepStrictEqual(sent('editorWatch'), [], 'scheda chiusa: niente watch');

  // In volo quando la scheda si chiude: armato nel main, si toglie subito
  const watch = deferred();
  const s = setup({ files: { 'a.js': { text: 'A', mtime: 1 } }, main: { editorWatch: () => watch.promise } });
  const pending = s.fn('watchEditorFile')(s.tab, 'a.js');
  s.run('tabs').delete(s.tab.id);
  watch.resolve({ ok: true, path: '/w/a.js' });
  await pending;
  await settle();
  assert.deepStrictEqual(s.sent('editorUnwatch').map((c) => c.slice(1)), [['/w', 'a.js']]);
});

/* ---------- copiare da fuori (docs/plans/61) ---------- */

/** Array e oggetti nati nel contesto vm della pagina hanno altri prototipi: si confrontano in copia. */
const plain = (v) => JSON.parse(JSON.stringify(v));

/** Una scheda col main che risponde ok, un messaggio vero e le risposte della bolla. */
function copySetup({ main = {}, answers = [] } = {}) {
  const s = setup({ main: {
    editorPathForFile: (f) => f.p,
    editorCopyPlan: async () => ({ ok: true, items: [], conflicts: [], count: 2, bytes: 0 }),
    editorCopyRun: async () => ({ ok: true, copied: 2, skipped: 0, failed: [] }),
    editorList: async () => ({ ok: true, entries: [] }),
    ...main,
  } });
  const message = createElement('div');
  message.hidden = true;
  s.tab.editor.ui.message = message;
  s.tab.editor.copying = false;
  const asked = [];
  s.run('editorConfirm').choose = async (o) => { asked.push(o); return answers.length ? answers.shift() : null; };
  const copyInto = (dir, source) => s.fn('copyIntoEditor')(s.tab, dir, source);
  const drop = (...paths) => ({ kind: 'drop', files: paths.map((p) => ({ p })) });
  return { ...s, message, asked, copyInto, drop };
}

ok('copia: un drop senza conflitti fa piano, copia, esito e rilegge la cartella', async () => {
  const s = copySetup();
  await s.copyInto('', s.drop('/x/a', '/x/b'));
  assert.deepStrictEqual(plain(s.sent('editorCopyPlan').map((c) => c.slice(1))), [['/w', '', ['/x/a', '/x/b']]]);
  assert.deepStrictEqual(plain(s.sent('editorCopyRun').map((c) => c.slice(1))), [['/w', '', ['/x/a', '/x/b'], {}]]);
  assert.deepStrictEqual(s.asked, []);
  assert.strictEqual(s.message.textContent, 'Copiati 2 elementi.');
  assert.strictEqual(s.message.hidden, false);
  assert.ok(s.message.classList.contains('is-info'));
  assert.deepStrictEqual(s.sent('editorList').map((c) => c.slice(1)), [['/w', '']]);
  assert.strictEqual(s.tab.editor.copying, false);
});

ok('copia: i conflitti si chiedono uno alla volta, «per tutti» chiude i rimanenti', async () => {
  const conflicts = ['a.txt', 'b.txt', 'c.txt'].map((name) => ({ name, kind: 'file', existingKind: 'file' }));
  const s = copySetup({
    main: { editorCopyPlan: async () => ({ ok: true, items: [], conflicts, count: 3, bytes: 0 }) },
    answers: ['replace', 'skip-all'],
  });
  await s.copyInto('src', s.drop('/x/a.txt', '/x/b.txt', '/x/c.txt'));
  assert.strictEqual(s.asked.length, 2);
  assert.deepStrictEqual(plain(s.asked[0].choices.map((c) => c.value)), ['replace', 'keep-both', 'skip', 'replace-all', 'keep-both-all', 'skip-all']);
  assert.match(s.asked[0].title, /a\.txt/);
  assert.deepStrictEqual(plain(s.sent('editorCopyRun')[0][4]), { 'a.txt': 'replace', 'b.txt': 'skip', 'c.txt': 'skip' });
});

ok('copia: annullare una domanda non copia niente', async () => {
  const s = copySetup({ main: { editorCopyPlan: async () => ({ ok: true, items: [], conflicts: [{ name: 'a.txt', kind: 'file', existingKind: 'dir' }], count: 1, bytes: 0 }) } });
  await s.copyInto('', s.drop('/x/a.txt'));
  assert.strictEqual(s.asked.length, 1);
  assert.deepStrictEqual(plain(s.asked[0].choices.map((c) => c.value)), ['replace', 'keep-both', 'skip'], 'un solo conflitto: niente «per tutti»');
  assert.deepStrictEqual(s.sent('editorCopyRun'), []);
  assert.strictEqual(s.tab.editor.copying, false);
});

ok('copia: appunti senza file, drop senza percorsi, finestra annullata', async () => {
  const s = copySetup({ main: { editorClipboardFiles: async () => ({ ok: true, paths: [] }), editorPickFiles: async () => ({ ok: true, paths: [] }), editorPathForFile: () => '' } });
  await s.copyInto('', { kind: 'paste' });
  assert.strictEqual(s.message.textContent, 'Negli appunti non ci sono file da incollare.');
  await s.copyInto('', s.drop('/x/a'));
  assert.strictEqual(s.message.textContent, 'I file trascinati non hanno un percorso sul disco.');
  s.message.textContent = '';
  await s.copyInto('', { kind: 'pick' });
  assert.strictEqual(s.message.textContent, '', 'annullare la finestra non dice niente');
  assert.deepStrictEqual(s.sent('editorCopyPlan'), []);
});

ok('copia: un piano rifiutato lo dice come errore e non copia', async () => {
  const s = copySetup({ main: { editorCopyPlan: async () => ({ ok: false, error: 'Troppo grande: più di 1 GB.' }) } });
  await s.copyInto('', s.drop('/x/a'));
  assert.strictEqual(s.message.textContent, 'Non si copia: Troppo grande: più di 1 GB.');
  assert.ok(!s.message.classList.contains('is-info'));
  assert.deepStrictEqual(s.sent('editorCopyRun'), []);
});

ok('copia: gli elementi non copiati finiscono nel messaggio, come errore', async () => {
  const s = copySetup({ main: { editorCopyRun: async () => ({ ok: true, copied: 2, skipped: 1, failed: [{ name: 'x.txt', error: 'Non esiste più.' }] }) } });
  await s.copyInto('', s.drop('/x/a'));
  assert.strictEqual(s.message.textContent, 'Copiati 2 elementi, 1 saltato, 1 non copiato: x.txt (Non esiste più).');
  assert.ok(!s.message.classList.contains('is-info'));
});

ok('copia: in una cartella chiusa la apre per mostrare cosa è arrivato', async () => {
  const s = copySetup();
  await s.copyInto('src', s.drop('/x/a'));
  assert.ok(s.page.ctx.AisessEditorTree.isExpanded(s.tab.editor.tree, 'src'));
  assert.deepStrictEqual(s.sent('editorList').map((c) => c.slice(1)), [['/w', 'src']]);
});

ok('copia: «Copia qui file…» e «Incolla» nel menu di una cartella', async () => {
  const s = copySetup({ main: { editorPickFiles: async () => ({ ok: true, paths: ['/x/a'] }) } });
  const menus = [];
  s.page.ctx.AisessEditorTree.showMenu = (o) => menus.push(o);
  s.fn('editorTreeMenu')(s.tab, { rel: 'src', kind: 'dir' }, { clientX: 0, clientY: 0 });
  const labels = menus[0].items.map((i) => i.label);
  assert.ok(labels.includes('Copia qui file…') && labels.includes('Incolla'), labels.join(', '));
  await menus[0].items.find((i) => i.label === 'Copia qui file…').run();
  assert.strictEqual(s.sent('editorPickFiles').length, 1);
  assert.deepStrictEqual(s.sent('editorCopyPlan')[0].slice(1), ['/w', 'src', ['/x/a']]);
});

ok('copia: una seconda copia mentre la prima è in corso si rifiuta', async () => {
  const plan = deferred();
  const s = copySetup({ main: { editorCopyPlan: () => plan.promise } });
  const first = s.copyInto('', s.drop('/x/a'));
  await settle();
  await s.copyInto('', s.drop('/x/b'));
  assert.strictEqual(s.message.textContent, 'Una copia è già in corso.');
  plan.resolve({ ok: true, items: [], conflicts: [], count: 1, bytes: 0 });
  await first;
  assert.strictEqual(s.sent('editorCopyPlan').length, 1);
  assert.strictEqual(s.message.textContent, 'Copiati 2 elementi.');
});

ok('copia: un file lasciato fuori dall albero non apre niente nella finestra', () => {
  const { page, fn } = setup();
  fn('initEditorTabs')();
  const ev = (types) => ({ prevented: false, dataTransfer: { types, dropEffect: null }, preventDefault() { this.prevented = true; } });
  const over = ev(['Files']);
  page.listeners.dragover(over);
  assert.strictEqual(over.prevented, true);
  assert.strictEqual(over.dataTransfer.dropEffect, 'none');
  const dropped = ev(['Files']);
  page.listeners.drop(dropped);
  assert.strictEqual(dropped.prevented, true);
  const text = ev(['text/plain']);
  page.listeners.drop(text);
  assert.strictEqual(text.prevented, false, 'gli altri drag non si toccano');
});

ok('copia: testi dell esito e scelte dei conflitti', () => {
  const { fn } = setup();
  const text = fn('copyOutcomeText');
  assert.strictEqual(text({ copied: 1, skipped: 0, failed: [] }), 'Copiato 1 elemento.');
  assert.strictEqual(text({ copied: 0, skipped: 2, failed: [] }), 'Copiati 0 elementi, 2 saltati.');
  assert.strictEqual(text({ copied: 0, skipped: 0, failed: [{ name: 'a', error: 'Permesso negato.' }, { name: 'b', error: 'Disco pieno.' }] }),
    'Copiati 0 elementi, 2 non copiati: a (Permesso negato), b (Disco pieno).');
  const choices = fn('copyConflictChoices');
  assert.strictEqual(choices(1).length, 3);
  assert.ok(choices(1)[0].danger, '«Sostituisci» è l azione che cestina');
  assert.deepStrictEqual(plain(choices(2).slice(3).map((c) => c.label)), ['Sostituisci tutti', 'Tieni entrambi per tutti', 'Salta tutti']);
});

ok('copia: l avanzamento conta gli elementi in cima che si copiano davvero, come l esito', async () => {
  const during = [];
  let s;
  const run = async () => { during.push(s.message.textContent); return { ok: true, copied: 1, skipped: 0, failed: [] }; };
  s = copySetup({ main: { editorCopyPlan: async () => ({ ok: true, items: [{ name: 'd', kind: 'dir' }], conflicts: [], count: 13, bytes: 0 }), editorCopyRun: run } });
  await s.copyInto('', s.drop('/x/d'));
  assert.deepStrictEqual(during, ['Copio 1 elemento…'], 'non i 13 file e cartelle del piano');
  assert.strictEqual(s.message.textContent, 'Copiato 1 elemento.');

  const conflicts = ['a.txt', 'b.txt', 'c.txt'].map((name) => ({ name, kind: 'file', existingKind: 'file' }));
  const items = [...conflicts.map(({ name }) => ({ name, kind: 'file' })), { name: 'e.txt', kind: 'file' }];
  during.length = 0;
  s = copySetup({ main: { editorCopyPlan: async () => ({ ok: true, items, conflicts, count: 4, bytes: 0 }), editorCopyRun: run }, answers: ['skip-all'] });
  await s.copyInto('', s.drop('/x/a.txt', '/x/b.txt', '/x/c.txt', '/x/e.txt'));
  assert.deepStrictEqual(during, ['Copio 1 elemento…'], 'i saltati non si contano');
});

/* ---------- pannello dell'albero (docs/plans/62) ---------- */

/** Un document di fake-dom al posto dello stub della pagina: per guardare il layout. */
function fakeDocument() {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.body = createElement('body');
  return doc;
}

/** Il layout di una scheda editor disegnato in un wrap di fake-dom. */
function layout() {
  const env = setup();
  env.page.ctx.document = fakeDocument();
  const wrap = createElement('div');
  const ui = env.fn('buildEditorLayout')({ ...env.tab, wrap });
  const head = wrap.children[2].children[0];
  return { ...env, wrap, ui, head, toggle: head.children[0] };
}

ok('pannello: la striscia sta fra albero ed editor, il bottone fuori dalle sotto-schede', () => {
  const { wrap, ui, head, toggle } = layout();
  assert.deepStrictEqual(wrap.children.map((c) => c.className), ['editor-side', 'editor-resizer', 'editor-main']);
  assert.ok(toggle.classList.contains('editor-tree-toggle'));
  assert.strictEqual(toggle.title, 'Mostra/nascondi file (Ctrl+B)');
  assert.strictEqual(head.children[1], ui.subtabs, 'le sotto-schede si ridisegnano da sole, il bottone resta');
});

ok('pannello: il bottone apre e chiude l albero e se lo ricorda', () => {
  const { page, run, toggle } = layout();
  toggle.onclick();
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);
  assert.strictEqual(page.ctx.localStorage.getItem('aisess.editorTreeHidden'), '1');
  toggle.onclick();
  assert.strictEqual(run('editorPanel.prefs().hidden'), false);
});

ok('pannello: Ctrl+B apre e chiude solo con una scheda editor davanti', () => {
  const { page, fn, run } = setup();
  fn('initEditorTabs')();
  const key = (props = {}) => ({
    ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'b',
    prevented: false, preventDefault() { this.prevented = true; }, ...props,
  });
  run("activeId = 'tab-ed'");
  const onEditor = key();
  page.listeners.keydown(onEditor);
  assert.strictEqual(onEditor.prevented, true);
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);

  const plain = key({ ctrlKey: false });
  page.listeners.keydown(plain);
  assert.strictEqual(plain.prevented, false, 'una b scritta resta una b');
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);

  run("tabs.set('tab-term', { id: 'tab-term', type: 'shell' }); activeId = 'tab-term'");
  const onTerm = key();
  page.listeners.keydown(onTerm);
  assert.strictEqual(onTerm.prevented, false, 'nei terminali Ctrl+B resta della shell');
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);

  run("activeId = 'tab-ed'");
  const held = key({ repeat: true });
  page.listeners.keydown(held);
  assert.strictEqual(held.prevented, true);
  assert.strictEqual(run('editorPanel.prefs().hidden'), true, 'tenuto premuto non riapre');
});

/* ---------- barrette delle righe cambiate (docs/plans/63) ---------- */

/** setup() con timer finti: `timers` quelli armati, `flush()` fa partire quelli ancora validi. */
function gutterSetup(opts) {
  const s = setup(opts);
  const timers = [];
  s.page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  s.page.ctx.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  const flush = () => timers.filter((t) => !t.cleared && !t.done).forEach((t) => { t.done = true; t.fn(); });
  return { ...s, timers, flush };
}

const read = (text) => async (root, rel) => ({ ok: true, text, mtime: 100, path: `${root}/${rel}`, bom: false });

ok('barrette: aprendo un file si chiede HEAD e si disegnano le righe cambiate', async () => {
  const s = gutterSetup({ main: { editorRead: read('uno\ndue\n'), editorHeadText: async () => ({ ok: true, text: 'uno\n' }) } });
  assert.strictEqual(await s.fn('openEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.deepStrictEqual(s.sent('editorHeadText').map((c) => c.slice(1)), [['/w', 'a.txt']]);
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'add', from: 2, to: 2 }]]]);
  assert.deepStrictEqual(plain(s.fn('editorFileChanges')(s.tab, 'a.txt')), [{ kind: 'add', from: 2, to: 2 }]);
  assert.strictEqual(s.fn('editorFileChanges')(s.tab, 'chiuso.txt'), null);
});

ok('barrette: un file che non c è in HEAD è tutto aggiunto', async () => {
  const s = gutterSetup({ main: { editorRead: read('a\nb'), editorHeadText: async () => ({ ok: true, text: null }) } });
  await s.fn('openEditorFile')(s.tab, 'nuovo.txt');
  await settle();
  assert.deepStrictEqual(plain(s.host.gutters), [['nuovo.txt', [{ kind: 'add', from: 1, to: 2 }]]]);
});

ok('barrette: fuori da git o con un errore niente barrette, e il file si apre lo stesso', async () => {
  for (const editorHeadText of [async () => ({ ok: false, reason: 'not-repo' }), async () => { throw new Error('ipc giù'); }]) {
    const s = gutterSetup({ main: { editorRead: read('x'), editorHeadText } });
    assert.strictEqual(await s.fn('openEditorFile')(s.tab, 'a.txt'), true);
    await settle();
    assert.strictEqual(s.file('a.txt').changes, null);
    assert.ok(s.host.gutters.every(([, ranges]) => ranges === null), JSON.stringify(s.host.gutters));
  }
});

ok('barrette: scrivendo si ricalcola 300 ms dopo l ultima modifica, una volta', async () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'uno', mtime: 100 } } });
  s.tab.editor.files = s.page.ctx.AisessEditorFiles.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'uno' } });
  const change = s.fn('onEditorTextChange');
  s.host.texts['a.txt'] = 'UNO';
  change(s.tab, 'a.txt', true);
  s.host.texts['a.txt'] = 'UNO\ndue';
  change(s.tab, 'a.txt', true);
  assert.deepStrictEqual(s.timers.map((t) => [t.ms, t.cleared]), [[300, true], [300, false]]);
  assert.deepStrictEqual(s.host.gutters, [], 'niente prima del timer');
  s.flush();
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'mod', from: 1, to: 1 }, { kind: 'add', from: 2, to: 2 }]]]);
  assert.strictEqual(s.file('a.txt').dirty, true);
});

ok('barrette: un ricalcolo in attesa per un altro file si fa subito', () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'a', mtime: 1 }, 'b.txt': { text: 'b', mtime: 1 } } });
  const Files = s.page.ctx.AisessEditorFiles;
  s.tab.editor.files = Files.update(Files.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'a' } }), 'b.txt', { gutterBase: { text: 'b' } });
  s.host.texts['a.txt'] = 'A';
  s.fn('onEditorTextChange')(s.tab, 'a.txt', true);
  s.fn('onEditorTextChange')(s.tab, 'b.txt', false);
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'mod', from: 1, to: 1 }]]]);
  s.flush();
  assert.deepStrictEqual(plain(s.host.gutters[1]), ['b.txt', []]);
});

ok('barrette: tornando in primo piano e dopo un salvataggio si rilegge HEAD', async () => {
  let head = 'uno\n';
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno\ndue\n', mtime: 1 } },
    main: {
      editorHeadText: async () => ({ ok: true, text: head }),
      editorStat: async () => ({ ok: true, exists: true, mtime: 1 }),
      editorList: async () => ({ ok: true, entries: [] }),
      editorWrite: async () => ({ ok: true, mtime: 2 }),
    },
  });
  await s.fn('refreshEditorTab')(s.tab);
  assert.deepStrictEqual(plain(s.host.gutters.pop()), ['a.txt', [{ kind: 'add', from: 2, to: 2 }]]);
  head = 'uno\ndue\n'; // un commit da un terminale
  await s.fn('refreshEditorTab')(s.tab);
  assert.deepStrictEqual(plain(s.host.gutters.pop()), ['a.txt', []], 'dopo il commit le barrette spariscono');
  await s.fn('refreshEditorTab')(s.tab);
  assert.deepStrictEqual(s.host.gutters, [], 'HEAD uguale: niente da ridisegnare');
  const before = s.sent('editorHeadText').length;
  assert.strictEqual(await s.fn('saveEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.strictEqual(s.sent('editorHeadText').length, before + 1);
});

ok('barrette: un file ricaricato dal disco si ricalcola subito', async () => {
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno', mtime: 100 } },
    main: { editorRead: read('uno\ndue') },
  });
  s.tab.editor.files = s.page.ctx.AisessEditorFiles.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'uno' } });
  s.fn('handleEditorFileChange')(s.tab, 'a.txt', { path: '/w/a.txt', exists: true, mtime: 200 });
  await settle();
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'add', from: 2, to: 2 }]]]);
  assert.deepStrictEqual(s.timers, []);
});

ok('barrette: chiudendo la scheda il ricalcolo in attesa si toglie', () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'a', mtime: 1 } } });
  s.fn('onEditorTextChange')(s.tab, 'a.txt', true);
  s.fn('disposeEditorTab')(s.tab);
  assert.strictEqual(s.timers[0].cleared, true);
  assert.strictEqual(s.tab.editor.gutterTimer, null);
});
