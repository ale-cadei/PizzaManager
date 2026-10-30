const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, fire } = require('./fake-dom');
const { settle, deferred, setup, plain } = require('./editor-tab-setup');

/* La scheda editor (renderer/editor-tab.js) vive nello scope globale del
   renderer: si carica la pagina vera (renderer-page.js) e si chiamano le sue
   funzioni su una scheda finta. Monaco è un `host` finto che ricorda il testo
   e le modifiche; il main è un `window.aisess` finto. Si guarda lo stato dei
   file (editor-files.js), non il disegno. */

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

ok('pannello: la striscia sta fra albero ed editor; in testa bottone e titolo', () => {
  const { wrap, ui, head, toggle } = layout();
  assert.deepStrictEqual(wrap.children.map((c) => c.className), ['editor-side', 'editor-resizer', 'editor-main']);
  assert.ok(toggle.classList.contains('editor-tree-toggle'));
  assert.strictEqual(toggle.title, 'Mostra/nascondi file (Ctrl+B)');
  assert.strictEqual(head.children[1], ui.title);
});

ok('pannello: «Aperti» in cima, poi la testata «File» e l albero', () => {
  const { wrap, ui } = layout();
  const side = wrap.children[0];
  assert.deepStrictEqual(side.children.map((c) => c.className), ['editor-open', 'editor-section-head', 'editor-tree-host']);
  const [openHead, list] = side.children[0].children;
  assert.strictEqual(list, ui.openList);
  assert.strictEqual(list.getAttribute('role'), 'tablist');
  assert.deepStrictEqual(openHead.querySelectorAll('.editor-icon-btn').map((b) => b.title), ['Salva tutto (Ctrl+Shift+S)', 'Chiudi tutti']);
  assert.deepStrictEqual(side.children[1].querySelectorAll('.editor-icon-btn').map((b) => b.title),
    ['Nuovo file nella cartella della sessione', 'Nuova cartella nella cartella della sessione', 'Rileggi le cartelle aperte']);
});

/* ---------- file aperti (docs/plans/70) ---------- */

/** Layout vero, con dei file aperti nello stato della scheda. */
function openLayout(files, main) {
  const env = setup({ files, main });
  env.page.ctx.document = fakeDocument();
  const wrap = createElement('div');
  env.tab.editor.ui = env.fn('buildEditorLayout')({ ...env.tab, wrap });
  const ui = env.tab.editor.ui;
  const rows = () => ui.openList.children;
  const part = (el, cls) => el.querySelectorAll(`.${cls}`)[0];
  env.fn('renderEditorOpen')(env.tab);
  return { ...env, ui, rows, part, render: () => env.fn('renderEditorOpen')(env.tab) };
}

ok('aperti: una riga per file con nome, cartella e stato; il file attivo fa da titolo', () => {
  const s = openLayout({ 'src/lib/a.js': { text: 'a', mtime: 1, dirty: true }, 'README.md': { text: 'r', mtime: 1 } });
  const [a, readme] = s.rows();
  assert.strictEqual(s.part(a, 'editor-open-name').textContent, 'a.js');
  assert.strictEqual(s.part(a, 'editor-open-dir').textContent, 'src/lib');
  assert.ok(a.classList.contains('is-dirty'));
  assert.ok(!a.classList.contains('is-active'));
  assert.ok(readme.classList.contains('is-active'), 'l ultimo aperto è l attivo');
  assert.strictEqual(readme.getAttribute('aria-selected'), 'true');
  assert.ok(s.part(readme, 'codicon-markdown'));
  assert.strictEqual(s.ui.openCount.textContent, '2');
  assert.strictEqual(s.ui.openCount.hidden, false);
  assert.strictEqual(s.part(s.ui.title, 'editor-title-name').textContent, 'README.md');
  assert.strictEqual(s.ui.title.querySelectorAll('.editor-crumb-dir').length, 0, 'un file della radice non ha cartella');
  assert.strictEqual(s.ui.title.querySelectorAll('.editor-title-dot').length, 0);
  assert.strictEqual(s.part(s.ui.openMenu, 'editor-open-menu-label').textContent, '2 aperti');
});

