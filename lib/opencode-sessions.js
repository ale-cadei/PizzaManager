'use strict';
const { execFile } = require('child_process');
const { resolveBinary, augmentedEnv } = require('./binaries');
const { getLoginPathSync } = require('./login-path');
const { execFileArgs } = require('./win-command');

const EXEC_TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Interpreta l'output di `opencode session list --format json`. E' un
 * confine con un processo esterno di cui non controlliamo la versione, quindi
 * si distinguono tre casi: nessuna sessione (output vuoto: opencode non stampa
 * nemmeno "[]"), formato cambiato (JSON valido ma non un elenco di sessioni),
 * output non JSON (errore vero). Prima tutti e tre finivano in "Parse JSON
 * opencode fallito", e l'utente senza sessioni leggeva un errore.
 */
function parseSessionOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return { ok: true, sessions: [] };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'opencode ha restituito qualcosa che non è JSON: ' + text.slice(0, 120), sessions: [] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'opencode ha restituito un formato inatteso (non un elenco): forse è cambiata la versione.', sessions: [] };
  }
  const valid = parsed.filter((s) => s && typeof s === 'object' && typeof s.id === 'string' && s.id);
  const skipped = parsed.length - valid.length;
  return { ok: true, sessions: valid, ...(skipped ? { skipped } : {}) };
}

/**
 * Sessioni OpenCode, chieste alla CLI stessa.
 * `run` e `bin` sono iniettabili per poter verificare la gestione degli
 * errori senza avere opencode installato (con `bin` non si cerca nel PATH).
 */
function listOpencodeSessions(limit, { run = execFile, bin = null, platform = process.platform } = {}) {
  const r = bin ? { path: bin } : resolveBinary('opencode');
  if (!r.path) {
    return Promise.resolve({
      ok: false,
      error: `Binario 'opencode' non trovato nel PATH (${r.searchedPath || getLoginPathSync()}). Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode`,
      sessions: [],
    });
  }
  const args = ['session', 'list', '--format', 'json', ...(limit ? ['-n', String(limit)] : [])];
  // opencode installato con npm -g, su Windows, è un opencode.cmd
  const x = execFileArgs(r.path, args, { platform });
  return new Promise((resolve) => {
    run(x.file, x.args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: augmentedEnv([r.path]), ...x.options },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: `opencode errore (${r.path}): ${stderr || err.message}`, sessions: [] });
        resolve({ ...parseSessionOutput(stdout), binary: r.path });
      });
  });
}

module.exports = { listOpencodeSessions, parseSessionOutput };
