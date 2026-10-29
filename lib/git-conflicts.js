'use strict';
/* Un merge, rebase, cherry-pick o revert fermo sui conflitti (docs/plans/69):
 * cosa è a metà, quali file sono in conflitto e come, e le quattro scritture
 * del pannello (risolvi un file, continua, annulla).
 *
 * - Sempre argv, mai la shell; percorsi dopo `--` e con `--literal-pathspecs`,
 *   e solo se compaiono adesso fra i file in conflitto.
 * - `op` da una lista chiusa, e deve essere quella che git ha a metà adesso:
 *   un pannello vecchio non continua l'operazione sbagliata.
 * - Hook come da terminale, tempo massimo come il commit (lib/git-commit.js).
 *
 * `run`, `exists` e `fsp` sono iniettabili: i test provano argv e controlli senza git. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');
const { gitMessage } = require('./git-branches');
const { openRepo, isSafeRelative, GIT_GLOBAL } = require('./git-changes');
const { writeError, COMMIT_TIMEOUT_MS } = require('./git-commit');
const { busyWith } = require('./worktree');

const OPS = ['merge', 'rebase', 'cherry-pick', 'revert'];
const KINDS = {
  DD: 'both-deleted', AU: 'added-by-us', UD: 'deleted-by-them', UA: 'added-by-them',
  DU: 'deleted-by-us', AA: 'both-added', UU: 'both-modified',
};
/* Cosa si può fare di un file, per tipo: tenere un lato ha senso solo se ci sono tutti e due */
const HOWS = {
  'both-modified': ['mark', 'ours', 'theirs'], 'both-added': ['mark', 'ours', 'theirs'],
  'deleted-by-us': ['keep', 'delete'], 'deleted-by-them': ['keep', 'delete'],
  'added-by-us': ['keep', 'delete'], 'added-by-them': ['keep', 'delete'], 'both-deleted': ['delete'],
};
const MAX_FILES = 500;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const BINARY_PROBE = 8000;
const MARKERS = /^(?:<{7}|>{7})(?: |\r?$)/m;
const OPENING = /^<{7}(?: |\r?$)/gm;
const LIT = ['--literal-pathspecs'];

const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const fullPath = (platform, root, rel) => pathFor(platform).join(root, ...rel.split('/'));
const stale = (op) => `Il pannello era vecchio: adesso nel repository non c'è un ${op} a metà. Riapri il pannello.`;

/* Voci di `status --porcelain=v2 -z`: «u» in conflitto (10 campi, poi il
   percorso), «1» e «2» tracciati (8 e 9 campi; il «2» ha il nome vecchio
   nella voce dopo). Risolto = qualcosa in staging. */
function parseStatus(text) {
  const parts = String(text || '').split('\0');
  const conflicts = [];
  const resolved = [];
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i];
    const fields = e.split(' ');
    if (e.startsWith('u ')) conflicts.push({ path: fields.slice(10).join(' '), kind: KINDS[fields[1]] || 'both-modified' });
    else if (e.startsWith('1 ') && fields[1][0] !== '.') resolved.push(fields.slice(8).join(' '));
    else if (e.startsWith('2 ')) { if (fields[1][0] !== '.') resolved.push(fields.slice(9).join(' ')); i += 1; }
  }
  return { conflicts, resolved };
}

async function readStatus(run, root) {
  return parseStatus(await run([...GIT_GLOBAL, 'status', '--porcelain=v2', '-z', '--untracked-files=no'], { cwd: root }));
}

/* Quanti blocchi restano; null se non si sa (binario, assente, troppo grande) */
async function describeFile(fsp, platform, root, f) {
  const file = fullPath(platform, root, f.path);
  try {
    if ((await fsp.stat(file)).size > MAX_READ_BYTES) return { ...f, binary: false, blocks: null };
    const text = String(await fsp.readFile(file, 'utf8'));
    if (text.slice(0, BINARY_PROBE).includes('\0')) return { ...f, binary: true, blocks: null };
    return { ...f, binary: false, blocks: (text.match(OPENING) || []).length };
  } catch {
    return { ...f, binary: false, blocks: null };
  }
}

const readText = (fsp, file) => fsp.readFile(file, 'utf8').then((t) => String(t).trim(), () => null);
const shortSha = async (run, root, ref) => run(['rev-parse', '--short', '--verify', ref], { cwd: root })
  .then((t) => t.trim().slice(0, 7), () => null);
const subjectOf = (run, root, ref) => run(['log', '-1', '--format=%s', ref, '--'], { cwd: root }).then((t) => t.trim(), () => null);
const currentBranch = (run, root) => run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root }).then((t) => t.trim() || null, () => null);

