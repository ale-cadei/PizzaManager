'use strict';
const { execFileSync } = require('child_process');
const { getDefaultShell } = require('./shell');

const FALLBACK_PATH = '/usr/local/bin:/usr/bin:/bin';
const SHELL_TIMEOUT_MS = 5000;

/**
 * PATH di una shell di login, che sulle app lanciate da GUI (.deb, .app) è
 * molto più ricco di quello ereditato dal processo: senza, i binari installati
 * via nvm/volta/homebrew non si trovano.
 *
 * Le dipendenze sono iniettabili perché il comportamento sia verificabile
 * senza eseguire davvero una shell.
 */
function computeLoginPath({ env = process.env, exec = execFileSync, shell = null } = {}) {
  const parts = [env.PATH || FALLBACK_PATH];
  try {
    const sh = shell || getDefaultShell();
    const out = exec(sh, ['-lc', 'echo $PATH'], { timeout: SHELL_TIMEOUT_MS, env }).toString();
    const lines = out.trim().split('\n').filter(Boolean);
    const p = (lines[lines.length - 1] || '').trim();
    if (p && p.includes('/')) parts.unshift(p);
  } catch {
    // shell assente, lenta o non cooperativa: si resta col PATH del processo
  }
  return dedupePath(parts.join(':'));
}

/** Rimuove i duplicati preservando l'ordine: la prima occorrenza vince. */
function dedupePath(pathString) {
  return [...new Set(String(pathString).split(':').filter(Boolean))].join(':');
}

let cache = null;

/** Versione con cache usata dall'app: la shell di login va interrogata una volta sola. */
function getLoginPathSync(opts) {
  if (cache === null) cache = computeLoginPath(opts);
  return cache;
}

/** Solo per i test: azzera la cache fra un caso e l'altro. */
function resetLoginPathCache() {
  cache = null;
}

module.exports = { computeLoginPath, dedupePath, getLoginPathSync, resetLoginPathCache };
