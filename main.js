const { app, BrowserWindow, Menu, ipcMain, shell: electronShell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { listCodexSessions } = require('./codex-sessions');
const { getDefaultShell } = require('./lib/shell');
const { getLoginPathSync } = require('./lib/login-path');
const { resolveBinary, resolveAllBinaries, augmentedEnv } = require('./lib/binaries');
const { buildCommand, installHint } = require('./lib/commands');
const { createHistoryStore } = require('./lib/history');
const { createAccountStore } = require('./lib/accounts');

let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty non disponibile:', e.message);
}

const ptys = new Map();
let mainWindow = null;

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

// ---------- Risoluzione binari (fix lancio da GUI/.deb con PATH minimo) ----------
function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Nuova sessione', accelerator: 'CmdOrCtrl+N', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-new-session'); } },
        { type: 'separator' },
        { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Ricarica' },
        { role: 'forceReload', label: 'Ricarica forzata' },
        { role: 'toggleDevTools', label: 'Strumenti di sviluppo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom originale' },
        { role: 'zoomIn', label: 'Aumenta zoom' },
        { role: 'zoomOut', label: 'Riduci zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        { role: 'close', label: 'Chiudi finestra' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Repository AISessionManager', click: async () => { await electronShell.openExternal('https://github.com/aisessionmanager/aisessionmanager'); } },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'AISessionManager',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    // Barra superiore in tema con il resto dell'app (nera):
    // - backgroundColor nero per il flash di avvio
    // - darkTheme: dice al SO/Chromium di usare controlli e menu scuri
    // - titleBarOverlay nera dove supportata (Win): mantiene i
    //   controlli nativi ma con fondo nero e simboli chiari
    backgroundColor: '#000000',
    darkTheme: true,
    // NOTA Linux: la menubar nativa (File/Edit/View/…) è disegnata dal
    // tema GTK del desktop e resta chiara anche con darkTheme. Per avere
    // una barra scura si nasconde quella nativa (il menu resta attivo per
    // gli acceleratori come Ctrl+N) e si usa la menubar in-app nel renderer
    // (scura, vedi renderer/index.html#menubar). Su macOS il menu nativo
    // segue già il tema scuro e va tenuto visibile.
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarOverlay: { color: '#000000', symbolColor: '#F2EFF4' },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  buildAppMenu();
  // Nasconde la menubar nativa su Linux/Windows (resta richiamabile con Alt).
  // Su macOS il menu vive nella barra di sistema: non toccarlo.
  if (process.platform !== 'darwin') {
    try { mainWindow.setMenuBarVisibility(false); } catch {}
  }
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // mainWindow.webContents.openDevTools(); // scommentare per debug
}

