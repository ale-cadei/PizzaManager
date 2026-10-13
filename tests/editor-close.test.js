const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { installEditorCloseGuard } = require('../app/editor-close');

function setup() {
  const handlers = new Map();
  const calls = [];
  const app = Object.assign(new EventEmitter(), { quit: () => calls.push('quit') });
  const webContents = Object.assign(new EventEmitter(), { id: 3, reload: () => calls.push('reload') });
  const win = Object.assign(new EventEmitter(), { webContents, close: () => calls.push('close') });
  const BrowserWindow = { fromWebContents: (wc) => (wc === webContents ? win : null) };
  installEditorCloseGuard({ app, ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, BrowserWindow });
  app.emit('browser-window-created', {}, win);
  const confirm = () => handlers.get('editor-close-confirmed')({ sender: webContents });
  return { app, win, webContents, calls, confirm };
}

ok('editor-close: un\'uscita fermata dal beforeunload si rifà alla conferma', async () => {
  const { app, win, webContents, calls, confirm } = setup();
  app.emit('before-quit');
  win.emit('close');
  webContents.emit('will-prevent-unload', {});
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'quit' });
  assert.deepStrictEqual(calls, ['quit']);
});

ok('editor-close: la chiusura della finestra si rifà chiudendo la finestra', async () => {
  const { win, webContents, calls, confirm } = setup();
  win.emit('close');
  webContents.emit('will-prevent-unload', {});
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'close' });
  assert.deepStrictEqual(calls, ['close']);
});

ok('editor-close: una ricarica si rifà ricaricando', async () => {
  const { webContents, calls, confirm } = setup();
  webContents.emit('will-prevent-unload', {});
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'reload' });
  assert.deepStrictEqual(calls, ['reload']);
});

ok('editor-close: senza niente in attesa la conferma non fa nulla', async () => {
  const { calls, confirm } = setup();
  assert.deepStrictEqual(await confirm(), { ok: true, what: null });
  assert.deepStrictEqual(calls, []);
});

ok('editor-close: l\'uscita annullata non resta appesa alla ricarica successiva', async () => {
  const { app, webContents, calls, confirm } = setup();
  app.emit('before-quit');
  webContents.emit('will-prevent-unload', {}); // l'utente sceglie Annulla: nessuna conferma
  webContents.emit('will-prevent-unload', {}); // poi Ctrl+R
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'reload' });
  assert.deepStrictEqual(calls, ['reload']);
});
