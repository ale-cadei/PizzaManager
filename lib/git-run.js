'use strict';
/* Lancio di git per la sessione di tipo `git` (lib/git-graph.js,
 * lib/git-branches.js). Sempre execFile con argv, mai la shell.
 *
 * GIT_TERMINAL_PROMPT=0: nessuna richiesta di credenziali che resterebbe
 * appesa senza terminale. GIT_OPTIONAL_LOCKS=0: leggere non prende lock
 * facoltativi sul repository dell'utente (quelli necessari a scrivere, per
 * esempio in `git switch`, restano). LC_ALL=C: messaggi riconoscibili. */
const { execFile } = require('child_process');
const path = require('path');
const { resolveBinary } = require('./binaries');

const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * @param {string[]} args
 * @param {{cwd: string, env?: Object<string, string>, timeout?: number, buffer?: boolean, input?: string}} o `env` si
 *   aggiunge a quello di sempre (la fotografia di lib/git-snapshot.js passa un
 *   indice suo); `timeout` in ms, poi git viene interrotto (`killed` sull'errore):
 *   serve al commit, i cui hook possono non finire; `buffer` restituisce i byte
 *   così come sono (il contenuto di un file binario, lib/git-discard.js); `input`
 *   scritto sullo stdin (check-ignore --stdin della sessione editor)
 * @returns {Promise<string|Buffer>} stdout; in caso di errore l'eccezione porta
 *   `stderr` e `stdout` (un hook che fallisce spesso scrive lì)
 */
function runGit(args, { cwd, env = {}, timeout = 0, buffer = false, input = null }) {
  // git si cerca come gli altri binari (PATH di login compreso)
  const bin = resolveBinary('git');
  if (!bin.path) return Promise.reject(Object.assign(new Error('git non trovato nel PATH'), { missing: true }));
  return new Promise((resolve, reject) => {
    const child = execFile(bin.path, args, {
      cwd, maxBuffer: MAX_BUFFER, windowsHide: true, timeout, encoding: buffer ? 'buffer' : 'utf8',
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr: String(stderr || ''), stdout: String(stdout || '') }));
      resolve(buffer ? stdout : String(stdout));
    });
    if (input !== null) {
      // git può uscire senza leggere (fuori da un repository): l'EPIPE sullo
      // stdin non è l'errore da riportare, quello arriva dalla callback
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

/* git su Windows scrive i percorsi con gli slash (`C:/Users/...`), il resto
 * dell'app coi backslash (findProjectRoot): la sidebar raggruppa confrontando
 * la stringa, quindi senza questa passata una scheda finirebbe in un gruppo
 * suo, lontano dalle altre sessioni dello stesso repository. */
function nativePath(p, platform = process.platform) {
  return platform === 'win32' ? path.win32.normalize(p) : p;
}

module.exports = { runGit, nativePath };
