const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Branch e worktree della barra del pannello (docs/plans/89): lib/git-head.js
   con un finto `git`, per vedere cosa gli si chiede e cosa ne esce. */
const { readHead } = require('../lib/git-head');

const gitError = (stderr) => Object.assign(new Error('Command failed: git'), { stderr });

/* `branch` null = HEAD staccato; `commit` null = nessun commit ancora */
function fakeRepo({
  root = '/repo', branch = 'feat/x', commit = 'abc1234', gitDir = '/repo/.git', commonDir = '/repo/.git', refs = '',
} = {}) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, opts });
    const [cmd] = args;
    if (cmd === 'rev-parse' && args[1] === '--show-toplevel') return `${root}\n`;
    if (cmd === 'rev-parse' && args.includes('--git-common-dir')) return `${gitDir}\n${commonDir}\n`;
    if (cmd === 'rev-parse') { if (commit) return `${commit}\n`; throw gitError(''); }
    if (cmd === 'symbolic-ref') { if (branch) return `${branch}\n`; throw gitError(''); }
    if (cmd === 'for-each-ref') return refs;
    throw new Error(`git ${args.join(' ')} non previsto`);
  };
  return { run, calls };
}

const row = (...fields) => `${fields.join('\x1f')}\n`;

ok('testa: branch con upstream e commit da pushare', async () => {
  const repo = fakeRepo({ refs: row('refs/heads/feat/x', 'origin/feat/x', '[ahead 2, behind 1]') });
  const r = await readHead({ cwd: '/repo/sub', run: repo.run, platform: 'linux' });
  assert.deepStrictEqual(r, {
    ok: true, root: '/repo', branch: 'feat/x', detached: null, unborn: false,
    upstream: 'origin/feat/x', ahead: 2, behind: 1, gone: false, worktree: null,
  });
  // si chiede a git nella radice, e solo il branch corrente
  const each = repo.calls.find((c) => c.args[0] === 'for-each-ref');
  assert.strictEqual(each.args[each.args.length - 1], 'refs/heads/feat/x');
  assert.ok(repo.calls.every((c) => c.args[1] === '--show-toplevel' || c.opts.cwd === '/repo'));
});

ok('testa: for-each-ref confronta per prefisso, conta solo la riga col nome esatto', async () => {
  const repo = fakeRepo({ branch: 'feat', refs: row('refs/heads/feat/x', 'origin/feat/x', '[ahead 5]') });
  const r = await readHead({ cwd: '/repo', run: repo.run, platform: 'linux' });
  assert.strictEqual(r.upstream, null);
  assert.strictEqual(r.ahead, 0);
});

ok('testa: senza upstream, upstream sparito', async () => {
  const none = await readHead({ cwd: '/repo', run: fakeRepo({ refs: row('refs/heads/feat/x', '', '') }).run, platform: 'linux' });
  assert.strictEqual(none.upstream, null);
  const gone = await readHead({ cwd: '/repo', run: fakeRepo({ refs: row('refs/heads/feat/x', 'origin/feat/x', '[gone]') }).run, platform: 'linux' });
  assert.strictEqual(gone.gone, true);
});

ok('testa: HEAD staccato dice il commit, senza commit è «unborn»', async () => {
  const detached = await readHead({ cwd: '/repo', run: fakeRepo({ branch: null }).run, platform: 'linux' });
  assert.strictEqual(detached.branch, null);
  assert.strictEqual(detached.detached, 'abc1234');
  assert.strictEqual(detached.upstream, null);
  const unborn = await readHead({ cwd: '/repo', run: fakeRepo({ commit: null }).run, platform: 'linux' });
  assert.strictEqual(unborn.branch, 'feat/x');
  assert.strictEqual(unborn.unborn, true);
});

ok('testa: in un worktree collegato dice il nome della cartella', async () => {
  const repo = fakeRepo({ root: '/wt/feature-x', gitDir: '/repo/.git/worktrees/feature-x', commonDir: '/repo/.git' });
  const r = await readHead({ cwd: '/wt/feature-x', run: repo.run, platform: 'linux' });
  assert.strictEqual(r.worktree, 'feature-x');
});

ok('testa: su Windows git-dir e common-dir si confrontano senza maiuscole e con \\', async () => {
  const repo = fakeRepo({ root: 'C:\\repo', gitDir: 'C:/Repo/.git', commonDir: 'c:\\repo\\.git\\' });
  const r = await readHead({ cwd: 'C:\\repo', run: repo.run, platform: 'win32' });
  assert.strictEqual(r.worktree, null);
});

ok('testa: fuori da un repository lo dice', async () => {
  const run = async () => { throw gitError('fatal: not a git repository (or any of the parent directories): .git'); };
  const r = await readHead({ cwd: '/tmp', run, platform: 'linux' });
  assert.deepStrictEqual(r, { ok: false, reason: 'not-a-repo' });
  assert.strictEqual((await readHead({ run, platform: 'linux' })).ok, false);
});
