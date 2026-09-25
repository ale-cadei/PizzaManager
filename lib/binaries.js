'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getLoginPathSync } = require('./login-path');
const { ensureUtf8Locale } = require('./locale');

/* Tipo di sessione AI -> nome del binario da cercare (lo shell non passa da
 * qui). Antigravity fa eccezione: la sua CLI si chiama `agy`, mentre
 * `antigravity` e' l'eseguibile dell'IDE, che aprirebbe una finestra grafica. */
const AI_BINARIES = { opencode: 'opencode', claude: 'claude', codex: 'codex', antigravity: 'agy' };

const TERMINAL_ENV = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };

/* Windows non ha il bit di esecuzione: un file e' eseguibile se ha una di
   queste estensioni (l'ordine e' quello di PATHEXT). Un nome senza estensione
   nel PATH le prova tutte, come fa cmd.exe. */
const WIN_EXTS = ['.exe', '.cmd', '.bat', '.com'];
const isWin = (platform) => platform === 'win32';
/* Le funzioni di `path` seguono la piattaforma richiesta, non quella su cui
   girano: cosi' i casi Windows si verificano anche da Unix. */
const pathFor = (platform) => (isWin(platform) ? path.win32 : path);
const delimiterFor = (platform) => (isWin(platform) ? ';' : ':');

