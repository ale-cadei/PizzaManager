const { app, BrowserWindow, Menu, ipcMain, shell: electronShell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { listCodexSessions } = require('./codex-sessions');
const { getDefaultShell } = require('./lib/shell');
const { getLoginPathSync } = require('./lib/login-path');

// Binari delle sessioni AI gestite (lo shell non passa da resolveBinary)
const AI_BINARIES = ['opencode', 'claude', 'codex'];

let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty non disponibile:', e.message);
}

const ptys = new Map();
let mainWindow = null;

// ---------- Risoluzione binari (fix lancio da GUI/.deb con PATH minimo) ----------
function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    const st = fs.statSync(p);
    return st.isFile();
  } catch { return false; }
}

// Percorsi tipici dei tool installati via npm/volta/asdf/nvm/homebrew
function nodeToolCandidates(name) {
  const home = os.homedir();
  const list = [
    path.join(home, '.local', 'bin', name),
    '/usr/local/bin/' + name,
    '/opt/homebrew/bin/' + name,
    '/home/linuxbrew/.linuxbrew/bin/' + name,
    path.join(home, '.npm-global', 'bin', name),
    path.join(home, '.volta', 'bin', name),
    path.join(home, '.asdf', 'shims', name),
  ];
  // nvm: ~/.nvm/versions/node/*/bin/<name>
  try {
    const base = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(base)) {
      for (const v of fs.readdirSync(base)) list.push(path.join(base, v, 'bin', name));
    }
  } catch {}
  return list;
}