// Azioni della menubar scura in-app (renderer/index.html#menubar).
// Replica i ruoli del menu nativo così File/Edit/View/Window/Help
// funzionano anche con la menubar nativa nascosta.
ipcMain.handle('menu-action', async (event, { action } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'finestra non disponibile' };
  const wc = mainWindow.webContents;
  try {
    switch (action) {
      case 'new-session': wc.send('menu-new-session'); break;
      case 'quit': app.quit(); break;
      case 'undo': wc.undo(); break;
      case 'redo': wc.redo(); break;
      case 'cut': wc.cut(); break;
      case 'copy': wc.copy(); break;
      case 'paste': wc.paste(); break;
      case 'selectAll': wc.selectAll(); break;
      case 'reload': wc.reload(); break;
      case 'forceReload': wc.reloadIgnoringCache(); break;
      case 'devtools': wc.toggleDevTools(); break;
      case 'resetZoom': wc.setZoomLevel(0); break;
      case 'zoomIn': wc.setZoomLevel(wc.getZoomLevel() + 0.5); break;
      case 'zoomOut': wc.setZoomLevel(wc.getZoomLevel() - 0.5); break;
      case 'fullscreen': mainWindow.setFullScreen(!mainWindow.isFullScreen()); break;
      case 'minimize': mainWindow.minimize(); break;
      case 'close': mainWindow.close(); break;
      case 'open-repo': await electronShell.openExternal('https://github.com/aisessionmanager/aisessionmanager'); break;
      default: return { ok: false, error: `azione menu sconosciuta: ${action}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const [, p] of ptys) { try { p.kill(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});

// ---------- PTY IPC ----------
ipcMain.handle('pty-spawn', async (event, { id, type, cwd, resumeId, claudeAccountId, cols, rows }) => {
  if (!pty) return { ok: false, error: 'node-pty non installato. Esegui: npm install' };
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const { cmd, args, missing, searchedPath, resolvedVia } = buildCommand(type, resumeId);
  if (!cmd) {
    return {
      ok: false,
      error: `Binario '${missing}' non trovato nel PATH.\nPATH cercato: ${searchedPath}\n` + installHint(missing),
    };
  }
  let extraVars = {};
  let accountName = null;
  if (type === 'claude' && claudeAccountId && claudeAccountId !== 'oauth') {
    const ae = accounts().envFor(claudeAccountId);
    if (ae.error) return { ok: false, error: ae.error };
    extraVars = ae.vars;
    accountName = ae.name;
  } else if (type === 'claude') {
    const o = accounts().detectOauth();
    accountName = o.available ? 'OAuth' : null;
  }
  try {
    const p = pty.spawn(cmd, args, {
      name: 'xterm-color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: workdir,
      env: augmentedEnv([cmd], extraVars),
    });
    ptys.set(id, p);
    p.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('pty-data', { id, data });
    });
    p.onExit(({ exitCode, signal }) => {
      ptys.delete(id);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('pty-exit', { id, exitCode, signal });
    });
    history().append({ type, cwd: workdir, resumeId: resumeId || null, claudeAccountId: claudeAccountId || null, claudeAccountName: accountName, cmd: cmd + ' ' + args.join(' ') });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.on('pty-write', (event, { id, data }) => {
  const p = ptys.get(id);
  if (p) p.write(data);
});

ipcMain.on('pty-resize', (event, { id, cols, rows }) => {
  const p = ptys.get(id);
  if (p && cols > 0 && rows > 0) { try { p.resize(cols, rows); } catch {} }
});

ipcMain.handle('pty-kill', async (event, { id }) => {
  const p = ptys.get(id);
  if (p) { try { p.kill(); } catch {} ptys.delete(id); }
  return { ok: true };
});

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
// OpenCode: `opencode session list --format json`
ipcMain.handle('list-opencode-sessions', async (event, { limit } = {}) => {
  const r = resolveBinary('opencode');
  if (!r.path) {
    return {
      ok: false,
      error: `Binario 'opencode' non trovato nel PATH (${r.searchedPath || getLoginPathSync()}). Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode`,
      sessions: [],
    };
  }
  return new Promise((resolve) => {
    execFile(r.path, ['session', 'list', '--format', 'json', ...(limit ? ['-n', String(limit)] : [])],
      { timeout: 15000, maxBuffer: 10 * 1024 * 1024, env: augmentedEnv([r.path]) },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: `opencode errore (${r.path}): ${stderr || err.message}`, sessions: [] });
        try {
          const arr = JSON.parse(stdout);
          resolve({ ok: true, sessions: arr, binary: r.path });
        } catch (e) {
          resolve({ ok: false, error: 'Parse JSON opencode fallito. Output: ' + String(stdout).slice(0, 200), sessions: [] });
        }
      });
  });
});

// Codex CLI: scan ~/.codex/sessions/**/rollout-*.jsonl (vedi codex-sessions.js)
ipcMain.handle('list-codex-sessions', async (event, { limit } = {}) => {
  try {
    return listCodexSessions(limit);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
});

// Claude Code: scan ~/.claude/projects/**/*.jsonl
function claudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

ipcMain.handle('list-claude-sessions', async (event, { limit } = {}) => {
  const base = claudeProjectsDir();
  const out = [];
  try {
    if (!fs.existsSync(base)) return { ok: false, error: 'Directory ' + base + ' non trovata. Nessuna sessione Claude.', sessions: [] };
    const projDirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const proj of projDirs) {
      const dir = path.join(base, proj);
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        const fp = path.join(dir, f);
        try {
          const stat = fs.statSync(fp);
          const sessionId = path.basename(f, '.jsonl');
          // Leggi prime righe per titolo: cerca primo message user con text
          const fd = fs.openSync(fp, 'r');
          const buf = Buffer.alloc(64 * 1024);
          const n = fs.readSync(fd, buf, 0, buf.length, 0);
          fs.closeSync(fd);
          const head = buf.slice(0, n).toString('utf8');
          const lines = head.split('\n').slice(0, 40);
          let title = sessionId.slice(0, 8);
          let cwd = proj.replace(/^-/, '').replace(/-/g, '/');
          for (const line of lines) {
            if (!line.trim().startsWith('{')) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.cwd) cwd = obj.cwd;
              const msg = obj.message;
              if (msg && msg.role === 'user' && Array.isArray(msg.content)) {
                const t = msg.content.find(c => c.type === 'text' && c.text);
                if (t && t.text.trim()) { title = t.text.trim().slice(0, 80); break; }
              }
              if (typeof obj.summary === 'string' && obj.summary) title = obj.summary.slice(0, 80);
            } catch {}
          }
          out.push({ id: sessionId, title, projectDir: proj, cwd: cwd.startsWith('/') ? cwd : '/' + cwd, mtime: stat.mtimeMs, file: fp });
        } catch {}
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    const sliced = limit ? out.slice(0, limit) : out.slice(0, 100);
    return { ok: true, sessions: sliced };
  } catch (e) {
    return { ok: false, error: String(e.message), sessions: [] };
  }
});
