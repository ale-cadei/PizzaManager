'use strict';
const { execFile, execFileSync } = require('child_process');
const path = require('path');
const { getDefaultShell } = require('./shell');

const FALLBACK_PATH = '/usr/local/bin:/usr/bin:/bin';
/* Su Windows non esiste una shell di login: il PATH di un'app avviata dalla
   GUI è già quello dell'utente (viene dal registro), e PowerShell non capisce
   `-lc`. Lì si prende il PATH del processo e basta. */
const delimiterFor = (platform) => (platform === 'win32' ? ';' : ':');
const SHELL_TIMEOUT_MS = 5000;

/**
 * PATH di una shell di login, che sulle app lanciate da GUI (.deb, .app) è
 * molto più ricco di quello ereditato dal processo: senza, i binari installati
 * via nvm/volta/homebrew non si trovano.
 *
 * Interrogare la shell costa: con una .zshrc che carica nvm/pyenv sono secondi.
 * Per questo NON si fa mai in modo sincrono nel main process — congelerebbe la
 * finestra. Si fa una volta, in background, all'avvio (primeLoginPath); chi ha
 * bisogno del valore subito (getLoginPathSync) riceve la cache se è pronta,
 * altrimenti il PATH del processo, senza aspettare.
 */

/** Estrae il PATH dall'output della shell: solo l'ultima riga, le rc possono stampare. */
function pathFromShellOutput(out, env) {
  const lines = String(out || '').trim().split('\n').filter(Boolean);
  const p = (lines[lines.length - 1] || '').trim();
  const parts = [env.PATH || FALLBACK_PATH];
  if (p && p.includes('/')) parts.unshift(p);
  return dedupePath(parts.join(':'), { delimiter: ':' });
}

/** Versione sincrona: solo per i test e gli script, mai nel percorso d'avvio dell'app. */
function computeLoginPath({ env = process.env, exec = execFileSync, shell = null, platform = process.platform } = {}) {
  if (platform === 'win32') return dedupePath(env.PATH || '', { delimiter: ';' });
  try {
    const out = exec(shell || getDefaultShell(), ['-lc', 'echo $PATH'], { timeout: SHELL_TIMEOUT_MS, env });
    return pathFromShellOutput(out, env);
  } catch {
    // shell assente, lenta o non cooperativa: si resta col PATH del processo
    return dedupePath(env.PATH || FALLBACK_PATH, { delimiter: ':' });
  }
}

/** Versione asincrona: la shell gira in un processo figlio, il main non aspetta. */
function computeLoginPathAsync({ env = process.env, run = execFile, shell = null, platform = process.platform } = {}) {
  if (platform === 'win32') return Promise.resolve(dedupePath(env.PATH || '', { delimiter: ';' }));
  return new Promise((resolve) => {
    let sh;
    try { sh = shell || getDefaultShell(); } catch { return resolve(dedupePath(env.PATH || FALLBACK_PATH, { delimiter: ':' })); }
    run(sh, ['-lc', 'echo $PATH'], { timeout: SHELL_TIMEOUT_MS, env }, (err, out) => {
      if (err) return resolve(dedupePath(env.PATH || FALLBACK_PATH, { delimiter: ':' }));
      resolve(pathFromShellOutput(out, env));
    });
  });
}

/** Rimuove i duplicati preservando l'ordine: la prima occorrenza vince. */
function dedupePath(pathString, { delimiter = path.delimiter } = {}) {
  return [...new Set(String(pathString).split(delimiter).filter(Boolean))].join(delimiter);
}

let cache = null;
let priming = null;

/**
 * Avvia (una volta sola) l'interrogazione della shell in background. Le
 * chiamate concorrenti condividono la stessa promise: una shell, non N.
 * Chi può aspettare (gli handler IPC asincroni) fa `await primeLoginPath()`.
 */
function primeLoginPath(opts) {
  if (!priming) {
    priming = computeLoginPathAsync(opts).then((p) => { cache = p; return p; });
  }
  return priming;
}

/**
 * Valore immediato, senza mai bloccare: la cache se la shell ha già risposto,
 * altrimenti il PATH del processo. Chi chiama da un contesto sincrono
 * (resolveBinary durante uno spawn) arriva quasi sempre a cache calda.
 */
function getLoginPathSync({ env = process.env, platform = process.platform } = {}) {
  if (cache !== null) return cache;
  if (platform === 'win32') return dedupePath(env.PATH || '', { delimiter: ';' });
  return dedupePath(env.PATH || FALLBACK_PATH, { delimiter: ':' });
}

/** Solo per i test: azzera cache e promise fra un caso e l'altro. */
function resetLoginPathCache() {
  cache = null;
  priming = null;
}

module.exports = { computeLoginPath, computeLoginPathAsync, primeLoginPath, dedupePath, getLoginPathSync, resetLoginPathCache };
