const assert = require('node:assert');
const { test: ok } = require('node:test');

/* «Da committare» (docs/plans/43): lib/git-staging.js divide il non
   committato fra indice e cartella. Qui le scelte con un git finto; il caso
   con git vero sta in tests/integration.test.js. */
const { readStaging, readStagingDiff } = require('../lib/git-staging');

const NUL = '\0';
const z = (...parts) => parts.join(NUL) + NUL;
const ROOT = '/repo';
const noDisk = { lstat: async () => { throw new Error('niente disco'); } };

/**
 * `run` finto che distingue le due sezioni: `cached` risponde a
 * `git diff --cached`, `work` a `git diff`, `others` a `ls-files --others`.
 */
function fakeGit({ cached = {}, work = {}, others = '', head = 'abc123\n', diff = '', merging = false } = {}, calls = []) {
  return async (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    if (args.includes('--show-toplevel')) return `${ROOT}\n`;
    if (args.includes('MERGE_HEAD')) {
      if (merging) return 'abc123\n';
      throw Object.assign(new Error('exit 1'), { code: 1, stderr: '' });
    }
    if (args.includes('--git-path')) return '.git/rebase-merge\n.git/rebase-apply\n';
    if (args.includes('--verify')) {
      if (head instanceof Error) throw head;
      return head;
    }
    if (args.includes('ls-files')) return others;
    if (args.includes('diff')) {
      const side = args.includes('--cached') ? cached : work;
      if (args.includes('--name-status')) return side.status || '';
      if (args.includes('--numstat')) return side.numstat || '';
      return diff;
    }
    throw Object.assign(new Error(`git finto: ${args.join(' ')}`), { stderr: 'fatal: inatteso' });
  };
}

ok('da committare: staged e non staged in due sezioni, un file a metà in tutte e due', async () => {
  const run = fakeGit({
    cached: { status: z('M', 'a.js', 'A', 'b.js'), numstat: '10\t2\ta.js' + NUL + '20\t0\tb.js' + NUL },
    work: { status: z('M', 'a.js', 'D', 'c.txt'), numstat: '3\t1\ta.js' + NUL + '0\t9\tc.txt' + NUL },
  });
  const r = await readStaging({ cwd: `${ROOT}/lib`, run, fsp: noDisk });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.staging, true);
  assert.deepStrictEqual(r.files.map((f) => [f.side, f.status, f.path, f.added, f.removed]), [
    ['staged', 'M', 'a.js', 10, 2], ['staged', 'A', 'b.js', 20, 0],
    ['unstaged', 'M', 'a.js', 3, 1], ['unstaged', 'D', 'c.txt', 0, 9],
  ]);
  assert.deepStrictEqual(r.totals, { files: 3, added: 33, removed: 12, staged: 2, unstaged: 2 });
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.uncommitted, 3, 'a.js conta una volta');
});

ok('da committare: dice se c\'è un merge o un rebase a metà (il pannello non scrive, piano 53)', async () => {
  const clean = await readStaging({ cwd: ROOT, run: fakeGit(), fsp: noDisk, exists: () => false });
  assert.strictEqual(clean.busy, null);
  const merging = await readStaging({ cwd: ROOT, run: fakeGit({ merging: true }), fsp: noDisk, exists: () => false });
  assert.strictEqual(merging.busy, 'merge');
  const rebasing = await readStaging({ cwd: ROOT, run: fakeGit(), fsp: noDisk, exists: (p) => p.endsWith('rebase-apply') });
  assert.strictEqual(rebasing.busy, 'rebase');
});

ok('da committare: i non tracciati vanno fra i non staged', async () => {
  const r = await readStaging({ cwd: ROOT, run: fakeGit({ others: z('nuovo.md') }), fsp: noDisk });
  assert.deepStrictEqual(r.files.map((f) => [f.side, f.status, f.path, f.untracked]), [['unstaged', '?', 'nuovo.md', true]]);
  assert.deepStrictEqual([r.totals.staged, r.totals.unstaged], [0, 1]);
});

ok('da committare: senza commit l\'indice si confronta lo stesso, e against è null', async () => {
  const run = fakeGit({
    head: Object.assign(new Error(''), { stderr: '' }),
    cached: { status: z('A', 'a.txt'), numstat: '2\t0\ta.txt' + NUL },
  });
  const r = await readStaging({ cwd: ROOT, run, fsp: noDisk });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.against, null);
  assert.deepStrictEqual(r.files.map((f) => [f.side, f.path]), [['staged', 'a.txt']]);
});

ok('da committare: tutto pulito', async () => {
  const r = await readStaging({ cwd: ROOT, run: fakeGit(), fsp: noDisk });
  assert.deepStrictEqual([r.files, r.totals.files, r.uncommitted], [[], 0, 0]);
});

