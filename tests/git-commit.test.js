const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Stage, unstage e commit dal pannello (docs/plans/53): lib/git-commit.js è
   la prima scrittura del pannello. Qui argv e controlli con un git finto; il
   caso con git vero sta in tests/integration.test.js. */
const C = require('../lib/git-commit');

const NUL = '\0';
const z = (...parts) => parts.join(NUL) + NUL;
const ROOT = '/repo';
const noBusy = () => false;

const fail = (code, stderr, extra = {}) => Object.assign(new Error(`exit ${code}`), { code, stderr, stdout: '', ...extra });

/**
 * git finto: `cached`/`work` rispondono a `diff --name-status` delle due
 * sezioni, `others` ai non tracciati; `head` null = repository senza commit.
 * `write` decide cosa succede ai comandi che scrivono (add, restore, rm, reset, commit).
 */
function fakeGit({ cached = '', work = '', others = '', head = 'abc1234', merging = false, write = () => '' } = {}) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, opts });
    if (args.includes('--show-toplevel')) return `${ROOT}\n`;
    if (args.includes('MERGE_HEAD')) { if (merging) return 'deadbeef\n'; throw fail(1, ''); }
    if (args.includes('CHERRY_PICK_HEAD') || args.includes('REVERT_HEAD')) throw fail(1, '');
    if (args.includes('--git-path')) return '.git/rebase-merge\n.git/rebase-apply\n';
    if (args.includes('--verify')) { if (head) return `${head}\n`; throw fail(1, ''); }
    if (args[0] === 'rev-parse' && args.includes('--short')) return `${head}\n`;
    if (args[0] === 'symbolic-ref') return 'main\n';
    if (args.includes('ls-files')) return others;
    if (args.includes('diff') && args.includes('--quiet')) { if (cached) throw fail(1, ''); return ''; }
    if (args.includes('diff') && args.includes('--name-status')) return args.includes('--cached') ? cached : work;
    return write(args, opts);
  };
  return { run, calls, writes: () => calls.filter((c) => ['add', 'restore', 'rm', 'reset', 'commit'].some((w) => c.args.includes(w))) };
}

const writesOf = (g) => g.writes().map((c) => c.args);

