const { app, BrowserWindow, Menu, ipcMain, clipboard, shell: electronShell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { listCodexSessions } = require('./codex-sessions');
const { computeRecentDirs } = require('./recent-dirs');
const commandProfiles = require('./command-profiles');

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

function getDefaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  if (process.platform === 'darwin') {
    // macOS: prefer zsh, fallback bash
    if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
    return '/bin/bash';
  }
  // Linux: $SHELL o bash
  return process.env.SHELL || '/bin/bash';
}

// ---------- Risoluzione binari (fix lancio da GUI/.deb con PATH minimo) ----------
let loginPathCache = null;
function getLoginPathSync() {
  if (loginPathCache) return loginPathCache;
  const parts = [process.env.PATH || '/usr/local/bin:/usr/bin:/bin'];
  try {
    const sh = getDefaultShell();
    const out = require('child_process').execFileSync(sh, ['-lc', 'echo $__AIS_LOGIN_PATH__; echo $PATH'], {
      timeout: 5000,
      env: { ...process.env, __AIS_LOGIN_PATH__: '1' },
    }).toString();
    const lines = out.trim().split('\n').filter(Boolean);
    const p = lines[lines.length - 1].trim();
    if (p && p.includes('/')) parts.unshift(p);
  } catch {}
  loginPathCache = [...new Set(parts.join(':').split(':').filter(Boolean))].join(':');
  return loginPathCache;
}

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

// ---------- Profili di comando (configurabili dall'utente) ----------
function commandProfilesFile() {
  return path.join(app.getPath('userData'), 'command-profiles.json');
}

function builtinProfiles() {
  return commandProfiles.defaultProfiles({ shell: getDefaultShell(), platform: process.platform });
}

function loadCommandProfiles() {
  const defaults = builtinProfiles();
  try {
    const f = commandProfilesFile();
    if (fs.existsSync(f))
      return commandProfiles.normalizeConfig(JSON.parse(fs.readFileSync(f, 'utf8')), { defaults });
  } catch (e) {
    console.error('command-profiles: lettura fallita, uso i default:', e.message || e);
  }
  return commandProfiles.normalizeConfig(null, { defaults });
}

function saveCommandProfiles(raw) {
  const cfg = commandProfiles.normalizeConfig(raw, { defaults: builtinProfiles() });
  fs.writeFileSync(commandProfilesFile(), JSON.stringify(cfg, null, 2));
  return cfg;
}

/**
 * Costruisce l'argv da lanciare per un tipo di sessione.
 * `profileId` seleziona uno dei comandi configurati; senza id vince il primo.
 */