function isExecutable(p, { platform = process.platform } = {}) {
  try {
    if (isWin(platform)) {
      return fs.statSync(p).isFile() && WIN_EXTS.includes(path.win32.extname(p).toLowerCase());
    }
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/* Dove finiscono i tool su Windows: `npm i -g` mette un wrapper `.cmd` in
   %APPDATA%\npm; l'installer nativo di Claude un `.exe` in ~\.local\bin;
   OpenCode e Codex hanno la loro directory. Antigravity non e' distribuito
   per Windows. */
function windowsCandidates(name, home, env) {
  const w = path.win32;
  const appData = env.APPDATA || w.join(home, 'AppData', 'Roaming');
  const list = [w.join(appData, 'npm', `${name}.cmd`), w.join(home, '.local', 'bin', `${name}.exe`)];
  if (name === 'opencode') list.unshift(w.join(home, '.opencode', 'bin', 'opencode.exe'));
  if (name === 'codex') list.unshift(w.join(home, '.codex', 'bin', 'codex.exe'));
  if (name === 'agy' || name === 'tmux') return [];
  return list;
}

/* I candidati Unix sono percorsi POSIX anche quando si calcolano da Windows
   (i test): su Unix `path.posix` e' `path`, non cambia niente. */
const posix = path.posix;

/** Percorsi tipici dei tool installati via npm/volta/asdf/nvm/homebrew. */
function nodeToolCandidates(name, home = os.homedir()) {
  const list = [
    posix.join(home, '.local', 'bin', name),
    '/usr/local/bin/' + name,
    '/opt/homebrew/bin/' + name,
    '/home/linuxbrew/.linuxbrew/bin/' + name,
    posix.join(home, '.npm-global', 'bin', name),
    posix.join(home, '.volta', 'bin', name),
    posix.join(home, '.asdf', 'shims', name),
  ];
  // nvm: ~/.nvm/versions/node/*/bin/<name>
  try {
    const base = posix.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(base)) {
      for (const v of fs.readdirSync(base)) list.push(posix.join(base, v, 'bin', name));
    }
  } catch {
    // ~/.nvm illeggibile: si prosegue con gli altri candidati
  }
  return list;
}

function candidatesFor(name, home = os.homedir(), { platform = process.platform, env = process.env } = {}) {
  if (isWin(platform)) return windowsCandidates(name, home, env);
  if (name === 'opencode') {
    return [
      posix.join(home, '.opencode', 'bin', 'opencode'),
      posix.join(home, '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/opt/opencode/opencode',
      '/snap/bin/opencode',
      '/opt/homebrew/bin/opencode',
      '/home/linuxbrew/.linuxbrew/bin/opencode',
    ];
  }
  if (name === 'claude') return nodeToolCandidates('claude', home);
  // tmux: Homebrew su macOS, pacchetto di sistema su Linux. Non e' preinstallato su macOS.
  if (name === 'tmux') return ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux', '/home/linuxbrew/.linuxbrew/bin/tmux'];
  // Codex CLI: npm @openai/codex, homebrew, o binario in ~/.codex/bin
  if (name === 'codex') return [posix.join(home, '.codex', 'bin', 'codex'), ...nodeToolCandidates('codex', home)];
  // Antigravity CLI: installer ufficiale (`agy install`), di norma in ~/.local/bin
  if (name === 'agy') return [posix.join(home, '.local', 'bin', 'agy'), posix.join(home, '.antigravity', 'bin', 'agy')];
  return [];
}

/**
 * Cerca un binario prima nel PATH (di processo + login shell), poi nei percorsi
 * noti di ogni gestore di versioni.
 */
function resolveBinary(name, { searchPath = getLoginPathSync(), home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  // Su Windows `claude` nel PATH e' claude.cmd o claude.exe: si provano le
  // estensioni, a meno che il nome non ne abbia gia' una. I percorsi qui
  // toccano il filesystem, quindi si compongono col `path` della macchina.
  const names = isWin(platform) && !path.extname(name) ? WIN_EXTS.map((ext) => name + ext) : [name];
  for (const dir of searchPath.split(delimiterFor(platform))) {
    if (!dir) continue;
    for (const n of names) {
      const full = path.join(dir, n);
      if (isExecutable(full, { platform })) return { path: full, via: 'PATH:' + dir };
    }
  }
  for (const c of candidatesFor(name, home, { platform, env })) {
    if (isExecutable(c, { platform })) return { path: c, via: 'candidate' };
    // symlink rotto: prova il percorso reale
    try {
      const rp = fs.realpathSync(c);
      if (isExecutable(rp, { platform })) return { path: rp, via: 'candidate-realpath' };
    } catch {
      // candidato inesistente: normale, si passa al successivo
    }
  }
  return { path: null, via: null, searchedPath: searchPath };
}

/**
 * Stato di tutti i binari AI, nella forma attesa dalla UI: la chiave e' il tipo
 * di sessione (`antigravity`), non il nome del binario (`agy`), perche' e' col
 * tipo che il renderer accende i pallini di stato.
 */
function resolveAllBinaries(types = AI_BINARIES) {
  const searchPath = getLoginPathSync();
  return Object.fromEntries(Object.entries(types).map(([type, name]) => {
    const r = resolveBinary(name, { searchPath });
    return [type, { found: !!r.path, path: r.path, via: r.via, searchedPath: r.searchedPath || searchPath }];
  }));
}

/**
 * Env per i processi figli: PATH arricchito coi percorsi dei binari risolti,
 * più le variabili che dichiarano un terminale a colori pieni.
 */
function augmentedEnv(extraBins = [], extraVars = {}, baseEnv = process.env,
  { platform = process.platform, searchPath = getLoginPathSync({ platform }), resolve = resolveBinary, systemLocale } = {}) {
  const p = pathFor(platform);
  const delim = delimiterFor(platform);
  // Su Windows le variabili d'ambiente non distinguono le maiuscole e la
  // chiave si chiama di solito `Path`: si riscrive quella, non se ne aggiunge
  // una seconda `PATH` che il processo figlio potrebbe leggere a caso.
  const pathKey = Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const dirs = new Set([...String(baseEnv[pathKey] || '').split(delim), ...searchPath.split(delim)]);
  for (const b of extraBins) {
    if (b) dirs.add(p.dirname(b));
  }
  for (const name of Object.values(AI_BINARIES)) {
    const r = resolve(name, { searchPath, platform });
    if (r.path) dirs.add(p.dirname(r.path));
  }
  // LANG se manca (app avviata dal Finder): senza, ogni accento diventa `_`
  const withLocale = ensureUtf8Locale(baseEnv, { platform, ...(systemLocale ? { systemLocale } : {}) });
  return { ...withLocale, ...extraVars, [pathKey]: [...dirs].filter(Boolean).join(delim), ...TERMINAL_ENV };
}

module.exports = { AI_BINARIES, WIN_EXTS, isExecutable, nodeToolCandidates, candidatesFor, resolveBinary, resolveAllBinaries, augmentedEnv };
