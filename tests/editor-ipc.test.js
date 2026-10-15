const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { registerEditorHandlers } = require('../app/editor');

/* app/editor.js non chiede Electron: riceve ipcMain e quello che serve di
   Electron come parametri, quindi dei finti bastano. */
function setup(t, { electron: more = {}, ...extra } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edipc-'));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edroot-')));
  t.after(() => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  const trashed = [];
  const app = Object.assign(new EventEmitter(), { quit() {}, getPath: () => userData });
  registerEditorHandlers(ipcMain, {
    electron: { app, shell: {}, BrowserWindow: { fromWebContents: () => null }, ...more },
    trash: async (p) => { trashed.push(p); },
    ...extra,
  });
  const sender = Object.assign(new EventEmitter(), { id: 7, sent: [], isDestroyed: () => false, send(ch, v) { this.sent.push([ch, v]); } });
  const call = (channel, payload) => handlers.get(channel)({ sender }, payload);
  return { handlers, call, root, trashed, sender, app };
}

ok('ipc editor: ogni canale editor del preload ha il suo handler', (t) => {
  const { handlers } = setup(t);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('(editor-[a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(invoked.length >= 13, 'il preload espone ' + invoked.length + ' canali editor');
  for (const channel of invoked) assert.ok(handlers.has(channel), `${channel} nel preload ma senza handler`);
  assert.ok(/ipcRenderer\.on\('editor-file-changed'/.test(preload), 'manca onEditorFileChanged nel preload');
});

ok('ipc editor: payload mancanti o radici inesistenti rispondono con un errore', async (t) => {
  const { handlers, call } = setup(t);
  for (const channel of ['editor-list', 'editor-read', 'editor-write', 'editor-stat', 'editor-create', 'editor-mkdir', 'editor-rename', 'editor-trash', 'editor-watch', 'editor-copy-plan', 'editor-copy-run', 'editor-head-text']) {
    for (const payload of [undefined, null, {}, { root: '/non/esiste/proprio', rel: 'a' }]) {
      const r = await call(channel, payload);
      assert.strictEqual(r.ok, false, `${channel} con ${JSON.stringify(payload)}`);
      assert.ok(r.error || r.reason, `${channel} senza messaggio`);
    }
  }
  assert.ok(handlers.has('editor-unwatch'));
});

ok('ipc editor: scrive, rilegge, rinomina', async (t) => {
  const { call, root } = setup(t);
  assert.deepStrictEqual(await call('editor-create', { root, rel: 'a.txt' }), { ok: true });
  const r = await call('editor-read', { root, rel: 'a.txt' });
  const w = await call('editor-write', { root, rel: 'a.txt', text: 'ciao', expectedMtime: r.mtime, bom: 'sì' });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'ciao'); // bom solo se === true
  // expectedMtime che non è un numero vale null: il file esiste, quindi conflitto
  assert.strictEqual((await call('editor-write', { root, rel: 'a.txt', text: 'x', expectedMtime: '1' })).conflict, true);
  assert.deepStrictEqual(await call('editor-rename', { root, rel: 'a.txt', name: 'b.txt' }), { ok: true, rel: 'b.txt' });
});

ok('ipc editor: il cestino riceve solo il percorso confinato', async (t) => {
  const { call, root, trashed } = setup(t);
  fs.writeFileSync(path.join(root, 'a.txt'), '');
  assert.deepStrictEqual(await call('editor-trash', { root, rel: 'a.txt' }), { ok: true });
  assert.deepStrictEqual(trashed, [path.join(root, 'a.txt')]);
  assert.strictEqual((await call('editor-trash', { root, rel: '../x' })).ok, false);
  assert.strictEqual((await call('editor-trash', { root, rel: '' })).ok, false);
  assert.strictEqual(trashed.length, 1);
});

ok('ipc editor: watch risponde col percorso e unwatch lo toglie; fuori si rifiuta', async (t) => {
  const { call, root, sender } = setup(t);
  fs.writeFileSync(path.join(root, 'a.txt'), '');
  const w = await call('editor-watch', { root, rel: 'a.txt' });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.path, path.join(root, 'a.txt'));
  assert.strictEqual((await call('editor-watch', { root, rel: '../x' })).ok, false);
  assert.deepStrictEqual(await call('editor-unwatch', { root, rel: 'a.txt' }), { ok: true });
  sender.emit('destroyed'); // non deve lanciare
});