ok('commit: ＋ mette in stage solo un percorso che adesso è fra i non staged', async () => {
  const g = fakeGit({ work: z('M', 'lib/a.js', 'D', 'vecchio.txt'), others: z('nuovo.md') });
  const r = await C.stagePaths({ cwd: `${ROOT}/lib`, paths: ['lib/a.js', 'vecchio.txt', 'nuovo.md'], run: g.run, exists: noBusy, platform: 'linux' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(writesOf(g), [['--literal-pathspecs', 'add', '--', 'lib/a.js', 'vecchio.txt', 'nuovo.md']]);
  assert.strictEqual(g.writes()[0].opts.cwd, ROOT, 'dalla radice: i percorsi sono relativi a lei');
});

ok('commit: un percorso che non c\'è, o che esce dalla radice, non arriva a git', async () => {
  const g = fakeGit({ work: z('M', 'a.js') });
  const missing = await C.stagePaths({ cwd: ROOT, paths: ['a.js', 'sparito.js'], run: g.run, exists: noBusy });
  assert.strictEqual(missing.ok, false);
  assert.match(missing.error, /sparito\.js/);
  for (const bad of [['../fuori'], ['/etc/passwd'], [''], [], 'a.js', [42], ['a\0b']]) {
    const r = await C.stagePaths({ cwd: ROOT, paths: bad, run: g.run, exists: noBusy });
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
  }
  // un file staged non si mette in stage di nuovo da qui: deve essere fra i non staged
  const staged = fakeGit({ cached: z('M', 'a.js') });
  assert.strictEqual((await C.stagePaths({ cwd: ROOT, paths: ['a.js'], run: staged.run, exists: noBusy })).ok, false);
  assert.deepStrictEqual(writesOf(g), []);
  assert.deepStrictEqual(writesOf(staged), []);
});

ok('commit: − toglie dallo stage, rinominati compresi; senza commit con rm --cached', async () => {
  const g = fakeGit({ cached: z('M', 'a.js', 'R100', 'vecchio.js', 'nuovo.js') });
  assert.strictEqual((await C.unstagePaths({ cwd: ROOT, paths: ['a.js', 'nuovo.js'], run: g.run, exists: noBusy })).ok, true);
  assert.deepStrictEqual(writesOf(g), [['--literal-pathspecs', 'restore', '--staged', '--', 'a.js', 'vecchio.js', 'nuovo.js']]);
  const empty = fakeGit({ cached: z('A', 'a.js'), head: null });
  assert.strictEqual((await C.unstagePaths({ cwd: ROOT, paths: ['a.js'], run: empty.run, exists: noBusy })).ok, true);
  assert.deepStrictEqual(writesOf(empty), [['--literal-pathspecs', 'rm', '--cached', '-q', '--', 'a.js']]);
});

ok('commit: «tutti» in un colpo, anche senza commit', async () => {
  const g = fakeGit({ cached: z('M', 'a.js') });
  await C.stageAll({ cwd: ROOT, run: g.run, exists: noBusy });
  await C.unstageAll({ cwd: ROOT, run: g.run, exists: noBusy });
  assert.deepStrictEqual(writesOf(g), [['add', '-A'], ['reset', '-q']]);
  const empty = fakeGit({ cached: z('A', 'a.js'), head: null });
  await C.unstageAll({ cwd: ROOT, run: empty.run, exists: noBusy });
  assert.deepStrictEqual(writesOf(empty), [['rm', '--cached', '-r', '-q', '--', '.']]);
});

ok('commit: committa lo staged col messaggio in argv, e dice cosa ha fatto', async () => {
  const g = fakeGit({ cached: z('M', 'a.js') });
  const r = await C.commitStaged({ cwd: ROOT, message: '  fix: controllo su null\n\nperché sì  ', run: g.run, exists: noBusy });
  assert.deepStrictEqual(r, { ok: true, commit: 'abc1234', branch: 'main' });
  const [commit] = g.writes();
  assert.deepStrictEqual(commit.args, ['commit', '-q', '-m', 'fix: controllo su null\n\nperché sì']);
  assert.strictEqual(commit.opts.timeout, C.COMMIT_TIMEOUT_MS);
  assert.ok(!commit.args.includes('--no-verify') && !commit.args.includes('-a'));
});

ok('commit: messaggio vuoto, troppo lungo o niente di staged: rifiutato prima di git', async () => {
  const g = fakeGit({ cached: z('M', 'a.js') });
  for (const message of ['', '   \n ', null, 'x'.repeat(C.MAX_MESSAGE + 1)]) {
    const r = await C.commitStaged({ cwd: ROOT, message, run: g.run, exists: noBusy });
    assert.strictEqual(r.ok, false, JSON.stringify(message));
    assert.ok(r.error);
  }
  const nothing = fakeGit();
  const r = await C.commitStaged({ cwd: ROOT, message: 'x', run: nothing.run, exists: noBusy });
  assert.match(r.error, /staged/);
  assert.deepStrictEqual([...writesOf(g), ...writesOf(nothing)], []);
});

ok('commit: dal messaggio spariscono i caratteri di controllo, restano a capo e tab', async () => {
  const g = fakeGit({ cached: z('M', 'a.js') });
  await C.commitStaged({ cwd: ROOT, message: 'a\x1b[31mb\r\n\tc\x07', run: g.run, exists: noBusy });
  assert.strictEqual(g.writes()[0].args[3], 'a[31mb\n\tc');
});

ok('commit: con un merge o un rebase a metà niente scritture', async () => {
  const merging = fakeGit({ cached: z('M', 'a.js'), work: z('M', 'b.js'), merging: true });
  const rebasing = fakeGit({ cached: z('M', 'a.js'), work: z('M', 'b.js') });
  const inRebase = (p) => p.endsWith('rebase-merge');
  const results = [
    await C.commitStaged({ cwd: ROOT, message: 'x', run: merging.run, exists: noBusy }),
    await C.stagePaths({ cwd: ROOT, paths: ['b.js'], run: merging.run, exists: noBusy }),
    await C.stageAll({ cwd: ROOT, run: rebasing.run, exists: inRebase }),
  ];
  assert.match(results[0].error, /merge/);
  assert.match(results[1].error, /merge/);
  assert.match(results[2].error, /rebase/);
  assert.deepStrictEqual([...writesOf(merging), ...writesOf(rebasing)], []);
});

ok('commit: hook che fallisce → il suo output; index.lock → riprova; tempo scaduto → detto', async () => {
  const hook = fakeGit({ cached: z('M', 'a.js'), write: () => { throw fail(1, '', { stdout: 'eslint: 3 errori\n' }); } });
  const r1 = await C.commitStaged({ cwd: ROOT, message: 'x', run: hook.run, exists: noBusy });
  assert.strictEqual(r1.ok, false);
  assert.match(r1.error, /eslint: 3 errori/);
  const lock = fakeGit({ work: z('M', 'a.js'), write: () => { throw fail(128, "fatal: Unable to create '/repo/.git/index.lock': File exists.") ; } });
  const r2 = await C.stagePaths({ cwd: ROOT, paths: ['a.js'], run: lock.run, exists: noBusy });
  assert.match(r2.error, /riprova/);
  const slow = fakeGit({ cached: z('M', 'a.js'), write: () => { throw fail(null, '', { killed: true, signal: 'SIGTERM' }); } });
  const r3 = await C.commitStaged({ cwd: ROOT, message: 'x', run: slow.run, exists: noBusy });
  assert.match(r3.error, /60 s/);
});

ok('commit: fuori da un repository o senza cartella, nessun comando di scrittura', async () => {
  const notRepo = async () => { throw fail(128, 'fatal: not a git repository (or any of the parent directories): .git'); };
  assert.deepStrictEqual(await C.stageAll({ cwd: '/tmp', run: notRepo, exists: noBusy }), { ok: false, reason: 'not-a-repo' });
  assert.strictEqual((await C.commitStaged({ cwd: '', message: 'x', run: notRepo, exists: noBusy })).ok, false);
});
