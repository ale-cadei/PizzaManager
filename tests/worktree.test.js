const assert = require('node:assert');
const path = require('path');
const { test: ok } = require('node:test');

/* Sessione in un worktree (docs/plans/36-sessione-worktree.md): lib/worktree.js
   con un finto `git`. Si verifica cosa gli si chiede e come si leggono le
   risposte; il caso con git vero sta in tests/integration.test.js. */
const {
  worktreeDirFor, worktreesContainer, parseWorktreeList, parseBases,
  listWorktrees, worktreeStart, createWorktree, mergeWorktree, removeWorktree, busyWith,
} = require('../lib/worktree');

const win = path.win32;
/* I casi Unix dicono `platform: 'linux'`: senza, su Windows i percorsi finti
   come /src/progetto diventerebbero \src\progetto e i confronti fallirebbero. */

function fakeGit(handler) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, cwd: opts && opts.cwd });
    return handler(args, opts);
  };
  return { run, calls };
}

const gitError = (stderr) => Object.assign(new Error('Command failed: git'), { stderr });
const has = (args, ...words) => words.every((w) => args.includes(w));
const argsOf = (calls) => calls.map((c) => c.args.join(' '));

/* L'output di `git worktree list --porcelain` di un progetto con due worktree,
   uno staccato e uno la cui cartella è stata cancellata a mano */
const PORCELAIN = [
  'worktree /src/progetto', 'HEAD aaa111', 'branch refs/heads/main', '',
  'worktree /src/progetto.worktrees/feat-x', 'HEAD bbb222', 'branch refs/heads/feat/x', '',
  'worktree /src/progetto.worktrees/prova', 'HEAD ccc333', 'detached', 'locked in uso', '',
  'worktree /src/progetto.worktrees/sparito', 'HEAD ddd444', 'branch refs/heads/sparito',
  'prunable gitdir file points to non-existent location', '',
].join('\n');

// ---------- percorsi ----------

ok('worktree: la cartella sta accanto al progetto, in <nome>.worktrees, col branch senza slash', () => {
  assert.strictEqual(worktreesContainer('/src/progetto', { pathImpl: path.posix }), '/src/progetto.worktrees');
  assert.strictEqual(worktreeDirFor('/src/progetto', 'feat/login', { pathImpl: path.posix }), '/src/progetto.worktrees/feat-login');
  assert.notStrictEqual(worktreeDirFor('/src/progetto', 'feat/login', { pathImpl: path.posix }), worktreeDirFor('/src/progetto', 'fix/login', { pathImpl: path.posix }),
    'feat/login e fix/login finiscono nella stessa cartella');
});

ok('worktree: su Windows la cartella si costruisce coi backslash', () => {
  assert.strictEqual(worktreeDirFor('C:\\src\\progetto', 'feat/login', { pathImpl: win }), 'C:\\src\\progetto.worktrees\\feat-login');
});

// ---------- lettura ----------

ok('worktree: parseWorktreeList legge branch, staccati, bloccati e cartelle sparite', () => {
  const list = parseWorktreeList(PORCELAIN, { platform: 'linux' });
  assert.deepStrictEqual(list.map((w) => w.path), [
    '/src/progetto', '/src/progetto.worktrees/feat-x', '/src/progetto.worktrees/prova', '/src/progetto.worktrees/sparito',
  ]);
  assert.deepStrictEqual(list[1], { path: '/src/progetto.worktrees/feat-x', head: 'bbb222', branch: 'feat/x', detached: false, locked: false, prunable: false, bare: false });
  assert.strictEqual(list[2].detached, true);
  assert.strictEqual(list[2].branch, null);
  assert.strictEqual(list[2].locked, true);
  assert.strictEqual(list[3].prunable, true);
});

ok('worktree: parseWorktreeList su Windows riporta i percorsi coi backslash', () => {
  const text = 'worktree C:/src/progetto\nHEAD a\nbranch refs/heads/main\n\nworktree C:/src/progetto.worktrees/feat-x\nHEAD b\nbranch refs/heads/feat/x\n';
  assert.deepStrictEqual(parseWorktreeList(text, { platform: 'win32' }).map((w) => w.path),
    ['C:\\src\\progetto', 'C:\\src\\progetto.worktrees\\feat-x']);
});

