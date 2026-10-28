const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Unire un branch qualsiasi nel corrente (docs/plans/54): argv e controlli
   con un git finto; il caso con git vero sta in tests/integration.test.js. */
const M = require('../lib/git-merge');

const ROOT = '/repo';
const noBusy = () => false;
const fail = (code, stderr = '', extra = {}) => Object.assign(new Error(`exit ${code}`), { code, stderr, stdout: '', ...extra });

/**
 * git finto. `refs`: i ref che esistono (nome completo → sha); `current`: il
 * branch della cartella (null = commit staccato); `dirty`: file tracciati non
 * committati; `ancestor`: il branch è già contenuto nel corrente;
 * `merge(args)`: cosa fa `git merge`; dopo un merge riuscito HEAD vale `after`.
 */
function fakeGit({
  refs = { 'refs/heads/main': 'aaa111', 'refs/heads/feat/x': 'bbb222' }, current = 'main', dirty = '',
  ancestor = false, merging = false, merge = () => '', after = 'ccc333', abort = () => '', conflicts = '',
} = {}) {
  const calls = [];
  let merged = false;
  let inMerge = merging;
  const run = async (args, opts) => {
    calls.push({ args, opts });
    if (args.includes('--show-toplevel')) return `${ROOT}\n`;
    if (args.includes('MERGE_HEAD')) { if (inMerge) return 'deadbeef\n'; throw fail(1); }
    if (args.includes('--git-path')) return '.git/rebase-merge\n.git/rebase-apply\n';
    if (args[0] === 'symbolic-ref') { if (current) return `${current}\n`; throw fail(1); }
    if (args.includes('--verify')) {
      const ref = args[args.length - 1].replace(/\^\{commit\}$/, '');
      if (ref === 'HEAD') return `${merged ? after : refs[`refs/heads/${current}`] || 'aaa111'}\n`;
      if (refs[ref]) return `${refs[ref]}\n`;
      throw fail(1);
    }
    if (args[0] === 'rev-parse' && args.includes('--short')) return `${(merged ? after : 'aaa111').slice(0, 7)}\n`;
    if (args.includes('--is-ancestor')) { if (ancestor) return ''; throw fail(1); }
    if (args[0] === 'diff' && args.includes('--diff-filter=U')) return conflicts;
    if (args[0] === 'diff') return dirty;
    if (args[0] === 'merge' && args.includes('--abort')) { abort(); inMerge = false; return ''; }
    if (args[0] === 'merge') {
      try { const out = merge(args, opts); merged = true; return out; } catch (e) { inMerge = Boolean(e.leavesMerge); throw e; }
    }
    throw fail(128, `git finto: ${args.join(' ')}`);
  };
  return { run, calls, merges: () => calls.filter((c) => c.args[0] === 'merge') };
}

// Il git finto parla POSIX (/repo): su Windows nativePath lo farebbe \repo.
const opts = (g, extra = {}) => ({ cwd: `${ROOT}/sub`, name: 'feat/x', kind: 'local', run: g.run, exists: noBusy, platform: 'linux', ...extra });

ok('merge: unisce il branch nel corrente con --no-edit dalla radice, e dice come', async () => {
  const g = fakeGit();
  const r = await M.mergeBranch(opts(g, { expect: 'bbb222' }));
  assert.deepStrictEqual(r, { ok: true, branch: 'feat/x', into: 'main', fastForward: false, commit: 'ccc333' });
  const [merge] = g.merges();
  assert.deepStrictEqual(merge.args, ['merge', '--no-edit', 'feat/x']);
  assert.strictEqual(merge.opts.cwd, ROOT);
  assert.strictEqual(merge.opts.timeout, M.MERGE_TIMEOUT_MS);
  assert.ok(!merge.args.includes('--no-verify'));
});

ok('merge: se HEAD finisce sulla punta del branch è un fast-forward', async () => {
  const g = fakeGit({ after: 'bbb222' });
  const r = await M.mergeBranch(opts(g));
  assert.strictEqual(r.fastForward, true);
});