async function gitPath(run, root, platform, name) {
  const p = (await run(['rev-parse', '--git-path', name], { cwd: root })).trim();
  return pathFor(platform).resolve(root, p);
}

/* Il nome di un commit: il branch locale che ci punta, o lo sha corto */
async function nameOf(run, root, sha) {
  if (!sha) return null;
  const names = await run(['for-each-ref', '--points-at', sha, '--format=%(refname:short)', 'refs/heads'], { cwd: root })
    .then((t) => t.split('\n').map((l) => l.trim()).filter(Boolean), () => []);
  return names[0] || sha.slice(0, 7);
}

/* Il passo attuale di un rebase a metà (rebase-merge/msgnum o rebase-apply/next),
   per sapere se `continue` l'ha fatto avanzare anche quando è finito in errore. */
async function rebaseStep(run, root, fsp, exists, platform) {
  const merge = await gitPath(run, root, platform, 'rebase-merge');
  const dir = exists(merge) ? merge : await gitPath(run, root, platform, 'rebase-apply');
  return readText(fsp, pathFor(platform).join(dir, dir === merge ? 'msgnum' : 'next'));
}

async function describeRebase(run, root, fsp, exists, platform) {
  const merge = await gitPath(run, root, platform, 'rebase-merge');
  const dir = exists(merge) ? merge : await gitPath(run, root, platform, 'rebase-apply');
  const file = (n) => readText(fsp, pathFor(platform).join(dir, n));
  const [headName, onto] = await Promise.all([file('head-name'), file('onto')]);
  const step = Number(await file(dir === merge ? 'msgnum' : 'next')) || null;
  const total = Number(await file(dir === merge ? 'end' : 'last')) || null;
  return {
    incoming: headName ? headName.replace(/^refs\/heads\//, '') : null,
    into: await nameOf(run, root, onto),
    step, total,
    commit: await shortSha(run, root, 'REBASE_HEAD'),
    subject: await subjectOf(run, root, 'REBASE_HEAD'),
  };
}

const MERGE_MSG_RE = /^Merge (?:remote-tracking )?branch(?:es)? '([^']+)'/;

async function describe(op, { run, root, fsp, exists, platform }) {
  const into = await currentBranch(run, root);
  if (op === 'rebase') return describeRebase(run, root, fsp, exists, platform);
  if (op === 'merge') {
    const msg = await readText(fsp, await gitPath(run, root, platform, 'MERGE_MSG'));
    const commit = await shortSha(run, root, 'MERGE_HEAD');
    const named = msg && MERGE_MSG_RE.exec(msg);
    return { incoming: named ? named[1] : commit, into, step: null, total: null, commit, subject: null };
  }
  const head = op === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : 'REVERT_HEAD';
  return { incoming: null, into, step: null, total: null, commit: await shortSha(run, root, head), subject: await subjectOf(run, root, head) };
}

