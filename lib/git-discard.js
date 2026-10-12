'use strict';
/* Scartare le modifiche non staged di un file dal pannello (docs/plans/56).
 *
 * - Solo il non staged: un tracciato torna com'è nell'indice
 *   (`git restore --worktree`), lo staged resta; un non tracciato si
 *   cancella, solo se è un file vero.
 * - Prima di scartare il contenuto si salva in git (`hash-object -w`): un
 *   oggetto non referenziato, che git tiene finché un `gc` non lo pota.
 *   Lo scarto restituisce un gettone per l'Annulla.
 * - L'Annulla rimette il contenuto solo se il file è ancora com'era subito
 *   dopo lo scarto: se nel frattempo è cambiato, sovrascriverebbe il nuovo.
 *   Il gettone torna dal renderer: qui si ricontrolla tutto.
 * - Sempre argv, `--literal-pathspecs` e `--` prima dei percorsi; mai fuori
 *   dalla radice, nemmeno passando da una cartella che è un collegamento.
 *
 * `run`, `exists` e `fsp` sono iniettabili: i test provano i controlli senza git. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');
const { isSafeRelative } = require('./git-changes');
const { findInSide } = require('./git-staging');
const { withRepo } = require('./git-commit');

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_MODE = 0o777;

/* La cartella del file è dentro la radice anche risolvendo i collegamenti? */
async function parentInside(root, rel, fsp) {
  try {
    const [realRoot, realParent] = await Promise.all([
      fsp.realpath(root), fsp.realpath(path.dirname(path.join(root, rel))),
    ]);
    return realParent === realRoot || realParent.startsWith(realRoot + path.sep);
  } catch {
    return false;
  }
}

/* Com'è il file adesso: assente, un collegamento, altro (una cartella), o un
   file vero col suo hash. `save` lo mette anche fra gli oggetti di git.
   `--no-filters`: i byte del disco, che l'Annulla rimette uguali */
async function stateOf(run, root, rel, fsp, { save = false } = {}) {
  const st = await fsp.lstat(path.join(root, rel)).catch(() => null);
  if (!st) return { kind: 'absent', hash: null };
  if (st.isSymbolicLink()) return { kind: 'link' };
  if (!st.isFile()) return { kind: 'other' };
  const args = ['hash-object', ...(save ? ['-w'] : []), '--no-filters', '--', rel];
  const hash = (await run(args, { cwd: root })).trim();
  return { kind: 'file', hash, mode: st.mode & MAX_MODE };
}

/* Si può annullare solo fra stati che si confrontano col solo hash */
const comparable = (state) => state.kind === 'file' || state.kind === 'absent';

async function removeUntracked(run, root, rel, fsp) {
  const before = await stateOf(run, root, rel, fsp, { save: true });
  if (before.kind !== 'file') {
    return { ok: false, error: `${rel} non è un file normale (un collegamento o una cartella): cancellalo dal terminale.` };
  }
  await fsp.rm(path.join(root, rel));
  return { ok: true, path: rel, untracked: true, undo: { path: rel, blob: before.hash, mode: before.mode, after: null } };
}

async function restoreTracked(run, root, rel, fsp) {
  const before = await stateOf(run, root, rel, fsp, { save: true });
  if (before.kind === 'other') return { ok: false, error: `${rel} adesso è una cartella: scartalo dal terminale.` };
  await run(['--literal-pathspecs', 'restore', '--worktree', '--', rel], { cwd: root });
  const after = await stateOf(run, root, rel, fsp);
  // Un collegamento prima o dopo: il gettone non saprebbe rimetterlo
  const undo = comparable(before) && comparable(after)
    ? { path: rel, blob: before.hash, mode: before.hash ? before.mode : null, after: after.hash }
    : null;
  return { ok: true, path: rel, untracked: false, undo };
}

/**
 * Scarta le modifiche non staged di un file.
 * @param {{cwd: string, path: string, run?: Function, platform?: string,
 *   exists?: (p: string) => boolean, fsp?: object}} o
 * @returns {Promise<{ok: true, path: string, untracked: boolean,
 *   undo: {path: string, blob: string|null, mode: number|null, after: string|null}|null}
 *   | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function discardFile(o = {}) {
  const { platform = process.platform, fsp = fs.promises } = o;
  const rel = o.path;
  if (!isSafeRelative(rel, { platform })) return { ok: false, error: 'Percorso non valido.' };
  return withRepo(o, 'Scarto', async ({ root, run }) => {
    const found = await findInSide(run, root, 'unstaged', rel);
    if (!found) return { ok: false, error: `${rel} non è più fra le modifiche non staged.` };
    if (found.oldPath) return { ok: false, error: `${rel} risulta rinominato: scartalo dal terminale.` };
    if (!await parentInside(root, rel, fsp)) return { ok: false, error: 'Percorso non valido.' };
    return found.fromDisk ? removeUntracked(run, root, rel, fsp) : restoreTracked(run, root, rel, fsp);
  });
}

function validToken(t, platform) {
  if (!t || typeof t !== 'object' || !isSafeRelative(t.path, { platform })) return false;
  const shaOrNull = (v) => v === null || (typeof v === 'string' && SHA_RE.test(v));
  if (!shaOrNull(t.blob) || !shaOrNull(t.after) || (t.blob === null && t.after === null)) return false;
  return t.blob === null || (Number.isInteger(t.mode) && t.mode >= 0 && t.mode <= MAX_MODE);
}

/* Il contenuto salvato, se git ce l'ha ancora (un gc può averlo potato) */
async function savedContent(run, root, blob) {
  const type = await run(['cat-file', '-t', blob], { cwd: root }).then((t) => t.trim(), () => null);
  if (type !== 'blob') return null;
  return run(['cat-file', 'blob', blob], { cwd: root, buffer: true });
}

/**
 * Annulla uno scarto col gettone di discardFile, se il file non è cambiato da allora.
 * @param {{cwd: string, token: object, run?: Function, platform?: string,
 *   exists?: (p: string) => boolean, fsp?: object}} o
 * @returns {Promise<{ok: true, path: string} | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function undoDiscard(o = {}) {
  const { platform = process.platform, fsp = fs.promises, token } = o;
  if (!validToken(token, platform)) return { ok: false, error: 'Non c\'è uno scarto da annullare.' };
  const rel = token.path;
  return withRepo(o, 'Annulla', async ({ root, run }) => {
    if (!await parentInside(root, rel, fsp)) {
      return { ok: false, error: `Non rimetto ${rel}: la sua cartella non c'è più o non è nel repository.` };
    }
    const now = await stateOf(run, root, rel, fsp);
    if (!comparable(now) || now.hash !== token.after) {
      return { ok: false, error: `${rel} è cambiato dopo lo scarto: non lo rimetto com'era, sovrascriverei le modifiche nuove.` };
    }
    const file = path.join(root, rel);
    if (token.blob === null) {
      await fsp.rm(file);
      return { ok: true, path: rel };
    }
    const content = await savedContent(run, root, token.blob);
    if (!content) return { ok: false, error: `Il contenuto di ${rel} non c'è più in git: non si può annullare.` };
    await fsp.writeFile(file, content, { mode: token.mode });
    // `mode` di writeFile vale solo alla creazione
    await fsp.chmod(file, token.mode);
    return { ok: true, path: rel };
  });
}

module.exports = { discardFile, undoDiscard };
