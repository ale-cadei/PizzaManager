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
// blame: il file non c'è in HEAD, o HEAD non c'è ancora → la riga è nuova
const BLAME_NOT_IN_HEAD = /no such path .* in HEAD|no such ref: HEAD/i;
const BLAME_NO_LINE = /has only \d+ lines?/i;
const UNCOMMITTED = Object.freeze({ uncommitted: true });

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
 * La riga di `git blame --porcelain` per una riga sola (docs/plans/73).
 * L'hash di zeri è una riga che non c'è in HEAD («Not Committed Yet»).
 * @param {string} out
 * @returns {{uncommitted: true}|{hash: string, uncommitted: false, author: string,
 *   mail: string, time: number|null, summary: string}|null} null se l'uscita è vuota
 */
function parseBlame(out) {
  const lines = String(out).split('\n');
  const hash = lines[0].split(' ')[0];
  if (!hash) return null;
  if (/^0+$/.test(hash)) return UNCOMMITTED;
  const fields = new Map();
  // Le intestazioni finiscono alla riga del contenuto, che inizia con un tab
  for (const line of lines.slice(1)) {
    if (line.startsWith('\t')) break;
    const space = line.indexOf(' ');
    if (space > 0) fields.set(line.slice(0, space), line.slice(space + 1));
  }
  const time = Number(fields.get('author-time'));
  return {
    hash,
    uncommitted: false,
    author: fields.get('author') || '',
    mail: (fields.get('author-mail') || '').replace(/^<|>$/g, ''),
    time: Number.isFinite(time) && fields.has('author-time') ? time : null,
    summary: fields.get('summary') || '',
  };
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

  /**
   * Chi ha toccato la riga `line` del testo nell'editor (docs/plans/73).
   * Il testo va a git sullo stdin (`--contents -`): i numeri di riga sono
   * quelli dell'editor anche con modifiche non salvate, e una riga cambiata
   * torna come non committata.
   * @param {string} rel
   * @param {number} line da 1
   * @param {string} text il testo nell'editor
   * @returns {Promise<{ok: true, blame: object}|{ok: false, reason: string, error?: string}>}
   *   `blame` come parseBlame; `reason`: outside, invalid, too-large, ignored,
   *   not-repo, no-git, no-line, error
   */
  async function blameLine(rel, line, text) {
    if (!Number.isInteger(line) || line < 1 || typeof text !== 'string') return { ok: false, reason: 'invalid' };
    if (Buffer.byteLength(text) > maxRead) return { ok: false, reason: 'too-large' };
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
    try {
      const out = await run(['blame', '--porcelain', '-L', `${line},${line}`, '--contents', '-', '--', name], { cwd, input: text, timeout: TIMEOUT });
      const blame = parseBlame(out);
      return blame ? { ok: true, blame } : { ok: false, reason: 'error', error: 'git blame senza risposta' };
    } catch (e) {
      const stderr = String((e && e.stderr) || '');
      if (BLAME_NO_LINE.test(stderr)) return { ok: false, reason: 'no-line' };
      if (!BLAME_NOT_IN_HEAD.test(stderr)) return failureOf(e);
      return (await ignored(cwd, name)) ? { ok: false, reason: 'ignored' } : { ok: true, blame: UNCOMMITTED };
    }
  }

  return { headText, blameLine };
}

module.exports = { createEditorGit, parseBlame };
