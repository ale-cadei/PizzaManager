'use strict';
const fs = require('fs');
const { execFile } = require('child_process');
const { resolveBinary, augmentedEnv } = require('./binaries');
const { getLoginPathSync } = require('./login-path');
const { execFileArgs } = require('./win-command');
const { computeRecentDirs, normalizeDir } = require('./recent-dirs');

const EXEC_TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
/* Ogni `opencode session list` costa ~2 s di CPU: oltre queste directory
   (le piu recenti) non si chiede. */
const MAX_DIRS = 8;
/* Titolo che opencode da a una conversazione finche non ne genera uno vero */
const DEFAULT_TITLE_RE = /^New session - \d{4}-\d{2}-\d{2}T/;

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
  return { ok: true, sessions: valid.map(normalizeSession), ...(skipped ? { skipped } : {}) };
}

/**
 * opencode chiama `updated` e `directory` quelli che claude e codex chiamano
 * `mtime` e `cwd`: chi riconosce la conversazione di una scheda nuova
 * (pickAutoSession) guarda questi ultimi, e senza non la trovava mai.
 * I campi originali restano (il dialog Resume li usa).
 */
function normalizeSession(s) {
  const mtime = Number(s.updated ?? s.created);
  return {
    ...s,
    cwd: s.cwd || s.directory || null,
    mtime: Number.isFinite(mtime) ? mtime : null,
    titled: typeof s.title === 'string' && s.title.trim() !== '' && !DEFAULT_TITLE_RE.test(s.title),
  };
}

/**
 * Sessioni OpenCode, chieste alla CLI stessa.
 * `run` e `bin` sono iniettabili per poter verificare la gestione degli
 * errori senza avere opencode installato (con `bin` non si cerca nel PATH).
 */
function listOpencodeSessions(limit, { run = execFile, bin = null, platform = process.platform, cwd } = {}) {
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
    run(x.file, x.args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: augmentedEnv([r.path]), cwd, ...x.options },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: `opencode errore (${r.path}): ${stderr || err.message}`, sessions: [] });
        resolve({ ...parseSessionOutput(stdout), binary: r.path });
      });
  });
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * Sessioni OpenCode di piu directory. `opencode session list` elenca solo il
 * progetto della cwd del processo: chiamato dal main vedeva le conversazioni
 * di una sola cartella, e quelle degli altri progetti non comparivano ne nel
 * Resume ne per le schede da riconoscere. Una chiamata per directory, poi i
 * risultati si uniscono (piu recenti prima). Senza directory valide: una sola
 * chiamata dalla cwd del processo, come prima.
 * @param {string[]} dirs
 * @param {number} [limit]
 * @param {{ exists?: (p: string) => boolean, run?: Function, bin?: string|null, platform?: string }} [options]
 */
async function listOpencodeSessionsIn(dirs, limit, { exists = isDir, ...options } = {}) {
  const wanted = [...new Set((Array.isArray(dirs) ? dirs : []).map(normalizeDir).filter(Boolean))]
    .filter((d) => exists(d))
    .slice(0, MAX_DIRS);
  if (!wanted.length) return listOpencodeSessions(limit, options);
  const results = await Promise.all(wanted.map((cwd) => listOpencodeSessions(limit, { ...options, cwd })));
  const good = results.filter((r) => r.ok);
  if (!good.length) return results[0];
  const byId = new Map();
  for (const r of good) for (const s of r.sessions) if (!byId.has(s.id)) byId.set(s.id, s);
  const sessions = [...byId.values()].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return { ok: true, sessions: limit ? sessions.slice(0, limit) : sessions, binary: good[0].binary };
}

/**
 * Directory in cui l'utente ha aperto sessioni opencode, dalla cronologia
 * dell'app (piu recenti prima): sono quelle da interrogare per il Resume.
 * @param {Array<{type?: string, cwd?: string}>} history
 */
function opencodeHistoryDirs(history, { exists = isDir, limit = MAX_DIRS } = {}) {
  const entries = Array.isArray(history) ? history.filter((e) => e && e.type === 'opencode') : [];
  return computeRecentDirs(entries, { limit, exists }).map((d) => d.path);
}

module.exports = { listOpencodeSessions, listOpencodeSessionsIn, opencodeHistoryDirs, parseSessionOutput, MAX_DIRS };