function candidatesFor(name) {
  const home = os.homedir();
  if (name === 'opencode') {
    return [
      path.join(home, '.opencode', 'bin', 'opencode'),
      path.join(home, '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/opt/opencode/opencode',
      '/snap/bin/opencode',
      '/opt/homebrew/bin/opencode',
      '/home/linuxbrew/.linuxbrew/bin/opencode',
    ];
  }
  if (name === 'claude') return nodeToolCandidates('claude');
  // Codex CLI: npm @openai/codex, homebrew, o binario in ~/.codex/bin
  if (name === 'codex') return [path.join(home, '.codex', 'bin', 'codex'), ...nodeToolCandidates('codex')];
  return [];
}

function resolveBinary(name) {
  // 1. PATH corrente + login shell PATH
  const searchPath = getLoginPathSync();
  for (const dir of searchPath.split(':')) {
    const full = path.join(dir, name);
    if (isExecutable(full)) return { path: full, via: 'PATH:' + dir };
  }
  // 2. candidati noti
  for (const c of candidatesFor(name)) {
    if (isExecutable(c)) return { path: c, via: 'candidate' };
    // symlink rotti? prova realpath
    try {
      const rp = fs.realpathSync(c);
      if (isExecutable(rp)) return { path: rp, via: 'candidate-realpath' };
    } catch {}
  }
  return { path: null, via: null, searchedPath: searchPath };
}

function augmentedEnv(extraBins, extraVars) {
  const loginPath = getLoginPathSync();
  const dirs = new Set([...(process.env.PATH || '').split(':'), ...loginPath.split(':')]);
  for (const b of (extraBins || [])) {
    if (b) dirs.add(path.dirname(b));
  }
  // assicurati che le dir dei binari risolti ci siano
  for (const n of AI_BINARIES) {
    try {
      const r = resolveBinary(n);
      if (r.path) dirs.add(path.dirname(r.path));
    } catch {}
  }
  return { ...process.env, ...(extraVars || {}), PATH: [...dirs].filter(Boolean).join(':'), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

// ---------- Account Claude multipli ----------
// Claude Code non ha profili integrati: un solo login OAuth in
// ~/.claude/.credentials.json (claudeAiOauth) oppure ANTHROPIC_API_KEY.
// Qui gestiamo: rilevamento OAuth + profili API key salvati in locale (600).
function claudeAccountsFile() {
  return path.join(app.getPath('userData'), 'claude-accounts.json');
}

function loadClaudeKeyAccounts() {
  try {
    const f = claudeAccountsFile();
    if (!fs.existsSync(f)) return [];
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(arr) ? arr.filter(a => a && a.id && a.apiKey) : [];
  } catch { return []; }
}

function saveClaudeKeyAccounts(acc) {
  fs.writeFileSync(claudeAccountsFile(), JSON.stringify(acc, null, 2), { mode: 0o600 });
  try { fs.chmodSync(claudeAccountsFile(), 0o600); } catch {}
}

function detectClaudeOauth() {
  try {
    const f = path.join(os.homedir(), '.claude', '.credentials.json');
    if (!fs.existsSync(f)) return { available: false };
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const o = d && d.claudeAiOauth;
    if (o && (o.accessToken || o.refreshToken)) {
      return { available: true, label: o.subscriptionType ? `login corrente (${o.subscriptionType})` : 'login corrente' };
    }
  } catch {}
  return { available: false };
}

function claudeAccountEnv(accountId) {
  // Restituisce { vars, name } — vars da fondere nell'env del pty
  if (!accountId || accountId === 'oauth') return { vars: {}, name: 'OAuth' };
  const acc = loadClaudeKeyAccounts().find(a => a.id === accountId);
  if (!acc) return { vars: {}, name: null, error: 'Account Claude non trovato (forse eliminato).' };
  // ANTHROPIC_API_KEY ha precedenza sul login OAuth di Claude Code
  return { vars: { ANTHROPIC_API_KEY: acc.apiKey }, name: acc.name };
}

function historyFile() {
  return path.join(app.getPath('userData'), 'sessions-history.json');
}

function loadHistory() {
  try {
    const f = historyFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return [];
}

function saveHistoryEntry(entry) {
  try {
    const h = loadHistory();
    h.unshift({ ...entry, lastOpened: new Date().toISOString() });
    fs.writeFileSync(historyFile(), JSON.stringify(h.slice(0, 200), null, 2));
  } catch (e) { console.error(e); }
}

function buildCommand(type, resumeId) {
  if (type === 'opencode') {
    const r = resolveBinary('opencode');
    if (!r.path) return { cmd: null, args: [], missing: 'opencode', searchedPath: r.searchedPath };
    return resumeId
      ? { cmd: r.path, args: ['--session', resumeId], resolvedVia: r.via }
      : { cmd: r.path, args: [], resolvedVia: r.via };
  }
  if (type === 'claude') {
    const r = resolveBinary('claude');
    if (!r.path) return { cmd: null, args: [], missing: 'claude', searchedPath: r.searchedPath };
    return resumeId
      ? { cmd: r.path, args: ['--resume', resumeId], resolvedVia: r.via }
      : { cmd: r.path, args: [], resolvedVia: r.via };
  }
  if (type === 'codex') {
    const r = resolveBinary('codex');
    if (!r.path) return { cmd: null, args: [], missing: 'codex', searchedPath: r.searchedPath };
    // `codex resume <SESSION_ID>` riapre il rollout indicato
    return resumeId
      ? { cmd: r.path, args: ['resume', resumeId], resolvedVia: r.via }
      : { cmd: r.path, args: [], resolvedVia: r.via };
  }
  const sh = getDefaultShell();
  return { cmd: sh, args: process.platform !== 'win32' ? ['-i'] : [] };
}

// Suggerimento di installazione mostrato quando un binario non è nel PATH
const INSTALL_HINTS = {
  opencode: 'Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode',
  claude: 'Installa con: npm i -g @anthropic-ai/claude-code, oppure verifica il percorso (nvm: ~/.nvm/versions/node/*/bin/claude)',
  codex: 'Installa con: npm i -g @openai/codex (oppure brew install codex)',
};

function installHint(name) {
  return INSTALL_HINTS[name] || `Verifica che '${name}' sia installato e nel PATH.`;
}

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
    const ae = claudeAccountEnv(claudeAccountId);
    if (ae.error) return { ok: false, error: ae.error };
    extraVars = ae.vars;
    accountName = ae.name;
  } else if (type === 'claude') {
    const o = detectClaudeOauth();
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
    saveHistoryEntry({ type, cwd: workdir, resumeId: resumeId || null, claudeAccountId: claudeAccountId || null, claudeAccountName: accountName, cmd: cmd + ' ' + args.join(' ') });
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

// Stato di tutti i binari AI, nella forma attesa dalla UI
function resolveAllBinaries() {
  const out = {};
  for (const name of AI_BINARIES) {
    const r = resolveBinary(name);
    out[name] = {
      found: !!r.path,
      path: r.path,
      via: r.via,
      searchedPath: r.searchedPath || getLoginPathSync(),
    };
  }
  return out;
}

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

ipcMain.handle('get-history', async () => loadHistory());

// ---------- Account Claude: lista / aggiungi / elimina ----------
// Nota: le chiavi API non lasciano mai il main process; alla UI vanno solo id+nomi.
ipcMain.handle('list-claude-accounts', async () => ({
  oauth: detectClaudeOauth(),
  accounts: loadClaudeKeyAccounts().map(a => ({ id: a.id, name: a.name, createdAt: a.createdAt || null })),
}));

ipcMain.handle('add-claude-account', async (event, { name, apiKey } = {}) => {
  const n = String(name || '').trim();
  const k = String(apiKey || '').trim();
  if (!n) return { ok: false, error: 'Nome account obbligatorio.' };
  if (!k) return { ok: false, error: 'API key obbligatoria.' };
  const acc = loadClaudeKeyAccounts();
  if (acc.some(a => a.name.toLowerCase() === n.toLowerCase()))
    return { ok: false, error: `Esiste già un account chiamato "${n}".` };
  acc.push({ id: 'acc_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), name: n, apiKey: k, createdAt: new Date().toISOString() });
  try {
    saveClaudeKeyAccounts(acc);
  } catch (e) {
    return { ok: false, error: 'Salvataggio fallito: ' + (e.message || e) };
  }
  return { ok: true };
});

ipcMain.handle('delete-claude-account', async (event, { id } = {}) => {
  const acc = loadClaudeKeyAccounts().filter(a => a.id !== id);
  try {
    saveClaudeKeyAccounts(acc);
  } catch (e) {
    return { ok: false, error: 'Eliminazione fallita: ' + (e.message || e) };
  }
  return { ok: true };
});

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