ok('da committare: oltre il limite si taglia, prima le staged', async () => {
  const run = fakeGit({
    cached: { status: z('M', 'a', 'M', 'b') },
    work: { status: z('M', 'c', 'M', 'd') },
    others: z('e'),
  });
  const r = await readStaging({ cwd: ROOT, run, fsp: noDisk, maxFiles: 3 });
  assert.deepStrictEqual(r.files.map((f) => `${f.side}:${f.path}`), ['staged:a', 'staged:b', 'unstaged:c']);
  assert.strictEqual(r.truncated, true);
  assert.deepStrictEqual([r.totals.staged, r.totals.unstaged], [2, 3]);
});

ok('da committare: fuori da un repository lo dice', async () => {
  const run = async () => { throw Object.assign(new Error('x'), { stderr: 'fatal: not a git repository' }); };
  assert.deepStrictEqual(await readStaging({ cwd: '/tmp', run }), { ok: false, reason: 'not-a-repo' });
});

ok('da committare: il diff staged chiede --cached, quello non staged no', async () => {
  const calls = [];
  const run = fakeGit({
    cached: { status: z('M', 'a.js') }, work: { status: z('M', 'a.js') },
    diff: '@@ -1 +1 @@\n-a\n+b\n',
  }, calls);
  const s = await readStagingDiff({ cwd: ROOT, path: 'a.js', side: 'staged', run });
  assert.strictEqual(s.ok, true, s.error);
  assert.strictEqual(s.side, 'staged');
  assert.deepStrictEqual(s.hunks[0].lines.map((l) => l.kind), ['del', 'add']);
  const lastDiff = () => calls.filter((c) => c.args.includes('diff') && !c.args.includes('--name-status')).pop().args;
  assert.ok(lastDiff().includes('--cached'));
  assert.ok(lastDiff().includes('--literal-pathspecs'));
  assert.deepStrictEqual(lastDiff().slice(-2), ['--', 'a.js']);
  await readStagingDiff({ cwd: ROOT, path: 'a.js', side: 'unstaged', run });
  assert.ok(!lastDiff().includes('--cached'));
});

ok('da committare: un rinominato in stage porta anche il vecchio nome nel diff', async () => {
  const calls = [];
  const run = fakeGit({ cached: { status: z('R100', 'vecchio.js', 'nuovo.js') } }, calls);
  const r = await readStagingDiff({ cwd: ROOT, path: 'nuovo.js', side: 'staged', run });
  assert.strictEqual(r.status, 'R');
  assert.deepStrictEqual(calls.pop().args.slice(-3), ['--', 'vecchio.js', 'nuovo.js']);
});

ok('da committare: un file che non è in quella sezione non si legge', async () => {
  const run = fakeGit({ work: { status: z('M', 'a.js') }, others: z('nuovo.md') });
  const staged = await readStagingDiff({ cwd: ROOT, path: 'a.js', side: 'staged', run });
  assert.deepStrictEqual(staged, { ok: false, error: 'Il file non è più fra le modifiche.' });
  // un non tracciato è solo fra i non staged
  const asStaged = await readStagingDiff({ cwd: ROOT, path: 'nuovo.md', side: 'staged', run });
  assert.strictEqual(asStaged.ok, false);
});

ok('da committare: sezione o percorso non validi si rifiutano senza chiamare git', async () => {
  for (const [side, path] of [['tutto', 'a.js'], [undefined, 'a.js'], ['staged', '../fuori'], ['unstaged', '/etc/passwd'], ['staged', '']]) {
    const calls = [];
    const r = await readStagingDiff({ cwd: ROOT, path, side, run: fakeGit({}, calls) });
    assert.strictEqual(r.ok, false, `${side} ${path}`);
    assert.strictEqual(calls.length, 0, `${side} ${path}`);
  }
});

ok('da committare: dice la radice del repository anche aperto da una sottocartella (piano 64)', async () => {
  // Il git finto conosce la radice solo da dentro il repository: fuori sbaglia
  const inner = fakeGit();
  const run = (args, opts) => (args.includes('--show-toplevel') && !String(opts.cwd).startsWith(`${ROOT}/`) && opts.cwd !== ROOT
    ? Promise.reject(Object.assign(new Error('exit 128'), { code: 128, stderr: 'fatal: not a git repository' }))
    : inner(args, opts));
  const r = await readStaging({ cwd: `${ROOT}/lib`, run, fsp: noDisk });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.root, ROOT, 'la radice, non la sottocartella da cui si è aperto');
  const outside = await readStaging({ cwd: '/altrove', run, fsp: noDisk });
  assert.strictEqual(outside.ok, false, 'fuori dal repository non c è radice');
});