ok('merge: un remoto si unisce col suo nome, se non c\'è un locale che si chiama uguale', async () => {
  const g = fakeGit({ refs: { 'refs/heads/main': 'aaa111', 'refs/remotes/origin/y': 'ddd444' } });
  assert.strictEqual((await M.mergeBranch(opts(g, { name: 'origin/y', kind: 'remote' }))).ok, true);
  assert.deepStrictEqual(g.merges()[0].args, ['merge', '--no-edit', 'origin/y']);
  const twin = fakeGit({ refs: { 'refs/heads/main': 'aaa111', 'refs/remotes/origin/y': 'ddd444', 'refs/heads/origin/y': 'eee555' } });
  const r = await M.mergeBranch(opts(twin, { name: 'origin/y', kind: 'remote' }));
  assert.match(r.error, /locale/);
  assert.deepStrictEqual(twin.merges(), []);
});

ok('merge: nome o tipo non validi non arrivano a git', async () => {
  for (const [name, kind] of [['-X theirs', 'local'], ['--abort', 'local'], ['a..b', 'local'], ['', 'local'], [42, 'local'], ['feat/x', 'tag']]) {
    const g = fakeGit();
    const r = await M.mergeBranch(opts(g, { name, kind }));
    assert.strictEqual(r.ok, false, `${name} ${kind}`);
    assert.deepStrictEqual(g.calls, [], `${name} ${kind}`);
  }
});

ok('merge: rifiutato prima di cominciare, ognuno col suo motivo', async () => {
  const cases = [
    [fakeGit({ refs: { 'refs/heads/main': 'aaa111' } }), {}, /non c'è/],
    [fakeGit(), { name: 'main' }, /già su main/],
    [fakeGit({ current: null }), {}, /staccato/],
    [fakeGit({ dirty: 'a.js\0' }), {}, /non committate/],
    [fakeGit({ ancestor: true }), {}, /già/],
    [fakeGit({ merging: true }), {}, /merge a metà/],
    [fakeGit(), { expect: 'vecchio' }, /cambiato/],
  ];
  for (const [g, extra, re] of cases) {
    const r = await M.mergeBranch(opts(g, extra));
    assert.strictEqual(r.ok, false, String(re));
    assert.match(r.error, re);
    assert.deepStrictEqual(g.merges(), [], String(re));
  }
  const rebasing = fakeGit();
  const r = await M.mergeBranch(opts(rebasing, { exists: (p) => p.endsWith('rebase-merge') }));
  assert.match(r.error, /rebase/);
});

ok('merge: ai conflitti si annulla subito e si elencano i file', async () => {
  let aborted = false;
  const g = fakeGit({
    merge: () => { throw fail(1, '', { stdout: 'CONFLICT (content): Merge conflict in a.js\n', leavesMerge: true }); },
    conflicts: 'a.js\0lib/b.js\0',
    abort: () => { aborted = true; },
  });
  const r = await M.mergeBranch(opts(g));
  assert.strictEqual(aborted, true);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict, true);
  assert.deepStrictEqual(r.files, ['a.js', 'lib/b.js']);
  assert.match(r.error, /annullato/);
  assert.match(r.error, /a\.js/);
});

ok('merge: se l\'annullamento non riesce lo dice, la cartella è a metà merge', async () => {
  const g = fakeGit({
    merge: () => { throw fail(1, 'conflitto', { leavesMerge: true }); },
    abort: () => { throw fail(128, 'fatal: boh'); },
  });
  const r = await M.mergeBranch(opts(g));
  assert.strictEqual(r.conflict, true);
  assert.match(r.error, /git merge --abort/);
});

ok('merge: rifiutato da git prima di cominciare (o tempo scaduto) → il messaggio, niente abort', async () => {
  const g = fakeGit({ merge: () => { throw fail(1, 'error: Your local changes would be overwritten by merge'); } });
  const r = await M.mergeBranch(opts(g));
  assert.match(r.error, /overwritten/);
  assert.ok(!g.calls.some((c) => c.args.includes('--abort')));
  const slow = fakeGit({ merge: () => { throw fail(null, '', { killed: true }); } });
  assert.match((await M.mergeBranch(opts(slow))).error, /60 s/);
});

ok('merge: fuori da un repository o senza cartella, nessun merge', async () => {
  const notRepo = async () => { throw fail(128, 'fatal: not a git repository (or any of the parent directories): .git'); };
  assert.deepStrictEqual(await M.mergeBranch({ cwd: '/tmp', name: 'x', kind: 'local', run: notRepo, exists: noBusy }), { ok: false, reason: 'not-a-repo' });
  assert.strictEqual((await M.mergeBranch({ cwd: '', name: 'x', kind: 'local', run: notRepo, exists: noBusy })).ok, false);
});
