const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

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

function candidatesFor(name) {
  const home = os.homedir();
  const list = [];
  if (name === 'opencode') {
    list.push(
      path.join(home, '.opencode', 'bin', 'opencode'),
      path.join(home, '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/opt/opencode/opencode',
      '/snap/bin/opencode',
      '/opt/homebrew/bin/opencode',
    );
  } else if (name === 'claude') {
    list.push(
      path.join(home, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      path.join(home, '.npm-global', 'bin', 'claude'),
      path.join(home, '.volta', 'bin', 'claude'),
      path.join(home, '.asdf', 'shims', 'claude'),
    );
    // nvm: ~/.nvm/versions/node/*/bin/claude
    try {
      const base = path.join(home, '.nvm', 'versions', 'node');
      if (fs.existsSync(base)) {
        for (const v of fs.readdirSync(base)) {
          list.push(path.join(base, v, 'bin', 'claude'));
        }
      }
    } catch {}
  }
  return list;
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
  for (const n of ['opencode', 'claude']) {
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
  const sh = getDefaultShell();
  return { cmd: sh, args: process.platform !== 'win32' ? ['-i'] : [] };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'AISessionManager',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // mainWindow.webContents.openDevTools(); // scommentare per debug
}

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
      error: `Binario '${missing}' non trovato nel PATH.\nPATH cercato: ${searchedPath}\n` +
        (missing === 'opencode'
          ? `Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode`
          : `Installa con: npm i -g @anthropic-ai/claude-code, oppure verifica il percorso (nvm: ~/.nvm/versions/node/*/bin/claude)`),
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

ipcMain.handle('get-defaults', async () => {
  const op = resolveBinary('opencode');
  const cl = resolveBinary('claude');
  return {
    shell: getDefaultShell(),
    homedir: os.homedir(),
    platform: process.platform,
    path: getLoginPathSync(),
    binaries: {
      opencode: { found: !!op.path, path: op.path, via: op.via },
      claude: { found: !!cl.path, path: cl.path, via: cl.via },
    },
  };
});

ipcMain.handle('check-deps', async () => {
  const op = resolveBinary('opencode');
  const cl = resolveBinary('claude');
  return {
    opencode: { found: !!op.path, path: op.path, via: op.via, searchedPath: op.searchedPath || getLoginPathSync() },
    claude: { found: !!cl.path, path: cl.path, via: cl.via, searchedPath: cl.searchedPath || getLoginPathSync() },
    path: getLoginPathSync(),
  };
});

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
