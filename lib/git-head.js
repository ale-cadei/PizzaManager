'use strict';
/* Su cosa si trova la cartella di una scheda (docs/plans/89): branch
 * corrente, upstream con quanti commit da pushare, e se è un worktree
 * collegato. Lo mostra la barra in cima al pannello delle modifiche, accanto
 * al pulsante di push.
 *
 * Solo letture locali, niente fetch: `ahead`/`behind` sono quelli dell'ultimo
 * fetch, come in lib/git-branches.js. Il push vero lo fa lib/git-push.js.
 *
 * `run` è iniettabile: i test provano parsing e scelte senza git. */
const path = require('path');
const { runGit } = require('./git-run');
const { parseTrack, gitMessage } = require('./git-branches');
const { openRepo } = require('./git-changes');

const FIELD_SEP = '\x1f';
const TRACK_FORMAT = ['%(refname)', '%(upstream:short)', '%(upstream:track)'].join('%1f');
const HEADS = 'refs/heads/';

const optional = (p) => p.then((t) => t.trim() || null, () => null);
const pathOf = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const sameDir = (a, b, platform) => {
  const p = pathOf(platform);
  const norm = (d) => p.normalize(d).replace(/[\\/]+$/, '');
  return platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/* Worktree collegato: la sua git-dir non è quella comune del repository */
async function linkedWorktree(run, root, platform) {
  const text = await optional(run(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], { cwd: root }));
  const [gitDir, commonDir] = String(text || '').split('\n').map((l) => l.trim());
  return Boolean(gitDir && commonDir) && !sameDir(gitDir, commonDir, platform);
}

/* Upstream e distanza del branch `name`; for-each-ref confronta per prefisso,
   quindi si tiene solo la riga col nome esatto */
async function tracking(run, root, name) {
  const text = await optional(run(['for-each-ref', `--format=${TRACK_FORMAT}`, `${HEADS}${name}`], { cwd: root }));
  const row = String(text || '').split('\n').map((r) => r.split(FIELD_SEP)).find(([ref]) => ref === `${HEADS}${name}`);
  if (!row) return { upstream: null, ahead: 0, behind: 0, gone: false };
  const [, upstream = '', track = ''] = row;
  return { upstream: upstream || null, ...parseTrack(track) };
}

/**
 * Branch e worktree della cartella `cwd`.
 * - `branch` null con HEAD staccato: `detached` è il commit corto.
 * - `unborn`: il branch non ha ancora commit (niente da pushare).
 * - `worktree`: il nome della cartella, se è un worktree collegato.
 * @param {{cwd: string, run?: Function, platform?: string}} o
 * @returns {Promise<{ok: true, root: string, branch: string|null, detached: string|null, unborn: boolean,
 *   upstream: string|null, ahead: number, behind: number, gone: boolean, worktree: string|null}
 *   | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function readHead({ cwd, run = runGit, platform = process.platform } = {}) {
  const repo = await openRepo({ cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const { root } = repo;
  try {
    const [branch, commit, linked] = await Promise.all([
      optional(run(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })),
      optional(run(['rev-parse', '--verify', '--quiet', '--short', 'HEAD^{commit}'], { cwd: root })),
      linkedWorktree(run, root, platform),
    ]);
    const track = branch ? await tracking(run, root, branch) : { upstream: null, ahead: 0, behind: 0, gone: false };
    return {
      ok: true, root, branch, detached: branch ? null : commit, unborn: !commit, ...track,
      worktree: linked ? pathOf(platform).basename(root) : null,
    };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

module.exports = { readHead };
