'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getLoginPathSync } = require('./login-path');

/** Binari delle sessioni AI gestite (lo shell non passa da qui). */
const AI_BINARIES = ['opencode', 'claude', 'codex'];

const TERMINAL_ENV = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Percorsi tipici dei tool installati via npm/volta/asdf/nvm/homebrew. */
function nodeToolCandidates(name, home = os.homedir()) {
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
  } catch {
    // ~/.nvm illeggibile: si prosegue con gli altri candidati
  }
  return list;
}

function candidatesFor(name, home = os.homedir()) {
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
  if (name === 'claude') return nodeToolCandidates('claude', home);
  // Codex CLI: npm @openai/codex, homebrew, o binario in ~/.codex/bin
  if (name === 'codex') return [path.join(home, '.codex', 'bin', 'codex'), ...nodeToolCandidates('codex', home)];
  return [];
}

/**
 * Cerca un binario prima nel PATH (di processo + login shell), poi nei percorsi
 * noti di ogni gestore di versioni.
 */
function resolveBinary(name, { searchPath = getLoginPathSync(), home = os.homedir() } = {}) {
  for (const dir of searchPath.split(':')) {
    if (!dir) continue;
    const full = path.join(dir, name);
    if (isExecutable(full)) return { path: full, via: 'PATH:' + dir };
  }
  for (const c of candidatesFor(name, home)) {
    if (isExecutable(c)) return { path: c, via: 'candidate' };
    // symlink rotto: prova il percorso reale
    try {
      const rp = fs.realpathSync(c);
      if (isExecutable(rp)) return { path: rp, via: 'candidate-realpath' };
    } catch {
      // candidato inesistente: normale, si passa al successivo
    }
  }
  return { path: null, via: null, searchedPath: searchPath };
}

/** Stato di tutti i binari AI, nella forma attesa dalla UI. */
function resolveAllBinaries(names = AI_BINARIES) {
  const searchPath = getLoginPathSync();
  return Object.fromEntries(names.map((name) => {
    const r = resolveBinary(name, { searchPath });
    return [name, { found: !!r.path, path: r.path, via: r.via, searchedPath: r.searchedPath || searchPath }];
  }));
}

/**
 * Env per i processi figli: PATH arricchito coi percorsi dei binari risolti,
 * più le variabili che dichiarano un terminale a colori pieni.
 */
function augmentedEnv(extraBins = [], extraVars = {}, baseEnv = process.env) {
  const dirs = new Set([...(baseEnv.PATH || '').split(':'), ...getLoginPathSync().split(':')]);
  for (const b of extraBins) {
    if (b) dirs.add(path.dirname(b));
  }
  for (const name of AI_BINARIES) {
    const r = resolveBinary(name);
    if (r.path) dirs.add(path.dirname(r.path));
  }
  return { ...baseEnv, ...extraVars, PATH: [...dirs].filter(Boolean).join(':'), ...TERMINAL_ENV };
}

module.exports = { AI_BINARIES, isExecutable, nodeToolCandidates, candidatesFor, resolveBinary, resolveAllBinaries, augmentedEnv };
