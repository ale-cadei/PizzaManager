const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { installQuitCapture } = require('../app/quit-capture');
const { installEditorCloseGuard } = require('../app/editor-close');

/* L'ultima cattura dello scrollback (app/quit-capture.js) e la guardia sui
   file non salvati dell'editor (app/editor-close.js) insieme, collegati come
   in main.js. Il quit si annulla quando la pagina ferma il beforeunload: la
   cattura deve ripartire e il quit dopo deve rifare la cattura finale. */
function setup() {
  const calls = [];
  const handlers = new Map();
  const page = { dirty: false, exited: false };
  const ptys = {
    startCapture: () => calls.push('start'),
    stopCapture: () => calls.push('stop'),
    captureDirty: async () => { calls.push('capture'); },
  };
  const webContents = Object.assign(new EventEmitter(), { id: 7, reload: () => {} });
  const win = Object.assign(new EventEmitter(), { webContents, close: () => {} });
  const app = new EventEmitter();
  // Come Electron: before-quit si può fermare; se passa, la finestra si
  // chiude e la pagina, con file sporchi, ferma il beforeunload
  app.quit = () => {
    const e = { prevented: false, preventDefault() { this.prevented = true; } };
    app.emit('before-quit', e);
    if (e.prevented) return;
    win.emit('close');
    if (page.dirty) webContents.emit('will-prevent-unload', {});
    else page.exited = true;
  };
  const quitCapture = installQuitCapture({ app, ptys, graceMs: 5 });
  installEditorCloseGuard({
    app, ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    BrowserWindow: { fromWebContents: () => win },
    onQuitCancelled: () => quitCapture.reset(),
  });
  app.emit('browser-window-created', {}, win);
  const confirm = () => handlers.get('editor-close-confirmed')({ sender: webContents });
  return { app, win, webContents, page, calls, confirm };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

ok('quit: senza file sporchi una cattura finale e l\'app esce', async () => {
  const { app, page, calls } = setup();
  app.quit();
  await settle();
  assert.deepStrictEqual(calls, ['stop', 'capture']);
  assert.strictEqual(page.exited, true);
});

ok('quit: annullato dal beforeunload, la cattura riparte e il quit dopo la rifà', async () => {
  const { app, page, calls } = setup();
  page.dirty = true;
  app.quit();
  await settle();
  assert.deepStrictEqual(calls, ['stop', 'capture', 'start'], 'annullato il quit, la cattura a intervalli resta ferma');
  assert.strictEqual(page.exited, false);

  // Un secondo Ctrl+Q, sempre annullato: la cattura finale si rifà
  calls.length = 0;
  app.quit();
  await settle();
  assert.deepStrictEqual(calls, ['stop', 'capture', 'start'], 'il flag è rimasto su: il quit dopo salta la cattura');
});

ok('quit: annullato e poi confermato, l\'app esce con una cattura finale e la cattura ferma', async () => {
  const { app, page, calls, confirm } = setup();
  page.dirty = true;
  app.quit();
  await settle();
  calls.length = 0;
  page.dirty = false; // il renderer ha salvato o scartato: editorExitConfirmed
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'quit' });
  await settle();
  assert.deepStrictEqual(calls, ['stop', 'capture']);
  assert.strictEqual(page.exited, true);
});

ok('quit: una chiusura di finestra o una ricarica fermate non toccano la cattura', async () => {
  const { win, webContents, calls } = setup();
  win.emit('close');
  webContents.emit('will-prevent-unload', {});
  webContents.emit('will-prevent-unload', {});
  await settle();
  assert.deepStrictEqual(calls, []);
});
