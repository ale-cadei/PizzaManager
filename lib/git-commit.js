'use strict';
/* Stage, unstage e commit dal pannello delle modifiche (docs/plans/53): la
 * prima scrittura del pannello, accanto alle letture di lib/git-staging.js.
 *
 * - Sempre argv, mai la shell; i percorsi dopo `--` e con
 *   `--literal-pathspecs`, e solo se compaiono adesso nella sezione giusta.
 * - Con un merge o un rebase a metà non si scrive: un commit lì chiuderebbe
 *   il merge, non è quello che ci si aspetta dal pannello.
 * - Hook e firma come da terminale: nessun `--no-verify`. Il commit ha un
 *   tempo massimo, perché un hook può non finire mai.
 *
 * `run` ed `exists` sono iniettabili: i test provano argv e controlli senza git. */
const fs = require('fs');
const { runGit } = require('./git-run');
const { gitMessage } = require('./git-branches');
const { openRepo, verify, isSafeRelative } = require('./git-changes');
const { findInSide } = require('./git-staging');
const { busyWith } = require('./worktree');

const MAX_MESSAGE = 10000;
const MAX_PATHS = 500;
const COMMIT_TIMEOUT_MS = 60000;
const MAX_OUTPUT = 4000;
/* Caratteri di controllo: restano solo a capo e tab */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
const LOCK_RE = /index\.lock/;

const BUSY = {
  merge: 'C\'è un merge a metà nel repository: finiscilo o annullalo dal terminale.',
  rebase: 'C\'è un rebase a metà nel repository: finiscilo o annullalo dal terminale.',
};
const SIDE_NAMES = { staged: 'staged', unstaged: 'non staged' };

/**
 * Il messaggio come lo si passa a git, o l'errore che lo rifiuta.
 * @param {unknown} message
 * @returns {{ok: true, message: string} | {ok: false, error: string}}
 */
function cleanMessage(message) {
  if (typeof message !== 'string') return { ok: false, error: 'Scrivi il messaggio del commit.' };
  const text = message.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (!text) return { ok: false, error: 'Scrivi il messaggio del commit.' };
  if (text.length > MAX_MESSAGE) return { ok: false, error: `Messaggio troppo lungo (al massimo ${MAX_MESSAGE} caratteri).` };
  return { ok: true, message: text };
}

function validPaths(paths, platform) {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS) return false;
  return paths.every((p) => isSafeRelative(p, { platform }));
}

/* L'errore di una scrittura, detto in modo utile: tempo scaduto, un altro
   git al lavoro, oppure quello che git (o un suo hook) ha scritto */
function writeError(e, what) {
  if (e && e.killed) return `${what}: nessuna risposta dopo ${COMMIT_TIMEOUT_MS / 1000} s, interrotto.`;
  const output = [e && e.stderr, e && e.stdout].map((s) => String(s || '').trim()).filter(Boolean).join('\n');
  if (LOCK_RE.test(output)) return 'Un altro git sta scrivendo nel repository (index.lock): riprova fra poco.';
  return output ? output.slice(-MAX_OUTPUT) : gitMessage(e);
}