ok('aperti: click attiva, e il titolo segue con cartella e pallino', () => {
  const s = openLayout({ 'src/lib/a.js': { text: 'a', mtime: 1, dirty: true }, 'README.md': { text: 'r', mtime: 1 } });
  fire(s.rows()[0], 'click');
  assert.strictEqual(s.tab.editor.files.active, 'src/lib/a.js');
  assert.deepStrictEqual(s.host.calls.at(-1), ['activate', 'src/lib/a.js']);
  assert.ok(s.rows()[0].classList.contains('is-active'));
  assert.strictEqual(s.part(s.ui.title, 'editor-title-name').textContent, 'a.js');
  assert.strictEqual(s.part(s.ui.title, 'editor-crumb-dir').textContent, 'src/lib');
  assert.strictEqual(s.ui.title.querySelectorAll('.editor-title-dot').length, 1);
});

ok('aperti: la × e il click centrale chiudono; un file pulito senza domande', async () => {
  const s = openLayout({ 'a.js': { text: 'a', mtime: 1 }, 'b.js': { text: 'b', mtime: 1 }, 'c.js': { text: 'c', mtime: 1 } });
  const close = s.part(s.rows()[0], 'editor-open-close');
  const e = fire(close, 'click');
  assert.strictEqual(e.propagationStopped, true, 'la × non attiva la riga');
  await settle();
  assert.deepStrictEqual([...s.tab.editor.files.order], ['b.js', 'c.js']);
  fire(s.rows()[0], 'auxclick', { button: 1 });
  await settle();
  assert.deepStrictEqual([...s.tab.editor.files.order], ['c.js']);
  fire(s.rows()[0], 'auxclick', { button: 2 });
  await settle();
  assert.strictEqual(s.rows().length, 1, 'il tasto destro non chiude');
  assert.strictEqual(s.part(s.ui.openMenu, 'editor-open-menu-label').textContent, '1 aperto');
});

ok('aperti: conflitto col disco ed eliminato si vedono sulla riga', () => {
  const s = openLayout({ 'a.js': { text: 'a', mtime: 1 }, 'b.js': { text: 'b', mtime: 1 } });
  s.fn('setEditorFile')(s.tab, 'a.js', { conflict: 'disk', diskMtime: 2 });
  s.fn('setEditorFile')(s.tab, 'b.js', { deleted: true });
  const [a, b] = s.rows();
  assert.ok(a.classList.contains('is-trouble'));
  assert.ok(s.part(a, 'editor-open-warn'));
  assert.match(a.title, /cambiato sul disco/);
  assert.ok(b.classList.contains('is-deleted'));
  assert.ok(!b.classList.contains('is-trouble'));
});

ok('aperti: senza file la sezione è vuota, contatore e menu spariscono', () => {
  const s = openLayout({});
  assert.strictEqual(s.rows().length, 0);
  assert.strictEqual(s.ui.openCount.hidden, true);
  assert.strictEqual(s.ui.openMenu.hidden, true);
  assert.strictEqual(s.ui.title.children.length, 0);
});

ok('aperti: «Chiudi tutti» senza modifiche chiude tutto e salva la lista', async () => {
  const s = openLayout({ 'a.js': { text: 'a', mtime: 1 }, 'b.js': { text: 'b', mtime: 1 } });
  await s.fn('closeAllEditorFiles')(s.tab, s.ui.title);
  assert.strictEqual(s.tab.editor.files.order.length, 0);
  assert.strictEqual(s.rows().length, 0);
  assert.ok(s.sent('saveEditorSessions').length >= 1);
});