ok('ipc editor: le ricariche della pagina non accumulano listener sul webContents', async (t) => {
  const { call, root, sender } = setup(t);
  fs.writeFileSync(path.join(root, 'a.txt'), '');
  for (let i = 0; i < 3; i++) {
    assert.strictEqual((await call('editor-watch', { root, rel: 'a.txt' })).ok, true);
    sender.emit('did-start-loading'); // una ricarica: il watch della pagina si butta
  }
  assert.strictEqual(sender.listenerCount('destroyed'), 0);
  assert.strictEqual(sender.listenerCount('did-start-loading'), 0);
  assert.strictEqual((await call('editor-watch', { root, rel: 'a.txt' })).ok, true);
  sender.emit('destroyed');
  assert.strictEqual(sender.listenerCount('did-start-loading'), 0, 'chiusa la finestra non resta niente');
});

ok('ipc editor: sessioni salvate e rilette, ask dopo un riavvio', async (t) => {
  const { call } = setup(t);
  const list = [{ name: null, cwd: '/p', files: ['a.js'], active: 'a.js', startedAt: 1 }];
  assert.deepStrictEqual(await call('editor-sessions-save', { sessions: list }), { ok: true, sessions: list });
  const r = await call('editor-sessions', undefined);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sessions, list);
  assert.strictEqual(r.ask, false); // salvato adesso: la macchina non si è riavviata
});

ok('ipc editor: un quit fermato dalla pagina arriva a onQuitCancelled (la cattura riparte)', (t) => {
  let cancelled = 0;
  const { app } = setup(t, { onQuitCancelled: () => { cancelled += 1; } });
  const webContents = Object.assign(new EventEmitter(), { id: 9 });
  app.emit('browser-window-created', {}, Object.assign(new EventEmitter(), { webContents }));
  webContents.emit('will-prevent-unload', {}); // una ricarica: non è un quit
  assert.strictEqual(cancelled, 0);
  app.emit('before-quit');
  webContents.emit('will-prevent-unload', {});
  assert.strictEqual(cancelled, 1);
});

ok('ipc editor: piano e copia da fuori arrivano nella cartella della sessione', async (t) => {
  const { call, root } = setup(t);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edout-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const a = path.join(out, 'a.txt');
  fs.writeFileSync(a, 'ciao');
  const plan = await call('editor-copy-plan', { root, rel: '', sources: [a] });
  assert.strictEqual(plan.ok, true, plan.error);
  assert.deepStrictEqual(plan.conflicts, []);
  assert.deepStrictEqual(await call('editor-copy-run', { root, rel: '', sources: [a], decisions: {} }), { ok: true, copied: 1, skipped: 0, failed: [] });
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'ciao');
  assert.deepStrictEqual((await call('editor-copy-plan', { root, rel: '', sources: [a] })).conflicts, [{ name: 'a.txt', kind: 'file', existingKind: 'file' }]);
  assert.strictEqual((await call('editor-copy-plan', { root, rel: '../', sources: [a] })).ok, false);
});

ok('ipc editor: «Copia qui file…» apre il dialog del sistema sulla finestra di chi chiede', async (t) => {
  const shown = [];
  let answer = { canceled: false, filePaths: ['/x/a.txt', '/x/b'] };
  const win = { id: 'finestra' };
  const { call } = setup(t, {
    platform: 'linux',
    electron: {
      BrowserWindow: { fromWebContents: (wc) => (wc.id === 7 ? win : null) },
      dialog: { showOpenDialog: async (...args) => { shown.push(args); return answer; } },
    },
  });
  assert.deepStrictEqual(await call('editor-pick-files'), { ok: true, paths: ['/x/a.txt', '/x/b'] });
  assert.strictEqual(shown[0][0], win);
  assert.deepStrictEqual(shown[0][1].properties, ['openFile', 'multiSelections']);
  assert.strictEqual(shown[0][1].buttonLabel, 'Copia qui');
  answer = { canceled: true, filePaths: [] };
  assert.deepStrictEqual(await call('editor-pick-files'), { ok: true, paths: [] });
});

ok('ipc editor: «Incolla» legge i file dagli appunti nel main', async (t) => {
  const asked = [];
  const readBuffer = (format) => {
    asked.push(format);
    return format === 'x-special/gnome-copied-files' ? Buffer.from('copy\nfile:///tmp/a%20b.txt') : Buffer.alloc(0);
  };
  const { call } = setup(t, { platform: 'linux', electron: { clipboard: { readBuffer } } });
  assert.deepStrictEqual(await call('editor-clipboard-files'), { ok: true, paths: ['/tmp/a b.txt'] });
  assert.deepStrictEqual(asked, ['x-special/gnome-copied-files']);
});

ok('ipc editor: il testo di HEAD rifiuta percorsi fuori dalla cartella', async (t) => {
  const { call, root } = setup(t);
  assert.deepStrictEqual(await call('editor-head-text', { root, rel: '../fuori.txt' }), { ok: false, reason: 'outside' });
});