/* Controlli comuni: repository, niente merge o rebase a metà, c'è un HEAD? */
async function prepare({ cwd, run, platform, exists }) {
  const repo = await openRepo({ cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const busy = await busyWith(run, repo.root, exists, platform);
  if (busy) return { ok: false, error: BUSY[busy] };
  return { ok: true, root: repo.root, hasHead: Boolean(await verify(run, repo.root, 'HEAD^{commit}')) };
}

/* Esegue `write(repo)` dopo i controlli; gli errori di git diventano `{ok: false}` */
async function withRepo(o, what, write) {
  const { run = runGit, platform = process.platform, exists = fs.existsSync } = o;
  try {
    const repo = await prepare({ cwd: o.cwd, run, platform, exists });
    if (!repo.ok) return repo;
    return await write({ ...repo, run });
  } catch (e) {
    return { ok: false, error: writeError(e, what) };
  }
}

/* I percorsi da passare a git, solo se ognuno è adesso in quella sezione;
   di un rinominato servono tutti e due i nomi */
async function pathsInSide(run, root, side, paths) {
  const found = await Promise.all(paths.map((p) => findInSide(run, root, side, p)));
  const missing = paths.find((p, i) => !found[i]);
  if (missing !== undefined) return { ok: false, error: `${missing} non è più fra le modifiche ${SIDE_NAMES[side]}.` };
  const all = paths.flatMap((p, i) => (found[i].oldPath ? [found[i].oldPath, p] : [p]));
  return { ok: true, paths: [...new Set(all)] };
}

/**
 * Mette nell'indice i file non staged indicati (anche cancellati o nuovi).
 * @param {{cwd: string, paths: string[], run?: Function, platform?: string,
 *   exists?: (p: string) => boolean}} o
 * @returns {Promise<{ok: true} | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function stagePaths(o = {}) {
  if (!validPaths(o.paths, o.platform || process.platform)) return { ok: false, error: 'Percorsi non validi.' };
  return withRepo(o, 'Aggiunta', async ({ root, run }) => {
    const found = await pathsInSide(run, root, 'unstaged', o.paths);
    if (!found.ok) return found;
    await run(['--literal-pathspecs', 'add', '--', ...found.paths], { cwd: root });
    return { ok: true };
  });
}

/**
 * Toglie dall'indice i file staged indicati; il contenuto sul disco resta.
 * Senza commit non c'è un HEAD a cui tornare: `rm --cached`.
 * @param {{cwd: string, paths: string[], run?: Function, platform?: string,
 *   exists?: (p: string) => boolean}} o
 */
async function unstagePaths(o = {}) {
  if (!validPaths(o.paths, o.platform || process.platform)) return { ok: false, error: 'Percorsi non validi.' };
  return withRepo(o, 'Rimozione dallo stage', async ({ root, run, hasHead }) => {
    const found = await pathsInSide(run, root, 'staged', o.paths);
    if (!found.ok) return found;
    const args = hasHead ? ['restore', '--staged', '--'] : ['rm', '--cached', '-q', '--'];
    await run(['--literal-pathspecs', ...args, ...found.paths], { cwd: root });
    return { ok: true };
  });
}

/** Tutto il non staged nell'indice, non tracciati compresi (`git add -A`). */
async function stageAll(o = {}) {
  return withRepo(o, 'Aggiunta', async ({ root, run }) => {
    await run(['add', '-A'], { cwd: root });
    return { ok: true };
  });
}

/** Indice svuotato di quello che non è nel commit corrente. */
async function unstageAll(o = {}) {
  return withRepo(o, 'Rimozione dallo stage', async ({ root, run, hasHead }) => {
    await run(hasHead ? ['reset', '-q'] : ['rm', '--cached', '-r', '-q', '--', '.'], { cwd: root });
    return { ok: true };
  });
}

/* C'è qualcosa nell'indice? `diff --cached --quiet` esce con 1 se sì */
async function hasStaged(run, root) {
  return run(['diff', '--cached', '--quiet'], { cwd: root }).then(() => false, (e) => {
    if (e && e.code === 1) return true;
    throw e;
  });
}

/**
 * Committa lo staged, e solo quello (niente `-a`).
 * @param {{cwd: string, message: string, run?: Function, platform?: string,
 *   exists?: (p: string) => boolean}} o
 * @returns {Promise<{ok: true, commit: string, branch: string|null}
 *   | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function commitStaged(o = {}) {
  const msg = cleanMessage(o.message);
  if (!msg.ok) return msg;
  return withRepo(o, 'Commit', async ({ root, run }) => {
    if (!await hasStaged(run, root)) return { ok: false, error: 'Niente di staged da committare.' };
    await run(['commit', '-q', '-m', msg.message], { cwd: root, timeout: COMMIT_TIMEOUT_MS });
    const commit = (await run(['rev-parse', '--short', 'HEAD'], { cwd: root })).trim();
    const branch = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root })
      .then((t) => t.trim() || null, () => null);
    return { ok: true, commit, branch };
  });
}

module.exports = {
  stagePaths, unstagePaths, stageAll, unstageAll, commitStaged, cleanMessage,
  MAX_MESSAGE, MAX_PATHS, COMMIT_TIMEOUT_MS,
  // Per il merge di un branch (lib/git-merge.js) e lo scarto (lib/git-discard.js):
  // stessi controlli e stessi messaggi
  writeError, BUSY, withRepo,
};
