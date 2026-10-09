'use strict';
/* «Da committare» nel pannello delle modifiche (docs/plans/43): il non
 * committato diviso fra quello che è già nell'indice e quello che no.
 *
 * - Staged: `git diff --cached`, l'indice contro HEAD (senza commit git lo
 *   confronta con l'albero vuoto: tutto l'indice è nuovo).
 * - Non staged: `git diff`, la cartella contro l'indice, più i file non
 *   tracciati letti dal disco come in lib/git-changes.js.
 * - Un file parzialmente staged sta in tutte e due, ognuna col suo diff:
 *   ogni voce porta `side` ('staged' | 'unstaged').
 * - Stesse garanzie di lib/git-changes.js: solo letture, il diff solo per un
 *   percorso che compare adesso in quella sezione, i non tracciati solo se
 *   sono file veri.
 *
 * `run` è iniettabile: i test provano parsing e scelte senza git. */
const fs = require('fs');
const { runGit } = require('./git-run');
const { gitMessage } = require('./git-branches');
const {
  GIT_GLOBAL, DIFF_FLAGS, MAX_FILES, MAX_DIFF_LINES, MAX_COUNT_BYTES, sharedCountCache,
  openRepo, verify, listTracked, nameStatus, listOnDisk, countFromDisk, withStamps, diffFromDisk,
  mergeChanges, parseUnifiedDiff, isSafeRelative, sum,
} = require('./git-changes');

const SIDES = ['staged', 'unstaged'];
/* Gli argomenti di `git diff` per ogni sezione */
const SIDE_REFS = { staged: ['--cached'], unstaged: [] };

const withSide = (files, side) => files.map((f) => ({ ...f, side }));

/* Le due sezioni, al più `maxFiles` voci in tutto: prima le staged */
async function listSides(run, root, { maxFiles, maxCountBytes, fsp, countCache }) {
  const [staged, unstaged, others] = await Promise.all([
    listTracked(run, root, SIDE_REFS.staged),
    listTracked(run, root, SIDE_REFS.unstaged),
    listOnDisk(run, root, { cached: false }),
  ]);
  const stagedFiles = mergeChanges(staged.statuses, staged.numstats).slice(0, maxFiles);
  // Si leggono dal disco solo i non tracciati che finiranno nell'elenco
  const room = Math.max(0, maxFiles - stagedFiles.length - unstaged.statuses.length);
  const fromDisk = await Promise.all(others.slice(0, room)
    .map((p) => countFromDisk(root, p, { status: '?', maxCountBytes, fsp, countCache })));
  const unstagedAll = mergeChanges(unstaged.statuses, unstaged.numstats, fromDisk);
  const unstagedFiles = unstagedAll.slice(0, Math.max(0, maxFiles - stagedFiles.length));
  return {
    staged: stagedFiles,
    unstaged: await withStamps(root, unstagedFiles, fsp),
    counts: { staged: staged.statuses.length, unstaged: unstaged.statuses.length + others.length },
    all: [...stagedFiles, ...unstagedAll],
  };
}

/**
 * Il non committato di `cwd`, in due sezioni.
 * @param {{cwd: string, run?: Function, fsp?: object, platform?: string, maxFiles?: number,
 *   maxCountBytes?: number, countCache?: object}} o
 * @returns {Promise<{ok: true, root: string, against: string|null, base: null, since: false,
 *   staging: true, files: Array<object & {side: 'staged'|'unstaged'}>,
 *   totals: {files: number, added: number, removed: number, staged: number, unstaged: number},
 *   truncated: boolean, uncommitted: number}
 *   | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function readStaging({
  cwd, run = runGit, fsp = fs.promises, platform = process.platform,
  maxFiles = MAX_FILES, maxCountBytes = MAX_COUNT_BYTES, countCache = sharedCountCache,
} = {}) {
  const repo = await openRepo({ cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const { root } = repo;
  try {
    const against = await verify(run, root, 'HEAD^{commit}');
    const sides = await listSides(run, root, { maxFiles, maxCountBytes, fsp, countCache });
    const files = [...withSide(sides.staged, 'staged'), ...withSide(sides.unstaged, 'unstaged')];
    const total = sides.counts.staged + sides.counts.unstaged;
    // Quanti percorsi diversi: un file parzialmente staged conta una volta
    const paths = new Set(sides.all.map((f) => f.path)).size;
    return {
      ok: true, root, against, base: null, since: false, staging: true, files,
      totals: {
        files: paths, added: sum(sides.all, 'added'), removed: sum(sides.all, 'removed'),
        staged: sides.counts.staged, unstaged: sides.counts.unstaged,
      },
      truncated: total > files.length,
      uncommitted: paths,
    };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

/* `rel` è adesso in quella sezione? I tracciati dal loro stato (i rinominati
   servono interi), i non tracciati chiedendo a git di quel solo percorso */
async function findInSide(run, root, side, rel) {
  const tracked = (await nameStatus(run, root, SIDE_REFS[side])).find((f) => f.path === rel);
  if (tracked) return { status: tracked.status, oldPath: tracked.oldPath, fromDisk: false };
  if (side === 'staged') return null;
  return (await listOnDisk(run, root, { cached: false, rel })).includes(rel) ? { status: '?', fromDisk: true } : null;
}

/**
 * Il diff di un file in una delle due sezioni. Sezione sconosciuta, percorso
 * che esce dalla radice o che non è fra le modifiche: rifiutati prima di
 * leggere qualcosa.
 * @param {{cwd: string, path: string, side: 'staged'|'unstaged', run?: Function, fsp?: object,
 *   platform?: string, maxLines?: number}} o
 */
async function readStagingDiff({
  cwd, path: rel, side, run = runGit, fsp = fs.promises, platform = process.platform, maxLines = MAX_DIFF_LINES,
} = {}) {
  if (!SIDES.includes(side)) return { ok: false, error: 'Sezione non valida.' };
  if (!isSafeRelative(rel, { platform })) return { ok: false, error: 'Percorso non valido.' };
  const repo = await openRepo({ cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const { root } = repo;
  try {
    const file = await findInSide(run, root, side, rel);
    if (!file) return { ok: false, error: 'Il file non è più fra le modifiche.' };
    const diff = file.fromDisk
      ? await diffFromDisk(root, rel, { maxLines, fsp })
      : parseUnifiedDiff(await run([
        ...GIT_GLOBAL, '--literal-pathspecs', 'diff', ...DIFF_FLAGS, ...SIDE_REFS[side],
        '--', ...(file.oldPath ? [file.oldPath] : []), rel,
      ], { cwd: root }), { maxLines });
    if (diff.ok === false) return diff;
    return { ok: true, path: rel, side, status: file.status, ...diff };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

module.exports = { readStaging, readStagingDiff, findInSide, SIDES };
