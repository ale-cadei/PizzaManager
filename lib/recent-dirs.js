/* Calcolo delle directory di lavoro recenti (usate nel modal "Nuova sessione").
 * Modulo puro e senza dipendenze da Electron, così è testabile a sé. */

const DEFAULT_LIMIT = 8;

/**
 * Deriva l'elenco delle directory recenti da voci di cronologia.
 * Non muta gli input: restituisce sempre nuovi oggetti.
 *
 * @param {Array<{cwd?: string, type?: string, lastOpened?: string}>} history
 * @param {{ limit?: number, exists?: (p: string) => boolean }} [options]
 * @returns {Array<{path: string, type: string|null, lastOpened: string|null, uses: number}>}
 */
function computeRecentDirs(history, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const exists = typeof options.exists === 'function' ? options.exists : () => true;
  const entries = Array.isArray(history) ? history : [];

  const byPath = new Map();
  for (const entry of entries) {
    const dir = normalizeDir(entry && entry.cwd);
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

/** Normalizza un percorso: solo path assoluti, senza slash finale. */
function normalizeDir(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/')) return null;
  const noTrailing = trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
  return noTrailing || '/';
}

module.exports = { computeRecentDirs, normalizeDir, DEFAULT_LIMIT };
