const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { listCodexSessions } = require('./lib/codex-sessions');
const { getDefaultShell } = require('./lib/shell');
const { getLoginPathSync } = require('./lib/login-path');
const { resolveAllBinaries } = require('./lib/binaries');
const { createHistoryStore } = require('./lib/history');
const { createAccountStore } = require('./lib/accounts');
const { listClaudeSessions } = require('./lib/claude-sessions');
const { listOpencodeSessions } = require('./lib/opencode-sessions');
const { createWindow } = require('./app/window');
const { runMenuAction } = require('./app/menu');
const { createPtyManager } = require('./app/pty');

let mainWindow = null;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Gli store si creano alla prima richiesta: app.getPath('userData') va chiamato
// quando Electron e' pronto, non al caricamento del modulo.
let _history = null;
function history() {
  if (!_history) _history = createHistoryStore({ dir: app.getPath('userData') });
  return _history;
}

let _accounts = null;
function accounts() {
  if (!_accounts) _accounts = createAccountStore({ dir: app.getPath('userData') });
  return _accounts;
}

const ptys = createPtyManager({ accounts, history, sendToRenderer });

// ---------- Risoluzione binari (fix lancio da GUI/.deb con PATH minimo) ----------
ipcMain.handle('menu-action', async (event, { action } = {}) => runMenuAction(action, mainWindow));

app.whenReady().then(() => {
  mainWindow = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  ptys.killAll();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- PTY IPC ----------
ipcMain.handle('pty-spawn', async (event, opts) => ptys.spawn(opts));
ipcMain.on('pty-write', (event, { id, data }) => ptys.write(id, data));
ipcMain.on('pty-resize', (event, { id, cols, rows }) => ptys.resize(id, cols, rows));
ipcMain.handle('pty-kill', async (event, { id }) => ptys.kill(id));

ipcMain.handle('get-defaults', async () => ({
  shell: getDefaultShell(),
  homedir: os.homedir(),
  platform: process.platform,
  path: getLoginPathSync(),
  binaries: resolveAllBinaries(),
}));

ipcMain.handle('check-deps', async () => ({
  ...resolveAllBinaries(),
  path: getLoginPathSync(),
}));

ipcMain.handle('get-history', async () => history().load());

// ---------- Account Claude: lista / aggiungi / elimina ----------
// Nota: le chiavi API non lasciano mai il main process; alla UI vanno solo id+nomi.
ipcMain.handle('list-claude-accounts', async () => ({
  oauth: accounts().detectOauth(),
  accounts: accounts().list(),
}));

ipcMain.handle('add-claude-account', async (event, payload = {}) => accounts().add(payload));

ipcMain.handle('delete-claude-account', async (event, { id } = {}) => accounts().remove(id));

ipcMain.handle('dialog-cwd', async () => {
  const { dialog } = require('electron');
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled) return null;
  return r.filePaths[0];
});

// ---------- Native sessions discovery ----------
ipcMain.handle('list-opencode-sessions', async (event, { limit } = {}) => listOpencodeSessions(limit));

// Codex CLI: scan ~/.codex/sessions/**/rollout-*.jsonl (vedi codex-sessions.js)
ipcMain.handle('list-codex-sessions', async (event, { limit } = {}) => {
  try {
    return listCodexSessions(limit);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
});

// Claude Code: scan ~/.claude/projects/**/*.jsonl (vedi lib/claude-sessions.js)
ipcMain.handle('list-claude-sessions', async (event, { limit } = {}) => {
  try {
    return listClaudeSessions(limit);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
});
