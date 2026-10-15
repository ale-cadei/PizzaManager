'use strict';
/* Il testo di un file com'è nell'ultimo commit, per le barrette delle righe
 * cambiate nella scheda editor (docs/plans/63). `git cat-file blob`: i byte
 * del blob così come sono (niente textconv, niente filtri) e un errore se il
 * percorso è una cartella. `HEAD:./<rel>` è relativo alla cartella della
 * scheda anche quando il repository parte più in alto. Sempre runGit:
 * execFile con argv, mai la shell; LC_ALL=C rende i messaggi riconoscibili. */
const { runGit } = require('./git-run');
const { safeRel } = require('./editor-paths');
const { MAX_READ, decode } = require('./editor-fs');

const TIMEOUT = 10000;
const NOT_REPO = /not a git repository/i;
// Il percorso non c'è in HEAD, o HEAD non c'è ancora (repository senza
// commit). cat-file dice «Not a valid object name»; gli altri sono di git show
// e di versioni vicine, riconosciuti per non dipendere dalla formulazione.
const NOT_IN_HEAD = /not a valid object name|invalid object name|does not exist in|exists on disk, but not in/i;

function failureOf(e) {
  if (e && e.missing) return { ok: false, reason: 'no-git' };
  if (e && e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { ok: false, reason: 'too-large' };
  const stderr = String((e && e.stderr) || '');
  if (NOT_REPO.test(stderr)) return { ok: false, reason: 'not-repo' };
  if (NOT_IN_HEAD.test(stderr)) return { ok: true, text: null };
  const first = stderr.split('\n').find((l) => l.trim()) || String((e && e.message) || e);
  return { ok: false, reason: 'error', error: first.trim() };
}

/**
 * @param {{root: string, run?: Function, maxRead?: number}} o `root` la
 *   cartella della scheda (già verificata da lib/editor-fs.js); `run` e
 *   `maxRead` si sostituiscono nei test
 */
function createEditorGit({ root, run = runGit, maxRead = MAX_READ } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('cartella della sessione mancante');

  /**
   * @param {string} rel percorso relativo alla cartella della scheda
   * @returns {Promise<{ok: true, text: string|null}|{ok: false, reason: string, error?: string}>}
   *   `text: null` = il file non c'è in HEAD (nuovo, non tracciato, repository senza commit)
   */
  async function headText(rel) {
    const clean = safeRel(rel);
    if (!clean) return { ok: false, reason: 'outside' };
    let buf;
    try {
      buf = await run(['cat-file', 'blob', `HEAD:./${clean}`], { cwd: root, buffer: true, timeout: TIMEOUT });
    } catch (e) {
      return failureOf(e);
    }
    if (buf.length > maxRead) return { ok: false, reason: 'too-large' };
    const decoded = decode(buf);
    return decoded.ok ? { ok: true, text: decoded.text } : { ok: false, reason: decoded.reason };
  }

  return { headText };
}

module.exports = { createEditorGit };