ok('worktree: parseWorktreeList con output vuoto o spazzatura non esplode', () => {
  for (const v of ['', '\n\n', 'boh', null, undefined]) assert.deepStrictEqual(parseWorktreeList(v), []);
});

ok('worktree: parseBases legge la base di ogni branch, anche con punti e slash nel nome', () => {
  // git scrive il nome della variabile in minuscolo: pizzaBase → pizzabase
  const text = 'branch.feat/x.pizzabase main\nbranch.release/v1.2.pizzabase develop\n';
  assert.deepStrictEqual(parseBases(text), { 'feat/x': 'main', 'release/v1.2': 'develop' });
  assert.deepStrictEqual(parseBases(''), {});
});

ok('worktree: listWorktrees salta il principale, i bare e le cartelle sparite, e aggiunge la base', async () => {
  const { run } = fakeGit((args) => {
    if (has(args, 'worktree', 'list')) return PORCELAIN;
    if (has(args, 'config', '--get-regexp')) return 'branch.feat/x.pizzabase main\n';
    throw new Error(`inatteso: ${args.join(' ')}`);
  });
  const r = await listWorktrees({ platform: 'linux', root: '/src/progetto', run });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.worktrees.map((w) => [w.path, w.branch, w.base]), [
    ['/src/progetto.worktrees/feat-x', 'feat/x', 'main'],
    ['/src/progetto.worktrees/prova', null, null],
  ]);
});

ok('worktree: listWorktrees senza nessuna base salvata (git config esce con 1) va bene lo stesso', async () => {
  const { run } = fakeGit((args) => {
    if (has(args, 'worktree', 'list')) return PORCELAIN;
    throw gitError('');
  });
  const r = await listWorktrees({ platform: 'linux', root: '/src/progetto', run });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.worktrees[0].base, null);
});

ok('worktree: listWorktrees passa l\'errore di git e rifiuta una radice mancante', async () => {
  const { run } = fakeGit(() => { throw gitError('fatal: unable to read tree'); });
  assert.deepStrictEqual(await listWorktrees({ platform: 'linux', root: '/x', run }), { ok: false, error: 'fatal: unable to read tree' });
  assert.strictEqual((await listWorktrees({ root: '', run })).ok, false);
});

ok('worktree: una cartella che non è un repository non ha worktree, non è un errore', async () => {
  const { run } = fakeGit(() => { throw gitError('fatal: not a git repository (or any of the parent directories): .git'); });
  assert.deepStrictEqual(await listWorktrees({ platform: 'linux', root: '/home/tizio/note', run }), { ok: true, worktrees: [] });
});

// ---------- da dove parte (il modale) ----------

/* Un repository su feat/y, con due file modificati e origin/HEAD → main */
function startRepo({ symbolic = 'feat/y', status = ' M a.js\0?? b.js\0', merging = false } = {}) {
  return fakeGit((args) => {
    if (has(args, 'symbolic-ref', 'HEAD')) {
      if (!symbolic) throw gitError('fatal: ref HEAD is not a symbolic ref');
      return `${symbolic}\n`;
    }
    if (has(args, 'rev-parse', '--short', 'HEAD')) return 'abc1234\n';
    if (has(args, 'status')) return status;
    if (has(args, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
      if (!merging) throw gitError('');
      return 'f00\n';
    }
    if (has(args, 'rev-parse', '--git-path')) return '.git/rebase-merge\n.git/rebase-apply\n';
    if (has(args, 'symbolic-ref', 'refs/remotes/origin/HEAD')) return 'origin/main\n';
    if (has(args, 'for-each-ref')) return 'develop\nfeat/y\nmain\n';
    throw new Error(`inatteso: ${args.join(' ')}`);
  });
}

ok('worktree: worktreeStart propone il branch corrente, poi quello di default, poi gli altri', async () => {
  const { run } = startRepo();
  const r = await worktreeStart({ platform: 'linux', root: '/src/progetto', run, exists: () => false });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.current, { branch: 'feat/y', commit: 'abc1234' });
  assert.deepStrictEqual(r.bases, ['feat/y', 'main', 'develop']);
  assert.strictEqual(r.dirty, 2, 'un modificato e un file nuovo');
  assert.strictEqual(r.busy, null);
});

