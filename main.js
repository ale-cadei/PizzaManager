const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const { getDefaultShell, platformLabel } = require('./lib/shell');
const { getLoginPathSync, primeLoginPath } = require('./lib/login-path');
const path = require('path');
const { resolveAllBinaries } = require('./lib/binaries');
const { checkDeps } = require('./lib/setup-check');
const { detectTmux } = require('./lib/tmux');
const { createHistoryStore } = require('./lib/history');
const { createAccountStore } = require('./lib/accounts');
const { createProfileStore } = require('./lib/profiles');
const { createLiveSessionsStore } = require('./lib/live-sessions');
const { createScrollbackStore } = require('./lib/scrollback');
const { listClaudeSessions } = require('./lib/claude-sessions');
const { listOpencodeSessions } = require('./lib/opencode-sessions');
const { listCodexSessions } = require('./lib/codex-sessions');
const { listAntigravitySessions } = require('./lib/antigravity-sessions');
const { createSearchWorker } = require('./lib/search-worker');
const { collectUsage } = require('./lib/usage');
const { computeRecentDirs } = require('./lib/recent-dirs');
const { findProjectRoot } = require('./lib/project-root');
const { listExtensions } = require('./lib/extensions');
const { createWindow } = require('./app/window');
const { runMenuAction } = require('./app/menu');
const { createPtyManager } = require('./app/pty');
const { registerClipboardHandlers } = require('./app/clipboard');
const { installQuitCapture } = require('./app/quit-capture');
const { registerExportHandlers } = require('./app/export');
const { registerGitHandlers } = require('./app/git');

// La cartella dei dati NON segue il nome dell'app. Electron la deriva da
// productName: un rebrand ("PizzaManager") la sposterebbe in una cartella nuova
// e vuota, e l'utente si ritroverebbe senza profili, cronologia e account —
// e' successo. Il nome qui e' fisso per sempre, qualunque cosa dica package.json.
const USER_DATA_DIR_NAME = 'AISessionManager';
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIR_NAME));

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
const liveStore = lazy(() => createLiveSessionsStore({ dir: app.getPath('userData') }));
const scrollbackStore = lazy(() => createScrollbackStore({ dir: app.getPath('userData') }));
// Ricerca nei messaggi delle conversazioni: in un thread, il main resta libero
const conversationSearch = lazy(() => createSearchWorker());

// tmux, se c'e', fa vivere le sessioni fuori dall'app (docs/plans/06-tmux-backend.md).
// Senza, si ricade sul comportamento classico: il processo muore con la finestra.
const tmux = detectTmux({ confPath: path.join(__dirname, 'app', 'tmux.conf') });

const ptys = createPtyManager({
  accounts, history, profiles: { load: () => profiles().load() }, sendToRenderer, tmux, liveStore, scrollbackStore,
  // Lingua di sistema: sceglie LANG per i processi quando l'app, avviata dal
  // Finder, non ce l'ha. Funzione perche' app.getLocale() vale solo dopo `ready`.
  systemLocale: () => { try { return app.getLocale(); } catch { return null; } },
});

function fail(prefix, e) {
  return { ok: false, error: prefix + String((e && e.message) || e) };
}

// ---------- Finestra e ciclo di vita ----------
ipcMain.handle('menu-action', async (event, { action } = {}) => runMenuAction(action, mainWindow));
app.whenReady().then(() => {
  // La shell di login si interroga in background: la finestra appare subito,
  // gli handler che hanno bisogno del PATH completo la aspettano (await).
  primeLoginPath();
  // Il testo delle shell: via i file orfani, poi si salva a intervalli (un
  // riavvio non avvisa) e un'ultima volta prima di uscire.
  ptys.startCapture();
  installQuitCapture({ app, ptys });
  mainWindow = createWindow({ onRendererReload: () => ptys.closeAll() });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow({ onRendererReload: () => ptys.closeAll() });
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
ipcMain.handle('pty-scroll', (event, { id, ...req }) => ptys.scroll(id, req));
ipcMain.handle('pty-capture-shell', (event, { id } = {}) => ptys.captureShell(id));
// 'pty-kill' chiude il pty della scheda: con tmux e' uno stacco, il processo resta.
ipcMain.handle('pty-kill', async (event, { id }) => ptys.close(id));
ipcMain.handle('pty-terminate', async (event, { id }) => ptys.terminate(id));
ipcMain.handle('list-live-sessions', async () => ptys.listLive());
ipcMain.on('pty-set-label', (event, { id, label }) => ptys.setLabel(id, label));
ipcMain.on('pty-set-meta', (event, { id, ...meta }) => ptys.setMeta(id, meta));
// Dopo un riavvio della macchina: cosa c'era e non c'e' piu' (lib/live-sessions.js)
ipcMain.handle('restorable-sessions', async () => ptys.restorable());
ipcMain.handle('discard-restorable', async () => ptys.discardRestorable());
ipcMain.handle('terminate-session', async (event, { session } = {}) => ptys.terminateSession(session));

// ---------- Ambiente ----------
ipcMain.handle('get-defaults', async () => {
  await primeLoginPath();
  return {
    shell: getDefaultShell(),
    homedir: os.homedir(),
    platform: process.platform,
    label: platformLabel(process.platform, getDefaultShell()),
    path: getLoginPathSync(),
    binaries: resolveAllBinaries(),
    tmux: { available: ptys.viaTmux, path: tmux ? tmux.bin : null },
  };
});

// Binari, PATH e (per la schermata vuota) che cosa manca: lib/setup-check.js
ipcMain.handle('check-deps', async () => { await primeLoginPath(); return checkDeps({ tmuxAvailable: ptys.viaTmux }); });

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
ipcMain.handle('list-extensions', async (event, { cwd } = {}) => listExtensions({ cwd: typeof cwd === 'string' ? cwd : null }));
ipcMain.handle('search-conversations', async (event, { query, scope, allSnippets } = {}) => conversationSearch().search(query, scope, allSnippets));
// Una conversazione in Markdown: il percorso lo sceglie il dialog, non il renderer
registerExportHandlers(ipcMain, { getWindow: () => mainWindow });

// ---------- Uso di token: sessione, finestra 5h, settimana (barra in basso) ----------
// `tab` porta solo id: la config dir dell'account la ricava lib/usage dai profili
ipcMain.handle('usage-snapshot', async (event, { active, tab } = {}) => {
  try {
    return { ok: true, usage: await collectUsage({ active, tab, profiles: { load: () => profiles().load() }, limitsDir: app.getPath('userData') }) };
  } catch (e) {
    console.error('usage-snapshot fallito:', e);
    return { ...fail('', e), usage: null };
  }
});

// ---------- Appunti (per term-clipboard.js nel renderer) ----------
registerClipboardHandlers(ipcMain);
registerGitHandlers(ipcMain, { userDataDir: () => app.getPath('userData') });
