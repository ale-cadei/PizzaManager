const assert = require('node:assert');
const { test: ok } = require('node:test');
const { stub } = require('./renderer-page');
const { settle, setup, plain } = require('./editor-tab-setup');

/* Le barrette delle righe cambiate nella scheda editor (docs/plans/63,
   renderer/editor-tab-gutter.js), con la pagina vera e un host finto. */

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

ok('barrette: ricaricare e salvare non ricalcolano due volte', async () => {
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno', mtime: 100 } },
    main: { editorRead: read('uno\ndue'), editorWrite: async () => ({ ok: true, mtime: 300 }), editorHeadText: async () => ({ ok: true, text: 'uno' }) },
  });
  s.tab.editor.files = s.page.ctx.AisessEditorFiles.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'uno' } });
  // Come Monaco: replaceText cambia il testo e poi lo segna salvato, markSaved dice solo «pulito»
  const change = s.fn('onEditorTextChange');
  const { replaceText, markSaved } = s.host;
  s.host.replaceText = (rel, text) => { replaceText(rel, text); change(s.tab, rel, false, true); s.host.markSaved(rel); };
  s.host.markSaved = (rel) => { markSaved(rel); change(s.tab, rel, false, false); };
  s.fn('handleEditorFileChange')(s.tab, 'a.txt', { path: '/w/a.txt', exists: true, mtime: 200 });
  await settle();
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'add', from: 2, to: 2 }]]]);
  assert.ok(s.timers.every((t) => t.cleared), 'nessun ricalcolo in attesa dopo la ricarica');
  assert.strictEqual(await s.fn('saveEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.ok(s.timers.every((t) => t.cleared), 'salvare non arma un ricalcolo: il testo è lo stesso');
  assert.strictEqual(s.host.gutters.length, 1, 'HEAD uguale dopo il salvataggio: niente da ridisegnare');
});

ok('barrette: un file oltre il tetto di righe non si legge né si confronta', () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'x', mtime: 1 } } });
  const max = s.page.ctx.AisessEditorGutter.MAX_GUTTER_LINES;
  s.tab.editor.files = s.page.ctx.AisessEditorFiles.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'x' } });
  s.host.texts['a.txt'] = 'y\n'.repeat(max);
  s.host.reads.length = 0;
  s.fn('updateEditorGutter')(s.tab, 'a.txt');
  assert.deepStrictEqual(s.host.reads, [], 'il testo non si copia');
  assert.deepStrictEqual(s.host.gutters, [['a.txt', null]]);
  assert.strictEqual(s.file('a.txt').changes, null);
});

ok('barrette: chiudendo la scheda il ricalcolo in attesa si toglie', () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'a', mtime: 1 } } });
  s.fn('onEditorTextChange')(s.tab, 'a.txt', true);
  s.fn('disposeEditorTab')(s.tab);
  assert.strictEqual(s.timers[0].cleared, true);
  assert.strictEqual(s.tab.editor.gutterTimer, null);
});

ok('barrette: chiudendo il file il suo ricalcolo in attesa si toglie, non quello di un altro', () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'a', mtime: 1 }, 'b.txt': { text: 'b', mtime: 1 } } });
  s.fn('onEditorTextChange')(s.tab, 'a.txt', true);
  s.fn('dropEditorFile')(s.tab, 'a.txt');
  assert.strictEqual(s.timers[0].cleared, true);
  assert.strictEqual(s.tab.editor.gutterTimer, null);

  // il timer di un file diverso da quello chiuso resta armato
  s.fn('onEditorTextChange')(s.tab, 'b.txt', true);
  s.fn('dropEditorFile')(s.tab, 'a.txt'); // già chiuso: niente da fare
  assert.strictEqual(s.timers[1].cleared, false);
  assert.deepStrictEqual(plain(s.tab.editor.gutterTimer), { rel: 'b.txt', id: s.tab.editor.gutterTimer.id });
});