/* Repository e operazione a metà: i controlli comuni alle letture e alle scritture */
async function open(o) {
  const { run = runGit, platform = process.platform, exists = fs.existsSync, fsp = fs.promises } = o;
  const repo = await openRepo({ cwd: o.cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const op = await busyWith(run, repo.root, exists, platform);
  return { ok: true, root: repo.root, op, run, platform, exists, fsp };
}

/**
 * @param {{cwd: string, run?: Function, exists?: Function, fsp?: object, platform?: string}} o
 */
async function readConflicts(o = {}) {
  try {
    const ctx = await open(o);
    if (!ctx.ok || !ctx.op) return ctx.ok ? { ok: true, root: ctx.root, op: null } : ctx;
    const { conflicts, resolved } = await readStatus(ctx.run, ctx.root);
    const sorted = [...conflicts].sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_FILES);
    const files = await Promise.all(sorted.map((f) => describeFile(ctx.fsp, ctx.platform, ctx.root, f)));
    return { ok: true, root: ctx.root, op: ctx.op, what: await describe(ctx.op, ctx), files, resolved: [...resolved].sort() };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

const RESOLVE_CALLS = {
  mark: (p) => [['add', '--', p]],
  ours: (p) => [['checkout', '--ours', '--', p], ['add', '--', p]],
  theirs: (p) => [['checkout', '--theirs', '--', p], ['add', '--', p]],
  keep: (p) => [['add', '--', p]],
  delete: (p) => [['rm', '--quiet', '--', p]],
};

async function resolveProblem(ctx, file, how) {
  if (!Object.prototype.hasOwnProperty.call(RESOLVE_CALLS, how)) return 'Scelta sconosciuta per il file in conflitto.';
  const { conflicts } = await readStatus(ctx.run, ctx.root);
  const found = conflicts.find((f) => f.path === file);
  if (!found) return `${file} non è più fra i file in conflitto.`;
  if (!HOWS[found.kind].includes(how)) {
    return how === 'ours' || how === 'theirs'
      ? `${file} è cancellato da una delle due parti: tienilo o eliminalo.`
      : `${file} va risolto scegliendo una delle due versioni.`;
  }
  if (how !== 'mark') return null;
  const text = await ctx.fsp.readFile(fullPath(ctx.platform, ctx.root, file), 'utf8').then(String, () => '');
  return MARKERS.test(text) ? `In ${file} restano marcatori di conflitto (<<<<<<< o >>>>>>>): sistemali e salva, poi riprova.` : null;
}

/**
 * @param {{cwd: string, path: string, how: 'mark'|'ours'|'theirs'|'keep'|'delete'}} o
 */
async function resolveFile(o = {}) {
  if (typeof o.path !== 'string' || !isSafeRelative(o.path)) return { ok: false, error: 'Percorso non valido.' };
  try {
    const ctx = await open(o);
    if (!ctx.ok) return ctx;
    if (!ctx.op) return { ok: false, error: 'Nel repository non c\'è più niente a metà.' };
    const problem = await resolveProblem(ctx, o.path, o.how);
    if (problem) return { ok: false, error: problem };
    for (const args of RESOLVE_CALLS[o.how](o.path)) await ctx.run([...LIT, ...args], { cwd: ctx.root });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: writeError(e, 'Risolvi') };
  }
}

/* Il repository fa adesso proprio `op`? Altrimenti il motivo */
async function checkOp(o) {
  if (!OPS.includes(o.op)) return { ok: false, error: 'Operazione sconosciuta.' };
  const ctx = await open(o);
  if (!ctx.ok) return ctx;
  if (ctx.op !== o.op) return { ok: false, error: stale(o.op) };
  return ctx;
}

const CONTINUE_ARGS = {
  merge: ['commit', '--no-edit'],
  rebase: ['rebase', '--continue'],
  'cherry-pick': ['cherry-pick', '--continue'],
  revert: ['revert', '--continue'],
};

/**
 * Concludi il merge o continua rebase/cherry-pick/revert. Il messaggio resta
 * quello preparato da git (GIT_EDITOR=true).
 * @param {{cwd: string, op: string}} o
 */
async function continueOp(o = {}) {
  let ctx;
  try {
    ctx = await checkOp(o);
    if (!ctx.ok) return ctx;
    const { conflicts } = await readStatus(ctx.run, ctx.root);
    if (conflicts.length) {
      return { ok: false, error: `${conflicts.length === 1 ? '1 file è' : `${conflicts.length} file sono`} ancora in conflitto.` };
    }
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
  const stepBefore = o.op === 'rebase' ? await rebaseStep(ctx.run, ctx.root, ctx.fsp, ctx.exists, ctx.platform).catch(() => null) : null;
  try {
    await ctx.run(CONTINUE_ARGS[o.op], { cwd: ctx.root, env: { GIT_EDITOR: 'true' }, timeout: COMMIT_TIMEOUT_MS });
  } catch (e) {
    // Un rebase che si ferma di nuovo (al passo dopo) non è un errore: lo è invece
    // restare fermo allo stesso passo e senza conflitti (es. un file non aggiunto).
    const still = await busyWith(ctx.run, ctx.root, ctx.exists, ctx.platform).catch(() => null);
    if (still === o.op && !e.killed) {
      const { conflicts } = await readStatus(ctx.run, ctx.root).catch(() => ({ conflicts: [] }));
      const stepAfter = o.op === 'rebase' ? await rebaseStep(ctx.run, ctx.root, ctx.fsp, ctx.exists, ctx.platform).catch(() => null) : null;
      const advanced = stepBefore !== null && stepAfter !== null && stepAfter !== stepBefore;
      if (conflicts.length || advanced) return { ok: true, stopped: true };
    }
    return { ok: false, error: writeError(e, o.op === 'merge' ? 'Commit di merge' : `${o.op} --continue`) };
  }
  const still = await busyWith(ctx.run, ctx.root, ctx.exists, ctx.platform).catch(() => null);
  return still === o.op ? { ok: true, stopped: true } : { ok: true, done: true };
}

/**
 * @param {{cwd: string, op: string}} o
 */
async function abortOp(o = {}) {
  try {
    const ctx = await checkOp(o);
    if (!ctx.ok) return ctx;
    await ctx.run([o.op, '--abort'], { cwd: ctx.root, timeout: COMMIT_TIMEOUT_MS });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: writeError(e, `${o.op} --abort`) };
  }
}

module.exports = { readConflicts, resolveFile, continueOp, abortOp, parseStatus, OPS };
