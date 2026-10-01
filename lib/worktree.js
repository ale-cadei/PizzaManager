'use strict';
/* Sessione in un git worktree (docs/plans/36-sessione-worktree.md): creare,
 * elencare, unire, tenere come branch, buttare.
 *
 * - I worktree stanno accanto al progetto, in `<progetto>.worktrees/<branch
 *   con / → ->`: fuori dal repository (git status pulito, nessuna ricerca che
 *   trova tutto due volte), una sola voce in più nella cartella genitore.
 * - L'elenco è quello di git (`worktree list --porcelain`): nessun registro
 *   dell'app. La base di un worktree si ricorda nella config del repository,
 *   `branch.<nome>.pizzaBase`, che `git branch -d/-D` toglie da sola.
 * - Unire è prudente: solo se la cartella principale è sulla base e pulita e
 *   il worktree non ha niente di non committato; ai conflitti il merge si
 *   annulla subito e la cartella principale torna com'era.
 * - Mai `--force` senza che l'utente l'abbia confermato (`dirty`), come
 *   `deleteBranch` con `notMerged`.
 *
 * `run` è iniettabile: i test verificano cosa si chiede a git senza git. */
const fs = require('fs');
const path = require('path');
const { runGit, nativePath } = require('./git-run');
const { validateBranchName, gitMessage, deleteBranch } = require('./git-branches');
const { linkIgnored: defaultLinkIgnored } = require('./worktree-files');

const CONTAINER_SUFFIX = '.worktrees';
const BASE_KEY = 'pizzaBase';
/* git scrive il nome della variabile in minuscolo (pizzaBase → pizzabase) */
const BASES_PATTERN = '^branch\\..*\\.pizzabase$';
const BASE_LINE_RE = /^branch\.(.+)\.pizzabase (.+)$/;
/* Con LC_ALL=C (lib/git-run.js) il messaggio è sempre in inglese */
const DIRTY_RE = /contains modified or untracked files/i;
const NOT_A_REPO_RE = /not a git repository/i;
const FALLBACK_DEFAULTS = ['main', 'master'];
const TRAILING_SEP_RE = /[\\/]+$/;

/** `<genitore>/<nome>.worktrees`: la cartella che raccoglie i worktree di un progetto */
function worktreesContainer(root, { pathImpl = path } = {}) {
  return pathImpl.join(pathImpl.dirname(root), pathImpl.basename(root) + CONTAINER_SUFFIX);
}

/** La cartella del worktree di `branch`: `feat/login` → `feat-login`, che non collide con `fix/login` */
function worktreeDirFor(root, branch, { pathImpl = path } = {}) {
  return pathImpl.join(worktreesContainer(root, { pathImpl }), String(branch).replace(/\//g, '-'));
}

/**
 * Output di `git worktree list --porcelain`: un blocco per worktree, separati
 * da una riga vuota; il primo è sempre quello principale.
 * @returns {Array<{path: string, head: string|null, branch: string|null, detached: boolean, locked: boolean, prunable: boolean, bare: boolean}>}
 */
function parseWorktreeList(text, { platform = process.platform } = {}) {
  return String(text || '').split(/\n\s*\n/).map((block) => block.split('\n').filter(Boolean))
    .filter((lines) => lines.length && lines[0].startsWith('worktree '))
    .map((lines) => {
      const value = (key) => {
        const line = lines.find((l) => l === key || l.startsWith(`${key} `));
        return line === undefined ? null : line.slice(key.length + 1);
      };
      const flag = (key) => value(key) !== null;
      const ref = value('branch');
      return {
        path: nativePath(lines[0].slice('worktree '.length), platform),
        head: value('HEAD'),
        branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
        detached: flag('detached'),
        locked: flag('locked'),
        prunable: flag('prunable'),
        bare: flag('bare'),
      };
    });
}

/** Output di `git config --get-regexp` sulle basi: `{ branch: base }` */
function parseBases(text) {
  return Object.fromEntries(String(text || '').split('\n')
    .map((line) => BASE_LINE_RE.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]));
}

const validRoot = (root) => typeof root === 'string' && root.trim() !== '';
const noRoot = () => ({ ok: false, error: 'Radice del progetto mancante.' });
const trimSep = (p) => String(p || '').replace(TRAILING_SEP_RE, '');

async function readBases(root, run) {
  // Esce con 1 se non c'è nessuna base: non è un errore
  return run(['config', '--get-regexp', BASES_PATTERN], { cwd: root }).then(parseBases, () => ({}));
}

/**
 * I worktree del progetto, senza il principale, i bare e quelli la cui
 * cartella è stata cancellata a mano (`prunable`).
 * @param {{root: string, run?: Function, platform?: string}} o
 */
async function listWorktrees({ root, run = runGit, platform = process.platform } = {}) {
  if (!validRoot(root)) return noRoot();
  try {
    const list = parseWorktreeList(await run(['worktree', 'list', '--porcelain'], { cwd: root }), { platform });
    const bases = await readBases(root, run);
    const worktrees = list.slice(1).filter((w) => !w.prunable && !w.bare).map((w) => ({
      path: w.path, branch: w.branch, head: w.head, detached: w.detached, locked: w.locked,
      base: (w.branch && bases[w.branch]) || null,
    }));
    return { ok: true, worktrees };
  } catch (e) {
    const error = gitMessage(e);
    // I progetti senza git (una cartella di note) non hanno worktree: è una
    // risposta, non un errore da segnalare a ogni ritorno in primo piano
    return NOT_A_REPO_RE.test(error) ? { ok: true, worktrees: [] } : { ok: false, error };
  }
}

/* Voci di `git status --porcelain -z`; un rename o una copia portano anche
   il nome vecchio come voce a sé, che non va contata */
function countChanges(text) {
  const parts = String(text || '').split('\0');
  let count = 0;
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i]) continue;
    count += 1;
    if (/^(?:[RC].|.[RC])/.test(parts[i])) i += 1;
  }
  return count;
}

