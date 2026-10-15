'use strict';
/* Il testo di un file com'è nell'ultimo commit, per le barrette delle righe
 * cambiate nella scheda editor (docs/plans/63). `git cat-file blob`: i byte
 * del blob così come sono (niente textconv, niente filtri) e un errore se il
 * percorso è una cartella. git parte dalla cartella del file con
 * `HEAD:./<nome>`: così sceglie il repository più interno (sottomodulo,
 * repository annidato, worktree dentro il repository) come farebbe dal
 * terminale, e funziona anche con una scheda aperta su una cartella che
 * contiene più repository. Sempre runGit: execFile con argv, mai la shell;
 * LC_ALL=C rende i messaggi riconoscibili. */
const path = require('path');
const { runGit } = require('./git-run');
const { safeRel } = require('./editor-paths');
const { MAX_READ, decode, createEditorFs } = require('./editor-fs');

const TIMEOUT = 10000;
const NOT_REPO = /not a git repository/i;
// Il percorso non c'è in HEAD, o HEAD non c'è ancora (repository senza
// commit). cat-file dice «Not a valid object name»; gli altri sono di git show
// e di versioni vicine, riconosciuti per non dipendere dalla formulazione.
const NOT_IN_HEAD = /not a valid object name|invalid object name|does not exist in|exists on disk, but not in/i;
const OUTSIDE = Object.freeze({ ok: false, reason: 'outside' });

const firstLine = (e) => {
  const stderr = String((e && e.stderr) || '');
  const line = stderr.split('\n').find((l) => l.trim()) || String((e && e.message) || e);
  return line.trim();
};

function failureOf(e) {
  if (e && e.missing) return { ok: false, reason: 'no-git' };
  if (e && e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { ok: false, reason: 'too-large' };
  const stderr = String((e && e.stderr) || '');
  if (NOT_REPO.test(stderr)) return { ok: false, reason: 'not-repo' };
  if (NOT_IN_HEAD.test(stderr)) return { ok: true, text: null };
  return { ok: false, reason: 'error', error: firstLine(e) };
}

/**
 * @param {{root: string, resolve?: (rel: string) => string, run?: Function, maxRead?: number}} o
 *   `root` la cartella della scheda (già verificata da lib/editor-fs.js);
 *   `resolve` dà il percorso assoluto confinato in `root` (di solito
 *   `resolveInside` di editor-fs, che lancia EOUTSIDE); `run` e `maxRead`
 *   si sostituiscono nei test
 */
function createEditorGit({ root, resolve, run = runGit, maxRead = MAX_READ } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('cartella della sessione mancante');
  const resolveInside = resolve || ((rel) => createEditorFs({ root }).resolveInside(rel));

  /* Un file che non c'è in HEAD perché git lo ignora non è «tutto nuovo»:
     check-ignore -q esce con 0 se il nome è ignorato, altrimenti con errore. */
  async function ignored(cwd, name) {
    try {
      await run(['check-ignore', '-q', '--', name], { cwd, timeout: TIMEOUT });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} rel percorso relativo alla cartella della scheda
   * @returns {Promise<{ok: true, text: string|null}|{ok: false, reason: string, error?: string}>}
   *   `text: null` = il file non c'è in HEAD (nuovo, non tracciato, repository
   *   senza commit); `reason: 'ignored'` = git lo ignora, niente barrette
   */
  async function headText(rel) {
    const clean = safeRel(rel);
    if (!clean) return OUTSIDE;
    let abs;
    try {
      abs = resolveInside(clean);
    } catch (e) {
      return e && e.code === 'EOUTSIDE' ? OUTSIDE : { ok: false, reason: 'error', error: firstLine(e) };
    }
    const cwd = path.dirname(abs);
    const name = path.basename(abs);
    let buf;
    try {
      buf = await run(['cat-file', 'blob', `HEAD:./${name}`], { cwd, buffer: true, timeout: TIMEOUT });
    } catch (e) {
      const failure = failureOf(e);
      if (failure.ok && await ignored(cwd, name)) return { ok: false, reason: 'ignored' };
      return failure;
    }
    if (buf.length > maxRead) return { ok: false, reason: 'too-large' };
    const decoded = decode(buf);
    return decoded.ok ? { ok: true, text: decoded.text } : { ok: false, reason: decoded.reason };
  }

  return { headText };
}

module.exports = { createEditorGit };
