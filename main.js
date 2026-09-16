const { app, BrowserWindow, ipcMain, clipboard, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const { getDefaultShell } = require('./lib/shell');
const { getLoginPathSync } = require('./lib/login-path');
const path = require('path');
const { resolveAllBinaries } = require('./lib/binaries');
const { detectTmux } = require('./lib/tmux');
const { createHistoryStore } = require('./lib/history');
const { createAccountStore } = require('./lib/accounts');
const { createProfileStore } = require('./lib/profiles');
const { listClaudeSessions } = require('./lib/claude-sessions');
const { listOpencodeSessions } = require('./lib/opencode-sessions');
const { listCodexSessions } = require('./lib/codex-sessions');
const { listAntigravitySessions } = require('./lib/antigravity-sessions');
const { computeRecentDirs } = require('./lib/recent-dirs');
const { findProjectRoot } = require('./lib/project-root');
const { createWindow } = require('./app/window');
const { runMenuAction } = require('./app/menu');
const { createPtyManager } = require('./app/pty');

let mainWindow = null;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Gli store si creano alla prima richiesta: app.getPath('userData') va chiamato
// quando Electron e' pronto, non al caricamento del modulo.
const lazy = (make) => { let v = null; return () => (v || (v = make())); };
const history = lazy(() => createHistoryStore({ dir: app.getPath('userData') }));
const accounts = lazy(() => createAccountStore({ dir: app.getPath('userData') }));
const profiles = lazy(() => createProfileStore({ dir: app.getPath('userData') }));

// tmux, se c'e', fa vivere le sessioni fuori dall'app (docs/plans/06-tmux-backend.md).
// Senza, si ricade sul comportamento classico: il processo muore con la finestra.
const tmux = detectTmux({ confPath: path.join(__dirname, 'app', 'tmux.conf') });

const ptys = createPtyManager({ accounts, history, profiles: { load: () => profiles().load() }, sendToRenderer, tmux });

function fail(prefix, e) {
  return { ok: false, error: prefix + String((e && e.message) || e) };
}

// ---------- Finestra e ciclo di vita ----------
ipcMain.handle('menu-action', async (event, { action } = {}) => runMenuAction(action, mainWindow));

app.whenReady().then(() => {
  mainWindow = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  // Con tmux e' uno stacco: le sessioni restano vive e si ritrovano alla riapertura.
  ptys.closeAll();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- PTY ----------
ipcMain.handle('pty-spawn', async (event, opts) => ptys.spawn(opts));
ipcMain.handle('pty-attach', async (event, opts) => ptys.attach(opts));
ipcMain.on('pty-write', (event, { id, data }) => ptys.write(id, data));
ipcMain.on('pty-resize', (event, { id, cols, rows }) => ptys.resize(id, cols, rows));
// 'pty-kill' chiude il pty della scheda: con tmux e' uno stacco, il processo resta.
ipcMain.handle('pty-kill', async (event, { id }) => ptys.close(id));
ipcMain.handle('pty-terminate', async (event, { id }) => ptys.terminate(id));
ipcMain.handle('list-live-sessions', async () => ptys.listLive());
ipcMain.on('pty-set-label', (event, { id, label }) => ptys.setLabel(id, label));
ipcMain.handle('terminate-session', async (event, { session } = {}) => ptys.terminateSession(session));

// ---------- Ambiente ----------
ipcMain.handle('get-defaults', async () => ({
  shell: getDefaultShell(),
  homedir: os.homedir(),
  platform: process.platform,
  path: getLoginPathSync(),
  binaries: resolveAllBinaries(),
  tmux: { available: ptys.viaTmux, path: tmux ? tmux.bin : null },
}));

ipcMain.handle('check-deps', async () => ({ ...resolveAllBinaries(), path: getLoginPathSync() }));

ipcMain.handle('dialog-cwd', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- Cronologia e directory recenti ----------
ipcMain.handle('get-history', async () => history().load());

ipcMain.handle('get-recent-dirs', async (event, { limit } = {}) => {
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  try {
    return computeRecentDirs(history().load(), { limit, exists: isDir });
  } catch (e) {
    console.error('get-recent-dirs fallito:', e);
    return [];
  }
});

ipcMain.handle('resolve-project', async (event, { cwd } = {}) => {
  try {
    return { ok: true, root: findProjectRoot(cwd) };
  } catch (e) {
    console.error('resolve-project fallito:', e);
    return { ...fail('', e), root: null };
  }
});

// ---------- Account Claude ----------
// Le chiavi API non lasciano mai il main process: alla UI vanno solo id+nomi.
ipcMain.handle('list-claude-accounts', async () => ({ oauth: accounts().detectOauth(), accounts: accounts().list() }));
ipcMain.handle('add-claude-account', async (event, payload = {}) => accounts().add(payload));
ipcMain.handle('delete-claude-account', async (event, { id } = {}) => accounts().remove(id));

// ---------- Profili di comando ----------
ipcMain.handle('get-command-profiles', async () => {
  try {
    return { ok: true, config: profiles().load(), defaults: profiles().defaults() };
  } catch (e) {
    console.error('get-command-profiles fallito:', e);
    return { ...fail('', e), config: { version: 1, profiles: {} }, defaults: {} };
  }
});

ipcMain.handle('save-command-profiles', async (event, { profiles: raw } = {}) => {
  const v = profiles().validate(raw);
  if (!v.ok) return v;
  try {
    return { ok: true, config: profiles().save({ profiles: raw }) };
  } catch (e) {
    return fail('Salvataggio fallito: ', e);
  }
});

ipcMain.handle('reset-command-profiles', async () => {
  try {
    return { ok: true, config: profiles().save({ profiles: profiles().defaults() }) };
  } catch (e) {
    return fail('Ripristino fallito: ', e);
  }
});

// ---------- Scoperta sessioni native ----------
ipcMain.handle('list-opencode-sessions', async (event, { limit } = {}) => listOpencodeSessions(limit));
ipcMain.handle('list-codex-sessions', async (event, { limit } = {}) => {
  try { return listCodexSessions(limit); } catch (e) { return { ...fail('', e), sessions: [] }; }
});
ipcMain.handle('list-claude-sessions', async (event, { limit } = {}) => {
  try { return listClaudeSessions(limit); } catch (e) { return { ...fail('', e), sessions: [] }; }
});
ipcMain.handle('list-antigravity-sessions', async (event, { limit } = {}) => {
  try { return listAntigravitySessions(limit); } catch (e) { return { ...fail('', e), sessions: [] }; }
});

// ---------- Appunti (per term-clipboard.js nel renderer) ----------
ipcMain.handle('clipboard-write', (event, { text } = {}) => {
  if (typeof text !== 'string' || !text) return { ok: false, error: 'niente da copiare' };
  try { clipboard.writeText(text); return { ok: true }; } catch (e) { console.error('[clipboard-write]', e); return fail('', e); }
});
ipcMain.handle('clipboard-read', () => {
  try { return { ok: true, text: clipboard.readText() || '' }; } catch (e) { console.error('[clipboard-read]', e); return { ...fail('', e), text: '' }; }
});
