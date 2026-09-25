'use strict';
/* Lancio di git per la sessione di tipo `git` (lib/git-graph.js,
 * lib/git-branches.js). Sempre execFile con argv, mai la shell.
 *
 * GIT_TERMINAL_PROMPT=0: nessuna richiesta di credenziali che resterebbe
 * appesa senza terminale. GIT_OPTIONAL_LOCKS=0: leggere non prende lock
 * facoltativi sul repository dell'utente (quelli necessari a scrivere, per
 * esempio in `git switch`, restano). LC_ALL=C: messaggi riconoscibili. */
const { execFile } = require('child_process');
const { resolveBinary } = require('./binaries');

const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * @param {string[]} args
 * @param {{cwd: string}} o
 * @returns {Promise<string>} stdout; in caso di errore l'eccezione porta `stderr`
 */
function runGit(args, { cwd }) {
  // git si cerca come gli altri binari (PATH di login compreso)
  const bin = resolveBinary('git');
  if (!bin.path) return Promise.reject(Object.assign(new Error('git non trovato nel PATH'), { missing: true }));
  return new Promise((resolve, reject) => {
    execFile(bin.path, args, {
      cwd, maxBuffer: MAX_BUFFER, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr: String(stderr || '') }));
      resolve(String(stdout));
    });
  });
}

module.exports = { runGit };
