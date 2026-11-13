'use strict';
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorWatch } = require('../lib/editor-watch');
const { createEditorSessionsStore } = require('../lib/editor-sessions');
const { savedBeforeBoot } = require('../lib/git-sessions');
const { installEditorCloseGuard } = require('./editor-close');
const { createEditorCopy, pickProperties } = require('../lib/editor-copy');
const { filesFromClipboard } = require('../lib/clipboard-files');
const { createEditorGit } = require('../lib/editor-git');
const { listAllFiles, gitStatusLetters } = require('../lib/editor-index');
const { createEditorDefinition } = require('../lib/editor-definition');
const { createEditorBackends } = require('../lib/editor-backend');
const { createEditorRemoteWatch } = require('../lib/editor-remote-watch');
const { createRemoteChannels } = require('../lib/remote-channel');
const { resolveBinary } = require('../lib/binaries');

/**
 * Canali IPC della sessione editor (docs/plans/60). La logica sta in lib/;
 * qui il collegamento, per non far crescere main.js. Ogni chiamata porta la
 * cartella della sessione (`root`) e un percorso relativo: editor-fs li
 * risolve e li confina ogni volta, il renderer non è creduto sulla parola.
 * `root` è una stringa (questo computer) o `{ env, dir }` (un server SSH,
 * docs/plans/94): lib/editor-backend.js sceglie dove vanno le operazioni.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{electron: {app: Electron.App, shell: Electron.Shell, BrowserWindow: typeof Electron.BrowserWindow,
 *   dialog?: Electron.Dialog, clipboard?: Electron.Clipboard},
 *   userDataDir?: () => string, trash?: (absPath: string) => Promise<void>, reveal?: (absPath: string) => void,
 *   onQuitCancelled?: () => void, platform?: string, channels?: object}} opts
 *   `userDataDir`, `trash`, `reveal` e `channels` (lib/remote-channel.js) si
 *   sostituiscono nei test; `onQuitCancelled`
 *   va a app/editor-close.js (un quit fermato dai file non salvati)
 */
