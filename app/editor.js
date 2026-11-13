'use strict';
const fs = require('fs');
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorWatch } = require('../lib/editor-watch');
const { createEditorSessionsStore } = require('../lib/editor-sessions');
const { savedBeforeBoot } = require('../lib/git-sessions');
const { installEditorCloseGuard } = require('./editor-close');
const { createEditorCopy, pickProperties } = require('../lib/editor-copy');
const { clipboardSelection, clipboardPayload } = require('../lib/clipboard-files');
const { createEditorGit } = require('../lib/editor-git');
const { listAllFiles, gitStatusLetters } = require('../lib/editor-index');
const { createEditorDefinition } = require('../lib/editor-definition');

/**
 * Canali IPC della sessione editor (docs/plans/60). La logica sta in lib/;
 * qui il collegamento, per non far crescere main.js. Ogni chiamata porta la
 * cartella della sessione (`root`) e un percorso relativo: editor-fs li
 * risolve e li confina ogni volta, il renderer non è creduto sulla parola.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{electron: {app: Electron.App, shell: Electron.Shell, BrowserWindow: typeof Electron.BrowserWindow,
 *   dialog?: Electron.Dialog, clipboard?: Electron.Clipboard},
 *   userDataDir?: () => string, trash?: (absPath: string) => Promise<void>, reveal?: (absPath: string) => void,
 *   onQuitCancelled?: () => void, platform?: string}} opts
 *   `userDataDir`, `trash` e `reveal` si sostituiscono nei test; `onQuitCancelled`
 *   va a app/editor-close.js (un quit fermato dai file non salvati)
 */
function registerEditorHandlers(ipcMain, {
  electron,
  onQuitCancelled,
  userDataDir = () => electron.app.getPath('userData'),
  trash = (p) => electron.shell.trashItem(p),
  reveal = (p) => electron.shell.showItemInFolder(p),
  platform = process.platform,
} = {}) {
  let store = null;
  const sessions = () => (store = store || createEditorSessionsStore({ dir: userDataDir() }));
  const files = (root) => createEditorFs({ root });
  const copier = (root) => createEditorCopy({ editorFs: files(root), trash, platform });
  // L'ultimo Ctrl+C / Ctrl+X dell'app: dice «taglia» quando il formato degli appunti non lo dice
  let lastPut = null;
  const readClipboard = () => clipboardSelection((format) => electron.clipboard.readBuffer(format), platform);
  const samePaths = (a, b) => a.length === b.length && a.every((p, i) => p === b[i]);
  /** Dopo uno spostamento gli appunti puntano a file che non ci sono più. */
  function forgetCut(sources) {
    const list = Array.isArray(sources) ? sources : [];
    if (samePaths(readClipboard().paths, list)) electron.clipboard.clear();
    if (lastPut && samePaths(lastPut.paths, list)) lastPut = null;
  }
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
  // Il progetto tutto insieme (docs/plans/75): i file per Ctrl+P, le lettere git per l'albero
  ipcMain.handle('editor-list-all', guard(({ root }) => listAllFiles({ root })));
  ipcMain.handle('editor-git-status', guard(({ root }) => gitStatusLetters({ root })));
  ipcMain.handle('editor-read', guard(({ root, rel }) => files(root).read(rel)));
  ipcMain.handle('editor-write', guard(({ root, rel, text, expectedMtime, bom }) => files(root).write(rel, text, {
    expectedMtime: Number.isFinite(expectedMtime) ? expectedMtime : null,
    bom: bom === true,
  })));
  ipcMain.handle('editor-stat', guard(({ root, rel }) => files(root).stat(rel)));
  // Testo dell'ultimo commit, per le barrette delle righe cambiate (docs/plans/63)
  ipcMain.handle('editor-head-text', guard(({ root, rel }) => {
    const f = files(root);
    return createEditorGit({ root: f.realRoot, resolve: f.resolveInside }).headText(rel);
  }));
  // Chi ha toccato la riga del cursore, sul testo dell'editor (docs/plans/73)
  ipcMain.handle('editor-blame-line', guard(({ root, rel, line, text }) => {
    const f = files(root);
    return createEditorGit({ root: f.realRoot, resolve: f.resolveInside }).blameLine(rel, line, text);
  }));
  // Ctrl+click su un nome: dove è definito (docs/plans/71)
  ipcMain.handle('editor-definition', guard(({ root, word, from, line }) => {
    const f = files(root);
    return createEditorDefinition({ root: f.realRoot }).find({ word, from, line });
  }));
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
  // «Mostra nel Finder» (piano 75): il file manager di sistema, col file selezionato
  ipcMain.handle('editor-reveal', guard(({ root, rel }) => {
    const target = files(root).revealTarget(rel);
    if (!target.ok) return target;
    reveal(target.path);
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
  // Copiare da fuori (docs/plans/61): il piano trova i conflitti, il
  // renderer chiede, la copia rifà i controlli e copia. Con `move` è un
  // taglia e incolla (docs/plans/95): spostati i file, gli appunti non li
  // trovano più e si svuotano.
  ipcMain.handle('editor-copy-plan', guard(({ root, rel, sources, move }) => copier(root).planCopy(sources, rel, { move: move === true })));
  ipcMain.handle('editor-copy-run', guard(async ({ root, rel, sources, decisions, move }) => {
    const r = await copier(root).runCopy({ sources, destRel: rel, move: move === true }, decisions);
    if (r.ok && r.moved && r.moved.length) forgetCut(sources);
    return r;
  }));
  // Percorsi scelti nella finestra del sistema o copiati nel file manager:
  // tornano al renderer, che li manda al piano come quelli del drop
  ipcMain.handle('editor-pick-files', guard(async (_payload, event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    const opts = { title: 'Copia qui', buttonLabel: 'Copia qui', properties: pickProperties(platform) };
    const r = await (win ? electron.dialog.showOpenDialog(win, opts) : electron.dialog.showOpenDialog(opts));
    return { ok: true, paths: r.canceled ? [] : r.filePaths };
  }));
  ipcMain.handle('editor-clipboard-files', guard(() => {
    const { paths, cut } = readClipboard();
    // uri-list e FileNameW non dicono se è un taglia: vale l'ultimo Ctrl+X qui, se sono quei file
    return { ok: true, paths, cut: cut === null ? Boolean(lastPut && lastPut.mode === 'cut' && samePaths(lastPut.paths, paths)) : cut };
  }));
  // Ctrl+C / Ctrl+X nell'albero (docs/plans/95): gli appunti del sistema,
  // così si incolla anche in un'altra scheda o nel file manager
  ipcMain.handle('editor-clipboard-put', guard(async ({ root, rel, mode }) => {
    if (typeof rel !== 'string' || !rel || (mode !== 'copy' && mode !== 'cut')) return { ok: false, error: 'Scegli un file o una cartella.' };
    const abs = files(root).resolveInside(rel); // lancia se esce dalla cartella
    if (!(await fs.promises.lstat(abs).catch(() => null))) return { ok: false, error: 'Non esiste più.' };
    const { format, buffer } = clipboardPayload([abs], mode, platform);
    electron.clipboard.writeBuffer(format, buffer);
    lastPut = { paths: [abs], mode };
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