ok('barrette: chiudendo un file il suo contatore si toglie; una lettura di prima non vale per il file riaperto', async () => {
  const resolvers = [];
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno\ndue\n', mtime: 1 } },
    main: { editorHeadText: () => new Promise((resolve) => resolvers.push(resolve)) },
  });
  const Files = s.page.ctx.AisessEditorFiles;
  const before = s.fn('loadEditorGutterBase')(s.tab, 'a.txt');
  s.fn('dropEditorFile')(s.tab, 'a.txt');
  assert.strictEqual(s.tab.editor.gutterSeq.has('a.txt'), false);
  // riaperto: stato nuovo, nuova lettura
  s.tab.editor.files = Files.open(s.tab.editor.files, 'a.txt', { path: '/w/a.txt', mtime: 1, bom: false });
  const after = s.fn('loadEditorGutterBase')(s.tab, 'a.txt');
  resolvers[0]({ ok: true, text: 'vecchio\n' }); // la lettura di prima della chiusura
  await before;
  assert.strictEqual(s.file('a.txt').gutterBase, null, 'la risposta di prima della chiusura si scarta');
  resolvers[1]({ ok: true, text: 'uno\n' });
  await after;
  assert.strictEqual(s.file('a.txt').gutterBase.text, 'uno\n');
});

ok('barrette: una lettura di HEAD fallita si scrive in console una volta per cartella e motivo', async () => {
  const s = gutterSetup({
    files: { 'a.txt': { text: 'a', mtime: 1 }, 'b.txt': { text: 'b', mtime: 1 } },
    main: { editorHeadText: async () => ({ ok: false, reason: 'error', error: 'fatal: detected dubious ownership' }) },
  });
  const warned = [];
  s.page.ctx.console = { ...console, warn: (...args) => warned.push(args) };
  for (const rel of ['a.txt', 'b.txt', 'a.txt']) await s.fn('loadEditorGutterBase')(s.tab, rel);
  assert.strictEqual(warned.length, 1, JSON.stringify(warned));
  s.tab.cwd = '/altra';
  await s.fn('loadEditorGutterBase')(s.tab, 'a.txt');
  assert.strictEqual(warned.length, 2, 'un altra cartella si scrive di nuovo');
});

ok('barrette: rinominando un file aperto si rilegge HEAD col percorso nuovo', async () => {
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno\ndue\n', mtime: 1 } },
    main: {
      editorRename: async () => ({ ok: true, rel: 'b.txt' }),
      editorList: async () => ({ ok: true, entries: [] }),
      editorHeadText: async (root, rel) => ({ ok: true, text: rel === 'b.txt' ? 'uno\n' : null }),
    },
  });
  const Files = s.page.ctx.AisessEditorFiles;
  s.tab.editor.files = Files.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: null }, changes: [] });
  s.page.ctx.AisessEditorTree.promptName = async () => 'b.txt';
  s.tab.editor.ui.tree = { element: stub(), rowOf: () => null, render: () => {} };
  s.host.texts['b.txt'] = s.host.texts['a.txt'];
  await s.fn('renameEditorEntry')(s.tab, { rel: 'a.txt', name: 'a.txt', depth: 0 });
  await settle();
  assert.deepStrictEqual(s.sent('editorHeadText').map((c) => c.slice(1)), [['/w', 'b.txt']]);
  assert.strictEqual(s.file('b.txt').gutterBase.text, 'uno\n');
  assert.deepStrictEqual(plain(s.host.gutters.pop()), ['b.txt', [{ kind: 'add', from: 2, to: 2 }]]);
  assert.strictEqual(s.tab.editor.gutterSeq.has('a.txt'), false);
});

ok('barrette: due letture di HEAD per lo stesso file possono risolvere in ordine invertito: vince la più recente', async () => {
  const resolvers = [];
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno\ndue\n', mtime: 1 } },
    main: { editorHeadText: () => new Promise((resolve) => resolvers.push(resolve)) },
  });
  const stale = s.fn('loadEditorGutterBase')(s.tab, 'a.txt'); // partita per prima, risponde dopo
  const fresh = s.fn('loadEditorGutterBase')(s.tab, 'a.txt'); // partita dopo, risponde prima
  assert.strictEqual(resolvers.length, 2);
  resolvers[1]({ ok: true, text: 'uno\n' }); // la lettura più recente arriva per prima
  await fresh;
  await settle();
  assert.strictEqual(s.file('a.txt').gutterBase.text, 'uno\n');
  assert.deepStrictEqual(plain(s.host.gutters.pop()), ['a.txt', [{ kind: 'add', from: 2, to: 2 }]]);

  resolvers[0]({ ok: true, text: 'altro\n' }); // la lettura superata arriva dopo: si scarta
  await stale;
  await settle();
  assert.strictEqual(s.file('a.txt').gutterBase.text, 'uno\n', 'la risposta vecchia non sovrascrive');
  assert.deepStrictEqual(s.host.gutters, [], 'niente ridisegnato per la risposta scartata');
});