function registerEditorHandlers(ipcMain, {
  electron,
  onQuitCancelled,
  userDataDir = () => electron.app.getPath('userData'),
  trash = (p) => electron.shell.trashItem(p),
  reveal = (p) => electron.shell.showItemInFolder(p),
  platform = process.platform,
  channels = createRemoteChannels({ resolveClient: (name) => resolveBinary(name) }),
} = {}) {
  let store = null;
  const sessions = () => (store = store || createEditorSessionsStore({ dir: userDataDir() }));
  const { backendFor, gitOptions } = createEditorBackends({ channels, platform });
  const files = (root) => backendFor(root).files;
  // Solo su questo computer: un percorso di qui o il file manager di qui
  const localOnly = (fn) => (payload, event) => {
    if (backendFor(payload.root).remote) return { ok: false, error: 'Non disponibile per una cartella su un server.' };
    return fn(payload, event);
  };
  const copier = (root) => createEditorCopy({ editorFs: createEditorFs({ root }), trash, platform });
  electron.app.on('will-quit', () => channels.closeAll());
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

  // Sul server non c'è fs.watch: polling degli mtime (lib/editor-remote-watch.js)
  const remoteWatchers = new Map(); // webContents.id → editor-remote-watch
  function remoteWatcherFor(sender) {
    const known = remoteWatchers.get(sender.id);
    if (known) return known;
    const w = createEditorRemoteWatch({
      onChange: (change) => { if (!sender.isDestroyed()) sender.send('editor-file-changed', change); },
    });
    remoteWatchers.set(sender.id, w);
    const forget = () => {
      sender.removeListener('destroyed', forget);
      sender.removeListener('did-start-loading', forget);
      w.close();
      if (remoteWatchers.get(sender.id) === w) remoteWatchers.delete(sender.id);
    };
    sender.once('destroyed', forget);
    sender.once('did-start-loading', forget);
    return w;
  }
  // La chiave dell'evento: l'ambiente davanti, due server hanno gli stessi percorsi
  const remoteKey = async (b, rel) => `${b.envKey}:${await b.resolve(rel)}`;

  ipcMain.handle('editor-list', guard(({ root, rel }) => files(root).list(rel)));
  // Il progetto tutto insieme (docs/plans/75): i file per Ctrl+P, le lettere git per l'albero
  ipcMain.handle('editor-list-all', guard(async ({ root }) => listAllFiles(await gitOptions(root))));
  ipcMain.handle('editor-git-status', guard(async ({ root }) => gitStatusLetters(await gitOptions(root))));
  ipcMain.handle('editor-read', guard(({ root, rel }) => files(root).read(rel)));
  ipcMain.handle('editor-write', guard(({ root, rel, text, expectedMtime, bom }) => files(root).write(rel, text, {
    expectedMtime: Number.isFinite(expectedMtime) ? expectedMtime : null,
    bom: bom === true,
  })));
  ipcMain.handle('editor-stat', guard(({ root, rel }) => files(root).stat(rel)));
  // Testo dell'ultimo commit, per le barrette delle righe cambiate (docs/plans/63)
  ipcMain.handle('editor-head-text', guard(async ({ root, rel }) => createEditorGit(await gitOptions(root)).headText(rel)));
  // Chi ha toccato la riga del cursore, sul testo dell'editor (docs/plans/73)
  ipcMain.handle('editor-blame-line', guard(async ({ root, rel, line, text }) => createEditorGit(await gitOptions(root)).blameLine(rel, line, text)));
  // Ctrl+click su un nome: dove è definito (docs/plans/71)
  ipcMain.handle('editor-definition', guard(async ({ root, word, from, line }) => createEditorDefinition(await gitOptions(root)).find({ word, from, line })));
  ipcMain.handle('editor-create', guard(({ root, rel }) => files(root).create(rel)));
  ipcMain.handle('editor-mkdir', guard(({ root, rel }) => files(root).mkdir(rel)));
  ipcMain.handle('editor-rename', guard(({ root, rel, name }) => files(root).rename(rel, name)));
  // Mai unlink: il cestino, così un errore si recupera
  ipcMain.handle('editor-trash', guard(async ({ root, rel }) => {
    const b = backendFor(root);
    if (b.remote) return b.files.trash(rel); // il cestino del server
    const target = b.files.trashTarget(rel);
    if (!target.ok) return target;
    await trash(target.path);
    return { ok: true };
  }));
  // «Mostra nel Finder» (piano 75): il file manager di sistema, col file selezionato
  ipcMain.handle('editor-reveal', guard(localOnly(({ root, rel }) => {
    const target = files(root).revealTarget(rel);
    if (!target.ok) return target;
    reveal(target.path);
    return { ok: true };
  })));
  ipcMain.handle('editor-watch', guard(async ({ root, rel }, event) => {
    const b = backendFor(root);
    if (b.remote) {
      const key = await remoteKey(b, rel);
      return { ok: true, path: key, armed: await remoteWatcherFor(event.sender).watch(key, b.files, rel) };
    }
    const abs = b.files.resolveInside(rel);
    return { ok: true, path: abs, armed: watcherFor(event.sender).watch(abs) };
  }));
  ipcMain.handle('editor-unwatch', guard(async ({ root, rel }, event) => {
    const b = backendFor(root);
    if (b.remote) {
      const rw = remoteWatchers.get(event.sender.id);
      if (rw) rw.unwatch(await remoteKey(b, rel));
      return { ok: true };
    }
    const w = watchers.get(event.sender.id);
    if (w) w.unwatch(b.files.resolveInside(rel));
    return { ok: true };
  }));
  // Copiare da fuori (docs/plans/61): il piano trova i conflitti, il
  // renderer chiede, la copia rifà i controlli e copia
  ipcMain.handle('editor-copy-plan', guard(localOnly(({ root, rel, sources }) => copier(root).planCopy(sources, rel))));
  ipcMain.handle('editor-copy-run', guard(localOnly(({ root, rel, sources, decisions }) => copier(root).runCopy({ sources, destRel: rel }, decisions))));
  // Percorsi scelti nella finestra del sistema o copiati nel file manager:
  // tornano al renderer, che li manda al piano come quelli del drop
  ipcMain.handle('editor-pick-files', guard(async (_payload, event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    const opts = { title: 'Copia qui', buttonLabel: 'Copia qui', properties: pickProperties(platform) };
    const r = await (win ? electron.dialog.showOpenDialog(win, opts) : electron.dialog.showOpenDialog(opts));
    return { ok: true, paths: r.canceled ? [] : r.filePaths };
  }));
  ipcMain.handle('editor-clipboard-files', guard(() => ({
    ok: true,
    paths: filesFromClipboard((format) => electron.clipboard.readBuffer(format), platform),
  })));
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