ok('worktree: worktreeStart con HEAD staccato parte dal commit', async () => {
  const { run } = startRepo({ symbolic: null });
  const r = await worktreeStart({ platform: 'linux', root: '/src/progetto', run, exists: () => false });
  assert.deepStrictEqual(r.current, { branch: null, commit: 'abc1234' });
  assert.deepStrictEqual(r.bases, ['abc1234', 'main', 'develop', 'feat/y']);
});

ok('worktree: worktreeStart conta un rename una volta sola', async () => {
  // In -z il rename porta anche il nome vecchio, come voce a sé
  const { run } = startRepo({ status: 'R  nuovo.js\0vecchio.js\0 M a.js\0' });
  const r = await worktreeStart({ platform: 'linux', root: '/src/progetto', run, exists: () => false });
  assert.strictEqual(r.dirty, 2);
});

ok('worktree: worktreeStart segnala un merge o un rebase in corso', async () => {
  const merging = await worktreeStart({ platform: 'linux', root: '/src/progetto', run: startRepo({ merging: true }).run, exists: () => false });
  assert.strictEqual(merging.busy, 'merge');
  const rebasing = await worktreeStart({ platform: 'linux', root: '/src/progetto', run: startRepo().run, exists: (p) => p === path.posix.join('/src/progetto', '.git/rebase-merge') });
  assert.strictEqual(rebasing.busy, 'rebase');
});

ok('worktree: busyWith riconosce merge, rebase, cherry-pick e revert', async () => {
  const repo = (heads, dirs = []) => fakeGit((args) => {
    const ref = args[args.length - 1];
    if (has(args, '--verify')) { if (heads.includes(ref)) return 'f00\n'; throw gitError(''); }
    if (has(args, '--git-path')) return '.git/rebase-merge\n.git/rebase-apply\n';
    throw new Error(`inatteso: ${args.join(' ')}`);
  });
  const exists = (dirs) => (p) => dirs.some((d) => p.endsWith(d));
  const busy = (heads, dirs = []) => busyWith(repo(heads).run, '/r', exists(dirs), 'linux');
  assert.strictEqual(await busy([]), null);
  assert.strictEqual(await busy(['MERGE_HEAD']), 'merge');
  assert.strictEqual(await busy([], ['rebase-merge']), 'rebase');
  assert.strictEqual(await busy([], ['rebase-apply']), 'rebase');
  assert.strictEqual(await busy(['CHERRY_PICK_HEAD']), 'cherry-pick');
  assert.strictEqual(await busy(['REVERT_HEAD']), 'revert');
  // Un rebase che riapplica un commit: vale il rebase
  assert.strictEqual(await busy(['CHERRY_PICK_HEAD'], ['rebase-merge']), 'rebase');
});

ok('worktree: worktreeStart senza nessun commit lo dice', async () => {
  const { run } = fakeGit((args) => {
    if (has(args, 'symbolic-ref', 'HEAD')) return 'main\n';
    throw gitError("fatal: ambiguous argument 'HEAD': unknown revision");
  });
  const r = await worktreeStart({ platform: 'linux', root: '/src/progetto', run, exists: () => false });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /commit/);
});

// ---------- creazione ----------

function createRepo({ addFails = null, baseIsBranch = true } = {}) {
  return fakeGit((args) => {
    if (has(args, 'check-ref-format')) return 'feat/login\n';
    if (has(args, 'worktree', 'prune')) return '';
    if (has(args, 'worktree', 'add')) {
      if (addFails) throw gitError(addFails);
      return '';
    }
    if (has(args, 'rev-parse', '--verify')) {
      if (!baseIsBranch) throw gitError('');
      return 'abc\n';
    }
    if (has(args, 'config')) return '';
    throw new Error(`inatteso: ${args.join(' ')}`);
  });
}