function buildCommand(type, resumeId, profileId) {
  const cfg = loadCommandProfiles();
  const list = commandProfiles.listProfiles(cfg, type);
  if (!list.length) return { cmd: null, args: [], error: `Nessun comando configurato per il tipo '${type}'.` };
  const profile = profileId ? commandProfiles.findProfile(cfg, type, profileId) : list[0];
  if (!profile)
    return { cmd: null, args: [], error: 'Il comando scelto non esiste più: riaprilo da File → Configurazione comandi.' };

  const r = commandProfiles.resolveProfileCommand(profile, { resumeId, home: os.homedir() });
  if (!r.ok) return { cmd: null, args: [], error: `"${profile.label}": ${r.error}` };
  if (resumeId && !r.resumeApplied)
    return {
      cmd: null,
      args: [],
      error: `"${profile.label}" non supporta il resume: aggiungi gli argomenti di resume (es. --resume {id}) in File → Configurazione comandi.`,
    };

  // Percorso esplicito: usato così com'è. Nome nudo: risolto nel PATH.
  if (r.bin.includes('/')) {
    if (!isExecutable(r.bin))
      return { cmd: null, args: [], error: `"${profile.label}": ${r.bin} non è un eseguibile valido.` };
    return { cmd: r.bin, args: r.args, resolvedVia: 'path-esplicito', profile };
  }
  const rb = resolveBinary(r.bin);
  if (!rb.path) return { cmd: null, args: [], missing: r.bin, searchedPath: rb.searchedPath, profile };
  return { cmd: rb.path, args: r.args, resolvedVia: rb.via, profile };
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

const isMac = process.platform === 'darwin';

/** Inoltra un'azione di Edit al renderer, che sa se il fuoco è su un terminale. */
function sendEdit(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-edit', action);
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Nuova sessione', accelerator: 'CmdOrCtrl+N', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-new-session'); } },
        { type: 'separator' },
        { label: 'Configurazione comandi…', accelerator: 'CmdOrCtrl+,', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-open-config'); } },
        { type: 'separator' },
        { role: 'quit', label: 'Esci' },
      ],
    },
    {
      // Le voci di Edit NON usano i `role` nativi: quelli agiscono sulla
      // selezione del documento, che nei terminali xterm non esiste (la
      // selezione vive dentro il canvas). Il renderer sa se il fuoco è su un
      // terminale e copia/incolla di conseguenza (renderer/term-clipboard.js).
      // Gli acceleratori sono solo quelli che NON servono alla shell:
      // Ctrl+C/Ctrl+Z/Ctrl+X restano al processo (SIGINT, sospensione, nano).
      label: 'Edit',
      submenu: [
        { label: 'Annulla', click: () => sendEdit('undo') },
        { label: 'Ripeti', click: () => sendEdit('redo') },
        { type: 'separator' },
        { label: 'Taglia', click: () => sendEdit('cut') },
        { label: 'Copia', accelerator: isMac ? 'Cmd+C' : 'Ctrl+Shift+C', click: () => sendEdit('copy') },
        { label: 'Incolla', accelerator: isMac ? 'Cmd+V' : 'Ctrl+Shift+V', click: () => sendEdit('paste') },
        { label: 'Seleziona tutto', accelerator: isMac ? 'Cmd+A' : undefined, click: () => sendEdit('selectAll') },
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
/* Appunti di sistema: il renderer li usa per la selezione dei terminali, che
   non è una selezione del documento e quindi non passa da webContents.copy(). */
ipcMain.handle('clipboard-write', (event, { text } = {}) => {
  if (typeof text !== 'string' || !text) return { ok: false, error: 'niente da copiare' };
  try {
    clipboard.writeText(text);
    return { ok: true };
  } catch (e) {
    console.error('[clipboard-write]', e);
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('clipboard-read', () => {
  try {
    return { ok: true, text: clipboard.readText() || '' };
  } catch (e) {
    console.error('[clipboard-read]', e);
    return { ok: false, error: String((e && e.message) || e), text: '' };
  }
});

ipcMain.handle('menu-action', async (event, { action } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'finestra non disponibile' };
  const wc = mainWindow.webContents;
  try {
    switch (action) {
      case 'new-session': wc.send('menu-new-session'); break;
      case 'open-config': wc.send('menu-open-config'); break;
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
ipcMain.handle('pty-spawn', async (event, { id, type, cwd, resumeId, claudeAccountId, commandProfileId, cols, rows }) => {
  if (!pty) return { ok: false, error: 'node-pty non installato. Esegui: npm install' };
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const { cmd, args, missing, searchedPath, error, profile } = buildCommand(type, resumeId, commandProfileId);
  if (!cmd) {
    if (error) return { ok: false, error };
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
    saveHistoryEntry({
      type,
      cwd: workdir,
      resumeId: resumeId || null,
      claudeAccountId: claudeAccountId || null,
      claudeAccountName: accountName,
      commandProfileId: (profile && profile.id) || null,
      commandProfileLabel: (profile && profile.label) || null,
      cmd: cmd + ' ' + args.join(' '),
    });
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

// ---------- Profili di comando: leggi / salva / ripristina ----------
ipcMain.handle('get-command-profiles', async () => {
  try {
    return { ok: true, config: loadCommandProfiles(), defaults: builtinProfiles() };
  } catch (e) {
    console.error('get-command-profiles fallito:', e);
    return { ok: false, error: String((e && e.message) || e), config: { version: 1, profiles: {} }, defaults: {} };
  }
});

ipcMain.handle('save-command-profiles', async (event, { profiles } = {}) => {
  // Validazione esplicita: la UI mostra il primo errore utile all'utente
  if (!profiles || typeof profiles !== 'object') return { ok: false, error: 'Configurazione non valida.' };
  for (const type of commandProfiles.SESSION_TYPES) {
    const list = profiles[type];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return { ok: false, error: `Elenco comandi non valido per '${type}'.` };
    if (!list.length) return { ok: false, error: `Serve almeno un comando per '${type}'.` };
    if (list.length > commandProfiles.MAX_PROFILES_PER_TYPE)
      return { ok: false, error: `Massimo ${commandProfiles.MAX_PROFILES_PER_TYPE} comandi per tipo.` };
    const labels = new Set();
    for (const item of list) {
      const v = commandProfiles.validateProfile(type, item);
      if (!v.ok) return { ok: false, error: v.error };
      const key = v.profile.label.toLowerCase();
      if (labels.has(key)) return { ok: false, error: `Nome duplicato per '${type}': "${v.profile.label}".` };
      labels.add(key);
    }
  }
  try {
    return { ok: true, config: saveCommandProfiles({ profiles }) };
  } catch (e) {
    return { ok: false, error: 'Salvataggio fallito: ' + String((e && e.message) || e) };
  }
});

ipcMain.handle('reset-command-profiles', async () => {
  try {
    return { ok: true, config: saveCommandProfiles({ profiles: builtinProfiles() }) };
  } catch (e) {
    return { ok: false, error: 'Ripristino fallito: ' + String((e && e.message) || e) };
  }
});

// Directory recenti: derivate dalla cronologia, filtrate su quelle ancora esistenti
ipcMain.handle('get-recent-dirs', async (event, { limit } = {}) => {
  const isDir = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  try {
    return computeRecentDirs(loadHistory(), { limit, exists: isDir });
  } catch (e) {
    console.error('get-recent-dirs fallito:', e);
    return [];
  }
});

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
