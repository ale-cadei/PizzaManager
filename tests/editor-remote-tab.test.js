// La scheda editor su un server SSH nel renderer (docs/plans/94): la cartella
// viaggia come `{ env, dir }`, gli eventi del watch hanno l'ambiente davanti,
// quello che legge il disco locale non parte.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { settle, setup, plain } = require('./editor-tab-setup');

function remoteSetup(o) {
  const s = setup(o);
  s.tab.env = 'ssh:nas';
  s.tab.cwd = '~/prj';
  return s;
}

ok('scheda remota: le richieste al main portano { env, dir }', async () => {
  const { tab, fn, sent } = remoteSetup({
    files: { 'a.js': { text: 'uno', mtime: 100 } },
    main: { editorRead: async () => ({ ok: true, text: 'due', mtime: 200, path: '/home/u/prj/a.js', bom: false }) },
  });
  assert.deepStrictEqual(plain(fn('editorRoot')(tab)), { env: 'ssh:nas', dir: '~/prj' });
  fn('handleEditorFileChange')(tab, 'a.js', { path: '/w/a.js', exists: true, mtime: 200 });
  await settle();
  assert.deepStrictEqual(plain(sent('editorRead').map((c) => c.slice(1))), [[{ env: 'ssh:nas', dir: '~/prj' }, 'a.js']]);
});

ok('scheda locale: la cartella resta una stringa', () => {
  const { tab, fn } = setup();
  assert.strictEqual(fn('editorRoot')(tab), '/w');
  tab.env = 'local';
  assert.strictEqual(fn('editorRoot')(tab), '/w');
});

ok('eventi del watch: una scheda remota prende solo quelli del suo server', () => {
  const { tab, fn } = remoteSetup();
  const pathFor = fn('editorChangePath');
  assert.strictEqual(pathFor(tab, 'ssh:nas:/home/u/prj/a.js'), '/home/u/prj/a.js');
  assert.strictEqual(pathFor(tab, 'ssh:pi:/home/u/prj/a.js'), null);
  assert.strictEqual(pathFor(tab, '/home/u/prj/a.js'), null);
  const local = setup().tab;
  assert.strictEqual(pathFor(local, '/w/a.js'), '/w/a.js');
});

ok('scheda remota: niente copie dal disco locale né branch da git-branches', async () => {
  const { tab, fn, calls } = remoteSetup();
  await fn('copyIntoEditor')(tab, '', { kind: 'paste' });
  await fn('putEditorClipboard')(tab, { rel: 'a.js', name: 'a.js', kind: 'file' }, 'cut');
  await fn('loadEditorBranch')(tab);
  await settle();
  const names = calls.map((c) => c[0]);
  assert.ok(!names.some((n) => /^editorCopy|^editorClipboard|^gitBranches$|^clipboardFiles|^pickFiles/.test(n)), names.join(','));
});

ok('modal: su SSH Editor sì e Git no, su WSL nessuno dei due, in locale tutti', () => {
  const { fn } = setup();
  const available = fn('panelAvailable');
  assert.deepStrictEqual(
    ['editor', 'git', 'shell'].map((t) => [available(t, 'local'), available(t, 'ssh:nas'), available(t, 'wsl:Debian')]),
    [[true, true, false], [true, false, false], [true, true, true]],
  );
});
