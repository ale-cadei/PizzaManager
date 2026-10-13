'use strict';
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorWatch } = require('../lib/editor-watch');
const { createEditorSessionsStore } = require('../lib/editor-sessions');
const { savedBeforeBoot } = require('../lib/git-sessions');
const { installEditorCloseGuard } = require('./editor-close');

/**
 * Canali IPC della sessione editor (docs/plans/60). La logica sta in lib/;
 * qui il collegamento, per non far crescere main.js. Ogni chiamata porta la
 * cartella della sessione (`root`) e un percorso relativo: editor-fs li
 * risolve e li confina ogni volta, il renderer non è creduto sulla parola.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{electron: {app: Electron.App, shell: Electron.Shell, BrowserWindow: typeof Electron.BrowserWindow},
 *   userDataDir?: () => string, trash?: (absPath: string) => Promise<void>,
 *   onQuitCancelled?: () => void}} opts
 *   `userDataDir` e `trash` si sostituiscono nei test; `onQuitCancelled`
 *   va a app/editor-close.js (un quit fermato dai file non salvati)
 */
function registerEditorHandlers(ipcMain, {
  electron,
  onQuitCancelled,
  userDataDir = () => electron.app.getPath('userData'),
  trash = (p) => electron.shell.trashItem(p),
} = {}) {
  let store = null;
  const sessions = () => (store = store || createEditorSessionsStore({ dir: userDataDir() }));
  const files = (root) => createEditorFs({ root });
  const guard = (fn) => async (event, payload = {}) => {
    try {
      return await fn(payload || {}, event);
    } catch (e) {
      console.error('[editor]', e);
      return { ok: false, error: 'editor: ' + String((e && e.message) || e) };
    }
  };

  // Un watch per finestra: gli eventi tornano a chi li ha chiesti. Una
  // ricarica o una finestra chiusa li butta via tutti.
  const watchers = new Map(); // webContents.id → editor-watch
  function watcherFor(sender) {
    const known = watchers.get(sender.id);
    if (known) return known;
    const w = createEditorWatch({
      onChange: (change) => { if (!sender.isDestroyed()) sender.send('editor-file-changed', change); },
    });
    watchers.set(sender.id, w);
    // Scatta una sola delle due: l'altra si toglie, o a ogni ricarica si
    // aggiungerebbe un listener 'destroyed' al webContents
    const forget = () => {
      sender.removeListener('destroyed', forget);
      sender.removeListener('did-start-loading', forget);
      w.close();
      if (watchers.get(sender.id) === w) watchers.delete(sender.id);
    };
    sender.once('destroyed', forget);
    sender.once('did-start-loading', forget);
    return w;
  }

  ipcMain.handle('editor-list', guard(({ root, rel }) => files(root).list(rel)));
  ipcMain.handle('editor-read', guard(({ root, rel }) => files(root).read(rel)));
  ipcMain.handle('editor-write', guard(({ root, rel, text, expectedMtime, bom }) => files(root).write(rel, text, {
    expectedMtime: Number.isFinite(expectedMtime) ? expectedMtime : null,
    bom: bom === true,
  })));
  ipcMain.handle('editor-stat', guard(({ root, rel }) => files(root).stat(rel)));
  ipcMain.handle('editor-create', guard(({ root, rel }) => files(root).create(rel)));
  ipcMain.handle('editor-mkdir', guard(({ root, rel }) => files(root).mkdir(rel)));
  ipcMain.handle('editor-rename', guard(({ root, rel, name }) => files(root).rename(rel, name)));
  // Mai unlink: il cestino, così un errore si recupera
  ipcMain.handle('editor-trash', guard(async ({ root, rel }) => {
    const target = files(root).trashTarget(rel);
    if (!target.ok) return target;
    await trash(target.path);
    return { ok: true };
  }));
  ipcMain.handle('editor-watch', guard(({ root, rel }, event) => {
    const abs = files(root).resolveInside(rel);
    return { ok: true, path: abs, armed: watcherFor(event.sender).watch(abs) };
  }));
  ipcMain.handle('editor-unwatch', guard(({ root, rel }, event) => {
    const w = watchers.get(event.sender.id);
    if (w) w.unwatch(files(root).resolveInside(rel));
    return { ok: true };
  }));
  // Schede editor da riaprire (lib/editor-sessions.js); dopo un riavvio
  // della macchina `ask`: si propongono, non si riaprono da sole.
  ipcMain.handle('editor-sessions', guard(() => {
    const { sessions: list, savedAt } = sessions().readState();
    return { ok: true, sessions: list, ask: savedBeforeBoot(savedAt) };
  }));
  ipcMain.handle('editor-sessions-save', guard(({ sessions: list }) => ({ ok: true, sessions: sessions().write(list) })));

  installEditorCloseGuard({ app: electron.app, ipcMain, BrowserWindow: electron.BrowserWindow, onQuitCancelled });
}

module.exports = { registerEditorHandlers };