ok('aperti: «Chiudi tutti» con un file sporco chiede, e annullando non chiude niente', async () => {
  const s = openLayout({ 'a.js': { text: 'a', mtime: 1, dirty: true }, 'b.js': { text: 'b', mtime: 1 } });
  const asked = [];
  s.run('editorConfirm').choose = async (o) => { asked.push(o); return null; };
  await s.fn('closeAllEditorFiles')(s.tab, s.ui.title);
  assert.strictEqual(asked[0].title, '«a.js» ha modifiche non salvate');
  assert.strictEqual(asked[0].anchor, s.ui.title);
  assert.strictEqual(s.tab.editor.files.order.length, 2);
  s.run('editorConfirm').choose = async () => 'discard';
  await s.fn('closeAllEditorFiles')(s.tab, s.ui.title);
  assert.strictEqual(s.tab.editor.files.order.length, 0);
});

ok('aperti: il menu «N aperti» elenca i file con la scorciatoia e attiva quello scelto', () => {
  const s = openLayout({ 'src/a.js': { text: 'a', mtime: 1 }, 'b.css': { text: 'b', mtime: 1, dirty: true } });
  const menus = [];
  s.page.ctx.AisessEditorTree.showMenu = (o) => { menus.push(o); return { close() {} }; };
  s.fn('showEditorOpenMenu')(s.tab);
  const [a, b, sep, saveAll, closeAll] = menus[0].items;
  // La pagina finta è un Mac (navigator.platform MacIntel): ⌃1, non Alt 1
  assert.deepStrictEqual([a.label, a.detail, a.icon, a.key], ['a.js', 'src', 'file-code', '⌃1']);
  assert.ok(b.className.includes('is-active') && b.className.includes('is-dirty'));
  assert.strictEqual(sep.sep, true);
  assert.deepStrictEqual([saveAll.label, closeAll.label], ['Salva tutto', 'Chiudi tutti']);
  assert.ok(s.ui.openMenu.classList.contains('is-open'));
  a.run();
  assert.strictEqual(s.tab.editor.files.active, 'src/a.js');
  menus[0].onClose();
  assert.ok(!s.ui.openMenu.classList.contains('is-open'));
});

ok('aperti: ⌃N (Alt+N fuori dal Mac) porta davanti l N-esimo file, solo con una scheda editor davanti', () => {
  const s = openLayout({ 'a.js': { text: 'a', mtime: 1 }, 'b.js': { text: 'b', mtime: 1 } });
  s.fn('initEditorTabs')();
  const press = (code) => fire(s.page.ctx.document, 'keydown', { code, key: code.slice(-1), ctrlKey: true });
  s.run("activeId = 'tab-ed'");
  assert.strictEqual(press('Digit1').defaultPrevented, true);
  assert.strictEqual(s.tab.editor.files.active, 'a.js');
  assert.strictEqual(press('Digit3').defaultPrevented, false, 'non c è un terzo file: il tasto passa');
  s.run('activeId = null');
  assert.strictEqual(press('Digit2').defaultPrevented, false);
  assert.strictEqual(s.tab.editor.files.active, 'a.js');
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

/* ---------- chiudere con commenti (docs/plans/65) ---------- */

function withNote(s, rel) {
  s.tab.editor.notes = s.run('EditorNotes').add(s.tab.editor.notes, { rel, from: 1, to: 1, body: 'x', track: null }).state;
}

ok('commenti: chiudere un file pulito con commenti chiede, e Annulla lo tiene aperto', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1 } } });
  const asked = [];
  let answer = false;
  s.run('editorConfirm').ask = async (o) => { asked.push(o); return answer; };
  withNote(s, 'a.js');
  withNote(s, 'a.js');
  await s.fn('closeEditorFile')(s.tab, 'a.js', 'ancora');
  assert.deepStrictEqual(plain(asked.map((o) => [o.anchor, o.title, o.text, o.confirmLabel])),
    [['ancora', 'Chiudere «a.js»?', 'Chiudendo il file si perdono 2 commenti.', 'Chiudi']]);
  assert.ok(s.file('a.js'));
  answer = true;
  await s.fn('closeEditorFile')(s.tab, 'a.js', 'ancora');
  assert.strictEqual(s.file('a.js'), undefined);
  assert.strictEqual(s.run('EditorNotes').count(s.tab.editor.notes), 0);
});