ok('worktree: createWorktree crea branch e cartella dalla base e se la ricorda', async () => {
  const { run, calls } = createRepo();
  const r = await createWorktree({ platform: 'linux', root: '/src/progetto', branch: 'feat/login', base: 'main', run, exists: () => false, linkIgnored: async () => [] });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.path, '/src/progetto.worktrees/feat-login');
  const sent = argsOf(calls);
  assert.ok(sent.includes('worktree add --no-track -b feat/login /src/progetto.worktrees/feat-login main'), sent.join('\n'));
  assert.ok(sent.includes('config branch.feat/login.pizzaBase main'), 'la base non è stata salvata');
  assert.ok(sent.indexOf('worktree prune') < sent.findIndex((a) => a.startsWith('worktree add')), 'prune dopo add');
  assert.ok(calls.every((c) => c.cwd === '/src/progetto'), 'git lanciato fuori dal progetto');
});

ok('worktree: da un commit (HEAD staccato) non si salva nessuna base', async () => {
  const { run, calls } = createRepo({ baseIsBranch: false });
  const r = await createWorktree({ platform: 'linux', root: '/src/progetto', branch: 'feat/login', base: 'abc1234', run, exists: () => false, linkIgnored: async () => [] });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.base, null);
  assert.ok(!argsOf(calls).some((a) => a.startsWith('config ')), 'base salvata per un commit');
});

ok('worktree: createWorktree rifiuta nomi non validi e basi che sembrano opzioni, senza chiamare git', async () => {
  for (const [branch, base] of [['', 'main'], ['feat login', 'main'], ['-x', 'main'], ['feat/x', '--force'], ['feat/x', '']]) {
    const { run, calls } = createRepo();
    const r = await createWorktree({ platform: 'linux', root: '/src/progetto', branch, base, run, exists: () => false, linkIgnored: async () => [] });
    assert.strictEqual(r.ok, false, `accettato ${branch} da ${base}`);
    assert.ok(!argsOf(calls).some((a) => a.startsWith('worktree add')), `git chiamato per ${branch} da ${base}`);
  }
});