async function hasChanges(run, cwd, { untracked }) {
  const args = ['status', '--porcelain', '-z', ...(untracked ? [] : ['--untracked-files=no'])];
  return countChanges(await run(args, { cwd })) > 0;
}

async function currentBranch(run, cwd) {
  return run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd }).then((t) => t.trim() || null, () => null);
}

async function busyWith(run, root, exists) {
  const merging = await run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).then(() => true, () => false);
  if (merging) return 'merge';
  const paths = (await run(['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply'], { cwd: root }))
    .split('\n').map((l) => l.trim()).filter(Boolean);
  return paths.some((p) => exists(path.resolve(root, p))) ? 'rebase' : null;
}

/* Il branch di default: quello a cui punta origin/HEAD, se esiste anche in
   locale; altrimenti main o master */
async function defaultBranch(run, root, local) {
  const remote = await run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: root })
    .then((t) => t.trim().replace(/^[^/]+\//, ''), () => null);
  if (remote && local.includes(remote)) return remote;
  return FALLBACK_DEFAULTS.find((b) => local.includes(b)) || null;
}

/**
 * Quello che serve al modale «Crea worktree»: da dove si parte, quanti file
 * modificati non seguiranno, se c'è un merge o un rebase a metà, e le basi
 * proponibili (corrente, poi default, poi le altre).
 * @param {{root: string, run?: Function, exists?: (p: string) => boolean}} o
 */
async function worktreeStart({ root, run = runGit, exists = fs.existsSync } = {}) {
  if (!validRoot(root)) return noRoot();
  try {
    const branch = await currentBranch(run, root);
    const commit = await run(['rev-parse', '--short', 'HEAD'], { cwd: root }).then((t) => t.trim(), () => null);
    if (!commit) return { ok: false, error: 'Il repository non ha ancora nessun commit: fai il primo commit prima di creare un worktree.' };
    const dirty = countChanges(await run(['status', '--porcelain', '-z'], { cwd: root }));
    const busy = await busyWith(run, root, exists);
    const local = (await run(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: root }))
      .split('\n').map((l) => l.trim()).filter(Boolean);
    const bases = [...new Set([branch || commit, await defaultBranch(run, root, local), ...local].filter(Boolean))];
    return { ok: true, current: { branch, commit }, dirty, busy, bases };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

/* La base si salva solo se è un branch: da un commit non c'è niente in cui unire */
async function rememberBase(run, root, branch, base) {
  const isBranch = await run(['rev-parse', '--verify', '--quiet', `refs/heads/${base}`], { cwd: root }).then(() => true, () => false);
  if (!isBranch) return { base: null, warnings: [] };
  try {
    await run(['config', `branch.${branch}.${BASE_KEY}`, base], { cwd: root });
    return { base, warnings: [] };
  } catch (e) {
    return { base: null, warnings: [`Base non salvata (Unisci non sarà disponibile): ${gitMessage(e)}`] };
  }
}

/**
 * Nuovo branch `branch` da `base`, nella sua cartella accanto al progetto.
 * Se qualcosa va storto dopo `worktree add`, il worktree resta e l'avviso lo
 * dice: meglio un worktree senza node_modules che uno sparito.
 * @param {{root: string, branch: string, base: string, run?: Function,
 *   exists?: (p: string) => boolean, linkIgnored?: Function}} o
 */
async function createWorktree({ root, branch, base, run = runGit, exists = fs.existsSync, linkIgnored = defaultLinkIgnored } = {}) {
  if (!validRoot(root)) return noRoot();
  const name = String(branch || '').trim();
  const problem = validateBranchName(name);
  if (problem) return { ok: false, error: problem };
  const from = String(base || '').trim();
  // Un nome che comincia con `-` git lo leggerebbe come un'opzione
  if (!from || validateBranchName(from)) return { ok: false, error: `"${from}" non è un punto di partenza valido.` };
  try {
    await run(['check-ref-format', '--branch', name], { cwd: root });
  } catch {
    return { ok: false, error: `"${name}" non è un nome valido per un branch git.` };
  }
  const dir = worktreeDirFor(root, name);
  if (exists(dir)) return { ok: false, error: `La cartella ${dir} esiste già: scegli un altro nome o toglila prima.` };
  try {
    // Una cartella cancellata a mano tiene occupato il suo branch finché git non fa pulizia
    await run(['worktree', 'prune'], { cwd: root });
    // --no-track: da una base remota (origin/main) il branch non deve seguirla,
    // finché non lo si pubblica
    await run(['worktree', 'add', '--no-track', '-b', name, dir, from], { cwd: root });
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
  const saved = await rememberBase(run, root, name, from);
  const linked = await linkIgnored({ root, dir, run }).catch((e) => [`File ignorati non portati nel worktree: ${String((e && e.message) || e)}`]);
  return { ok: true, path: dir, branch: name, base: saved.base, warnings: [...saved.warnings, ...linked] };
}

/* Solo i worktree che git conosce per questo progetto: un percorso qualsiasi
   arrivato dalla UI non deve mai finire in `worktree remove` o in un merge */
async function findWorktree({ root, path: wtPath, run, platform }) {
  if (!validRoot(root)) return noRoot();
  if (!validRoot(wtPath)) return { ok: false, error: 'Percorso del worktree mancante.' };
  const listed = await listWorktrees({ root, run, platform });
  if (!listed.ok) return listed;
  const worktree = listed.worktrees.find((w) => trimSep(w.path) === trimSep(wtPath));
  return worktree ? { ok: true, worktree } : { ok: false, error: `${wtPath} non è un worktree di ${root}.` };
}

/* Toglie `<progetto>.worktrees` quando l'ultimo worktree se ne va. rmdir non
   ricorsivo: con altri worktree dentro fallisce, ed è quello che si vuole. */
function dropContainerIfEmpty(root, wtPath, rmdir) {
  const container = worktreesContainer(root);
  if (path.dirname(trimSep(wtPath)) !== container) return;
  try { rmdir(container); } catch { /* non vuota: ci sono altri worktree */ }
}

async function removeFound({ root, worktree, deleteMode, force, run, rmdir }) {
  try {
    await run(['worktree', 'remove', ...(force ? ['--force'] : []), worktree.path], { cwd: root });
  } catch (e) {
    const error = gitMessage(e);
    return DIRTY_RE.test(error) ? { ok: false, dirty: true, error } : { ok: false, error };
  }
  dropContainerIfEmpty(root, worktree.path, rmdir);
  if (!deleteMode || !worktree.branch) return { ok: true, branchDeleted: false };
  const deleted = await deleteBranch({ cwd: root, name: worktree.branch, force: deleteMode === 'force', run });
  if (deleted.ok) return { ok: true, branchDeleted: true };
  return { ok: false, removed: true, error: `Cartella tolta, ma il branch ${worktree.branch} è rimasto: ${deleted.error}` };
}

/**
 * «Tieni il branch» (`branch: 'keep'`) o «Butta» (`branch: 'delete'`).
 * Con modifiche non committate git rifiuta: `{ dirty: true }`, e si riprova
 * con `force` solo dopo la conferma dell'utente.
 * @param {{root: string, path: string, branch: 'keep'|'delete', force?: boolean,
 *   run?: Function, rmdir?: (p: string) => void, platform?: string}} o
 */
async function removeWorktree({ root, path: wtPath, branch, force = false, run = runGit, rmdir = fs.rmdirSync, platform = process.platform } = {}) {
  if (branch !== 'keep' && branch !== 'delete') return { ok: false, error: 'Cosa fare del branch? (keep o delete)' };
  const found = await findWorktree({ root, path: wtPath, run, platform });
  if (!found.ok) return found;
  return removeFound({ root, worktree: found.worktree, deleteMode: branch === 'delete' ? 'force' : null, force: force === true, run, rmdir });
}

/* I controlli prima di unire; null se si può */
async function mergeProblem(run, root, worktree) {
  if (!worktree.branch) return 'Il worktree non è su un branch: non c\'è niente da unire.';
  if (!worktree.base) return `Non so in quale branch unire ${worktree.branch} (base non salvata): usa «Tieni il branch» e apri una PR.`;
  const current = await currentBranch(run, root);
  if (current !== worktree.base) {
    return `La cartella principale è su ${current || 'un commit staccato'}: passa a ${worktree.base} per unire ${worktree.branch}.`;
  }
  if (await hasChanges(run, root, { untracked: false })) {
    return 'Nella cartella principale ci sono modifiche non committate: committale o mettile da parte prima di unire.';
  }
  if (await hasChanges(run, worktree.path, { untracked: true })) {
    return 'Nel worktree ci sono modifiche non committate, che non finirebbero nel merge: committale, oppure butta il worktree.';
  }
  return null;
}

/**
 * «Unisci»: merge del branch del worktree nella sua base, dalla cartella
 * principale; se va liscio toglie cartella e branch.
 * @param {{root: string, path: string, run?: Function, rmdir?: (p: string) => void, platform?: string}} o
 * @returns {Promise<{ok: boolean, conflict?: boolean, error?: string}>}
 */
async function mergeWorktree({ root, path: wtPath, run = runGit, rmdir = fs.rmdirSync, platform = process.platform } = {}) {
  const found = await findWorktree({ root, path: wtPath, run, platform });
  if (!found.ok) return found;
  const { worktree } = found;
  try {
    const problem = await mergeProblem(run, root, worktree);
    if (problem) return { ok: false, error: problem };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
  try {
    await run(['merge', '--no-edit', worktree.branch], { cwd: root });
  } catch (e) {
    return abortFailedMerge(run, root, worktree, gitMessage(e));
  }
  const removed = await removeFound({ root, worktree, deleteMode: 'merged', force: false, run, rmdir });
  if (removed.ok) return removed;
  // Il merge c'è stato: dirlo, o sembrerebbe che il lavoro non sia entrato
  // (su Windows una sessione aperta nella cartella ne blocca la rimozione)
  return { ...removed, merged: true, error: `${worktree.branch} è unito in ${worktree.base}, ma: ${removed.error}` };
}

/* Un merge rifiutato prima di cominciare non lascia niente da annullare; uno
   fermo sui conflitti sì, e la cartella principale deve tornare com'era */
async function abortFailedMerge(run, root, worktree, error) {
  const merging = await run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).then(() => true, () => false);
  if (!merging) return { ok: false, error };
  const aborted = await run(['merge', '--abort'], { cwd: root }).then(() => true, () => false);
  if (!aborted) {
    return { ok: false, conflict: true, error: `Conflitti, e il merge non si è potuto annullare: la cartella principale è a metà merge (git merge --abort).\n\n${error}` };
  }
  return {
    ok: false,
    conflict: true,
    error: `Conflitti fra ${worktree.branch} e ${worktree.base}: il merge è stato annullato, la cartella principale è com'era. `
      + `Allinea il branch nel worktree (git merge ${worktree.base}) e riprova.\n\n${error}`,
  };
}

module.exports = {
  worktreesContainer, worktreeDirFor, parseWorktreeList, parseBases,
  listWorktrees, worktreeStart, createWorktree, mergeWorktree, removeWorktree,
};
