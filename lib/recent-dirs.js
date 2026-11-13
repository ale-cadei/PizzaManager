/* Calcolo delle directory di lavoro recenti (usate nel modal "Nuova sessione").
 * Modulo puro e senza dipendenze da Electron, così è testabile a sé. */

const { validateRemoteDir } = require('./remote-env');

const DEFAULT_LIMIT = 8;

/**
 * Deriva l'elenco delle directory recenti da voci di cronologia.
 * Non muta gli input: restituisce sempre nuovi oggetti.
 *
 * Solo le voci dell'ambiente chiesto (`env`, chiave di lib/remote-env.js;
 * le voci senza `env` sono locali). `exists` vale solo in locale: le
 * directory di un server non si possono guardare da qui.
 *
 * @param {Array<{cwd?: string, type?: string, lastOpened?: string, env?: string}>} history
 * @param {{ limit?: number, exists?: (p: string) => boolean, env?: string }} [options]
 * @returns {Array<{path: string, type: string|null, lastOpened: string|null, uses: number}>}
 */
function computeRecentDirs(history, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const env = options.env || 'local';
  const local = env === 'local';
  const exists = local && typeof options.exists === 'function' ? options.exists : () => true;
  const normalize = local ? normalizeDir : normalizeRemoteDir;
  const entries = Array.isArray(history) ? history : [];

  const byPath = new Map();
  for (const entry of entries) {
    if (!entry || (entry.env || 'local') !== env) continue;
    const dir = normalize(entry.cwd);
    if (!dir) continue;
    const prev = byPath.get(dir);
    if (prev) {
      byPath.set(dir, { ...prev, uses: prev.uses + 1 });
      continue;
    }
    byPath.set(dir, {
      path: dir,
      type: entry.type || null,
      lastOpened: entry.lastOpened || null,
      uses: 1,
    });
  }

  const out = [];
  for (const dir of byPath.values()) {
    if (out.length >= limit) break;
    let usable = false;
    try {
      usable = exists(dir.path);
    } catch {
      usable = false;
    }
    if (usable) out.push(dir);
  }
  return out;
}

/* Assoluto = POSIX (`/…`), unità Windows (`C:\…`, `C:/…`) o UNC (`\\server\…`).
   Si accettano entrambe le famiglie ovunque: la cronologia e' un file
   dell'utente, non della macchina. */
const ABSOLUTE_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/])/;
const TRAILING_SEP_RE = /[\\/]+$/;

/** Normalizza un percorso: solo path assoluti, senza separatore finale (tranne la radice). */
function normalizeDir(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!ABSOLUTE_RE.test(trimmed)) return null;
  const noTrailing = trimmed.replace(TRAILING_SEP_RE, '');
  // `/` e `C:\` sono radici: senza il separatore non sarebbero piu' percorsi
  if (!noTrailing) return '/';
  if (/^[A-Za-z]:$/.test(noTrailing)) return trimmed.slice(0, 3);
  return noTrailing;
}

function normalizeRemoteDir(value) {
  const r = validateRemoteDir(value);
  return r.ok && typeof value === 'string' && value.trim() ? r.dir : null;
}

module.exports = { computeRecentDirs, normalizeDir, DEFAULT_LIMIT };