ok('worktree: createWorktree non sovrascrive una cartella che esiste già', async () => {
  const { run, calls } = createRepo();
  const r = await createWorktree({ platform: 'linux', root: '/src/progetto', branch: 'feat/login', base: 'main', run, exists: (p) => p.endsWith('feat-login'), linkIgnored: async () => [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /esiste già/);
  assert.ok(!argsOf(calls).some((a) => a.startsWith('worktree add')));
});

ok('worktree: createWorktree passa il messaggio di git se add fallisce', async () => {
  const { run } = createRepo({ addFails: "fatal: a branch named 'feat/login' already exists" });
  const r = await createWorktree({ platform: 'linux', root: '/src/progetto', branch: 'feat/login', base: 'main', run, exists: () => false, linkIgnored: async () => [] });
  assert.deepStrictEqual(r, { ok: false, error: "fatal: a branch named 'feat/login' already exists" });
});

ok('worktree: se i file ignorati non si collegano il worktree resta, con l\'avviso', async () => {
  const { run } = createRepo();
  const r = await createWorktree({ platform: 'linux', root: '/src/progetto', branch: 'feat/login', base: 'main', run, exists: () => false,
    linkIgnored: async () => { throw new Error('EPERM'); } });
  assert.strictEqual(r.ok, true);
  assert.match(r.warnings.join(' '), /EPERM/);
});

// ---------- unisci ----------

/* Un progetto su main con il worktree feat/x (base main): `over` cambia una
   risposta, `mergeFails` fa fallire il merge */
function mergeRepo({ over = {}, mergeFails = null, merging = false } = {}) {
  let inMerge = false;
  return fakeGit((args, { cwd }) => {
    const key = Object.keys(over).find((k) => args.join(' ').includes(k));
    if (key) {
      const v = over[key];
      if (v instanceof Error) throw v;
      return v;
    }
    if (has(args, 'worktree', 'list')) return PORCELAIN;
    if (has(args, 'config', '--get-regexp')) return 'branch.feat/x.pizzabase main\n';
    if (has(args, 'symbolic-ref')) return 'main\n';
    if (has(args, 'status')) return '';
    if (has(args, 'merge', '--no-edit')) {
      if (mergeFails) {
        inMerge = merging;
        throw gitError(mergeFails);
      }
      return '';
    }
    if (has(args, 'rev-parse', 'MERGE_HEAD')) {
      if (!inMerge) throw gitError('');
      return 'f00\n';
    }
    if (has(args, 'merge', '--abort')) { inMerge = false; return ''; }
    if (has(args, 'worktree', 'remove')) return '';
    if (has(args, 'branch', '-d')) return '';
    throw new Error(`inatteso: ${args.join(' ')} in ${cwd}`);
  });
}

const WT = '/src/progetto.worktrees/feat-x';

ok('worktree: Unisci fa il merge nella cartella principale, poi toglie cartella e branch', async () => {
  const { run, calls } = mergeRepo();
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.strictEqual(r.ok, true, r.error);
  const sent = calls.map((c) => `${c.args.join(' ')} @${c.cwd}`);
  // sempre un merge vero, firmato: la linea del worktree resta nel grafo (piano 66)
  assert.ok(sent.includes("merge --no-ff --no-edit -m Merge branch 'feat/x' (worktree) feat/x @/src/progetto"), sent.join('\n'));
  assert.ok(sent.includes(`worktree remove ${WT} @/src/progetto`));
  assert.ok(sent.includes('branch -d feat/x @/src/progetto'), 'il branch unito resta');
});

ok('worktree: Unisci rifiuta senza toccare niente se la cartella principale non è sulla base', async () => {
  const { run, calls } = mergeRepo({ over: { 'symbolic-ref': 'develop\n' } });
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /develop/);
  assert.match(r.error, /main/);
  assert.ok(!argsOf(calls).some((a) => a.startsWith('merge')), 'merge tentato');
});

ok('worktree: Unisci rifiuta con modifiche nella cartella principale o nel worktree', async () => {
  for (const where of ['/src/progetto', WT]) {
    const repo = mergeRepo();
    const run = (args, opts) => (has(args, 'status') && opts.cwd === where ? Promise.resolve(' M a.js\0') : repo.run(args, opts));
    const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
    assert.strictEqual(r.ok, false, `accettato con modifiche in ${where}`);
    assert.ok(!argsOf(repo.calls).some((a) => a.startsWith('merge')), `merge tentato con modifiche in ${where}`);
  }
});

ok('worktree: Unisci senza base salvata non indovina', async () => {
  const { run, calls } = mergeRepo({ over: { '--get-regexp': gitError('') } });
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /base/i);
  assert.ok(!argsOf(calls).some((a) => a.startsWith('merge')));
});

ok('worktree: Unisci con conflitti annulla il merge e lascia worktree e branch', async () => {
  const { run, calls } = mergeRepo({ mergeFails: 'CONFLICT (content): Merge conflict in a.js', merging: true });
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict, true);
  const sent = argsOf(calls);
  assert.ok(sent.includes('merge --abort'), 'la cartella principale è rimasta a metà merge');
  assert.ok(!sent.some((a) => a.startsWith('worktree remove') || a.startsWith('branch')), 'tolto il worktree dopo un conflitto');
});

ok('worktree: un merge rifiutato prima di cominciare non lancia un abort inutile', async () => {
  const { run, calls } = mergeRepo({ mergeFails: 'error: The following untracked working tree files would be overwritten by merge' });
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.strictEqual(r.ok, false);
  assert.ok(!r.conflict);
  assert.match(r.error, /untracked/);
  assert.ok(!argsOf(calls).includes('merge --abort'));
});