ok('commenti: chiudere un file pulito senza commenti non chiede, e i commenti degli altri restano', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1 }, 'b.js': { text: 'due', mtime: 1 } } });
  let asked = 0;
  s.run('editorConfirm').ask = async () => { asked += 1; return false; };
  withNote(s, 'b.js');
  await s.fn('closeEditorFile')(s.tab, 'a.js', null);
  assert.strictEqual(asked, 0);
  assert.strictEqual(s.file('a.js'), undefined);
  assert.strictEqual(s.run('EditorNotes').count(s.tab.editor.notes), 1);
});

ok('commenti: chiudere un file con modifiche e commenti è la scelta di sempre, che dice dei commenti', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1, dirty: true } } });
  const asked = [];
  s.run('editorConfirm').choose = async (o) => { asked.push(o); return 'discard'; };
  withNote(s, 'a.js');
  await s.fn('closeEditorFile')(s.tab, 'a.js', null);
  assert.deepStrictEqual(plain(asked.map((o) => [o.title, o.text, o.choices.map((c) => c.value)])),
    [['«a.js» ha modifiche non salvate', 'Chiudendo il file si perde il commento.', ['save', 'discard']]]);
  assert.strictEqual(s.file('a.js'), undefined);
});

ok('commenti: chiudere la scheda con commenti chiede, nel fumetto della card o dell editor', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1 } } });
  const asked = [];
  s.run('closeConfirm').ask = async (o) => { asked.push(o); return false; };
  assert.strictEqual(await s.fn('confirmEditorClose')(s.tab, 'card'), true, 'niente commenti né modifiche: non chiede');
  withNote(s, 'a.js');
  withNote(s, 'a.js');
  assert.strictEqual(await s.fn('confirmEditorClose')(s.tab, 'card'), false);
  assert.deepStrictEqual(plain(asked.map((o) => [o.anchor, o.key, o.title, o.text, o.confirmLabel])),
    [['card', 'tab-ed', 'Chiudere «w»?', 'Chiudendo la scheda si perdono 2 commenti.', 'Chiudi']]);
  s.tab.editor.files = s.run('EditorFiles').update(s.tab.editor.files, 'a.js', { dirty: true });
  const chosen = [];
  s.run('editorConfirm').choose = async (o) => { chosen.push(o); return null; };
  assert.strictEqual(await s.fn('confirmEditorClose')(s.tab), false);
  assert.deepStrictEqual(plain(chosen.map((o) => [o.key, o.text])), [[null, 'Chiudendo la scheda si perdono 2 commenti.']]);
});

ok('commenti: rinominando un file aperto, il commento segue il nuovo nome', async () => {
  const s = setup({
    files: { 'a.js': { text: 'uno\ndue\n', mtime: 1 } },
    main: { editorRename: async () => ({ ok: true, rel: 'b.js' }), editorList: async () => ({ ok: true, entries: [] }) },
  });
  withNote(s, 'a.js');
  s.page.ctx.AisessEditorTree.promptName = async () => 'b.js';
  s.host.texts['b.js'] = s.host.texts['a.js'];
  await s.fn('renameEditorEntry')(s.tab, { rel: 'a.js', name: 'a.js', depth: 0 });
  await settle();
  const EditorNotes = s.run('EditorNotes');
  assert.strictEqual(EditorNotes.count(s.tab.editor.notes, 'b.js'), 1, 'il commento è sotto il nome nuovo');
  assert.strictEqual(EditorNotes.count(s.tab.editor.notes, 'a.js'), 0, 'niente più sotto il nome vecchio');
});
