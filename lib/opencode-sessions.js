'use strict';
const { execFile } = require('child_process');
const { resolveBinary, augmentedEnv } = require('./binaries');
const { getLoginPathSync } = require('./login-path');

const EXEC_TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Sessioni OpenCode, chieste alla CLI stessa.
 * `run` è iniettabile per poter verificare la gestione degli errori senza
 * avere opencode installato.
 */
function listOpencodeSessions(limit, { run = execFile } = {}) {
  const r = resolveBinary('opencode');
  if (!r.path) {
    return Promise.resolve({
      ok: false,
      error: `Binario 'opencode' non trovato nel PATH (${r.searchedPath || getLoginPathSync()}). Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode`,
      sessions: [],
    });
  }
  const args = ['session', 'list', '--format', 'json', ...(limit ? ['-n', String(limit)] : [])];
  return new Promise((resolve) => {
    run(r.path, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: augmentedEnv([r.path]) },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: `opencode errore (${r.path}): ${stderr || err.message}`, sessions: [] });
        try {
          return resolve({ ok: true, sessions: JSON.parse(stdout), binary: r.path });
        } catch {
          return resolve({ ok: false, error: 'Parse JSON opencode fallito. Output: ' + String(stdout).slice(0, 200), sessions: [] });
        }
      });
  });
}

module.exports = { listOpencodeSessions };