ok('worktree: Unisci rifiuta un percorso che non è un worktree del progetto', async () => {
  for (const p of ['/src/progetto', '/etc', '/src/progetto.worktrees/sparito']) {
    const { run, calls } = mergeRepo();
    const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: p, run, rmdir: () => {} });
    assert.strictEqual(r.ok, false, `accettato ${p}`);
    assert.ok(!argsOf(calls).some((a) => a.startsWith('merge')), `merge tentato su ${p}`);
  }
});

// ---------- tieni il branch / butta ----------

function removeRepo({ dirty = false } = {}) {
  return fakeGit((args) => {
    if (has(args, 'worktree', 'list')) return PORCELAIN;
    if (has(args, 'config', '--get-regexp')) return '';
    if (has(args, 'worktree', 'remove')) {
      if (dirty && !args.includes('--force')) throw gitError(`fatal: '${WT}' contains modified or untracked files, use --force to delete it`);
      return '';
    }
    if (has(args, 'branch')) return '';
    throw new Error(`inatteso: ${args.join(' ')}`);
  });
}

ok('worktree: Tieni il branch toglie solo la cartella', async () => {
  const { run, calls } = removeRepo();
  const r = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, branch: 'keep', run, rmdir: () => {} });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(argsOf(calls).filter((a) => !a.startsWith('worktree list') && !a.startsWith('config')), [`worktree remove ${WT}`]);
});

ok('worktree: Butta toglie cartella e branch anche non unito', async () => {
  const { run, calls } = removeRepo();
  const r = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, branch: 'delete', run, rmdir: () => {} });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(argsOf(calls).includes('branch -D feat/x'));
});

ok('worktree: con modifiche non committate chiede conferma, e con force butta', async () => {
  const { run } = removeRepo({ dirty: true });
  const first = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, branch: 'delete', run, rmdir: () => {} });
  assert.deepStrictEqual({ ok: first.ok, dirty: first.dirty }, { ok: false, dirty: true });
  const second = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, branch: 'delete', force: true, run, rmdir: () => {} });
  assert.strictEqual(second.ok, true, second.error);
});

ok('worktree: un worktree staccato si butta senza toccare branch', async () => {
  const { run, calls } = removeRepo();
  const r = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: '/src/progetto.worktrees/prova', branch: 'delete', run, rmdir: () => {} });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(!argsOf(calls).some((a) => a.startsWith('branch')));
});

ok('worktree: la cartella <progetto>.worktrees si toglie quando resta vuota, e solo quella', async () => {
  const removed = [];
  const { run } = removeRepo();
  await removeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, branch: 'keep', run, rmdir: (p) => removed.push(p) });
  assert.deepStrictEqual(removed, ['/src/progetto.worktrees']);
  // rmdir di una cartella piena fallisce (ENOTEMPTY): non è un errore
  const r = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, branch: 'keep', run, rmdir: () => { throw new Error('ENOTEMPTY'); } });
  assert.strictEqual(r.ok, true);
});

ok('worktree: removeWorktree rifiuta il progetto principale e i percorsi estranei', async () => {
  for (const p of ['/src/progetto', '/etc', '']) {
    const { run, calls } = removeRepo();
    const r = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: p, branch: 'delete', run, rmdir: () => {} });
    assert.strictEqual(r.ok, false, `accettato ${p}`);
    assert.ok(!argsOf(calls).some((a) => a.startsWith('worktree remove')), `remove tentato su ${p}`);
  }
});

ok('worktree: removeWorktree vuole sapere cosa fare del branch', async () => {
  const { run } = removeRepo();
  const r = await removeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, branch: 'boh', run, rmdir: () => {} });
  assert.strictEqual(r.ok, false);
});

ok('worktree: se dopo il merge la cartella non si toglie, lo dice: il merge è fatto', async () => {
  const { run } = mergeRepo({ over: { 'worktree remove': gitError("error: failed to delete '/w': Permission denied") } });
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.merged, true);
  assert.match(r.error, /unit/i, 'il messaggio non dice che il merge c è stato: ' + r.error);
  assert.match(r.error, /Permission denied/);
});
