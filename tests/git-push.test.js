const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Push di un branch dal selettore (docs/plans/55): lib/git-push.js con un
   finto `git`, per vedere cosa gli si chiede e cosa arriva all'utente. */
const { pushBranch, PUSH_TIMEOUT_MS } = require('../lib/git-push');

const gitError = (stderr, extra = {}) => Object.assign(new Error('Command failed: git'), { stderr, ...extra });

/* Un repository finto: `config` è la configurazione dei branch, `remotes`
   l'elenco di `git remote`, `push` cosa fa il push (default: va) */
function fakeRepo({ config = {}, remotes = ['origin'], branches = ['feat/x', 'main'], push = () => '' } = {}) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, opts });
    const [cmd] = args;
    if (cmd === 'rev-parse' && args[1] === '--show-toplevel') return '/repo\n';
    if (cmd === 'rev-parse') {
      const ref = args[args.length - 1].replace(/\^\{commit\}$/, '');
      if (branches.some((b) => ref === `refs/heads/${b}`)) return 'abc123\n';
      throw gitError('');
    }
    if (cmd === 'config') {
      const key = args[args.length - 1];
      if (Object.prototype.hasOwnProperty.call(config, key)) return `${config[key]}\n`;
      throw gitError('');
    }
    if (cmd === 'remote') return remotes.map((r) => `${r}\n`).join('');
    if (cmd === 'push') return push(args, opts);
    throw new Error(`git ${args.join(' ')} non previsto`);
  };
  const pushes = () => calls.filter((c) => c.args[0] === 'push');
  return { run, calls, pushes };
}

const TRACKING = { 'branch.feat/x.remote': 'origin', 'branch.feat/x.merge': 'refs/heads/feat/x' };

ok('push: senza upstream pubblica su origin e imposta l\'upstream (-u)', async () => {
  const repo = fakeRepo({ remotes: ['backup', 'origin'] });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.deepStrictEqual(r, { ok: true, branch: 'feat/x', remote: 'origin', upstream: 'origin/feat/x', created: true });
  assert.deepStrictEqual(repo.pushes().map((c) => c.args), [['push', '-u', 'origin', 'refs/heads/feat/x:refs/heads/feat/x']]);
  assert.strictEqual(repo.pushes()[0].opts.timeout, PUSH_TIMEOUT_MS);
  assert.strictEqual(repo.pushes()[0].opts.cwd, '/repo');
});

ok('push: senza upstream e senza origin usa l\'unico remoto', async () => {
  const repo = fakeRepo({ remotes: ['gitlab'] });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.strictEqual(r.remote, 'gitlab');
  assert.deepStrictEqual(repo.pushes()[0].args, ['push', '-u', 'gitlab', 'refs/heads/feat/x:refs/heads/feat/x']);
});

ok('push: con l\'upstream pusha esattamente lì, senza -u', async () => {
  const config = { 'branch.feat/x.remote': 'backup', 'branch.feat/x.merge': 'refs/heads/altro-nome' };
  const repo = fakeRepo({ config, remotes: ['origin', 'backup'] });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.deepStrictEqual(r, { ok: true, branch: 'feat/x', remote: 'backup', upstream: 'backup/altro-nome', created: false });
  assert.deepStrictEqual(repo.pushes()[0].args, ['push', 'backup', 'refs/heads/feat/x:refs/heads/altro-nome']);
});

ok('push: mai forzato, mai senza hook', async () => {
  for (const config of [{}, TRACKING]) {
    const repo = fakeRepo({ config });
    await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
    for (const { args } of repo.calls) {
      for (const flag of ['--force', '-f', '--force-with-lease', '--no-verify', '--mirror', '--all', '--delete', '-d']) {
        assert.ok(!args.includes(flag), `${flag} in git ${args.join(' ')}`);
      }
      assert.ok(!args.some((a) => a.startsWith('+')), 'un refspec con + è un push forzato');
    }
  }
});

ok('push: niente remoti, o più remoti senza origin, si rifiuta senza pushare', async () => {
  const none = fakeRepo({ remotes: [] });
  const r1 = await pushBranch({ cwd: '/repo', name: 'feat/x', run: none.run });
  assert.strictEqual(r1.ok, false);
  assert.match(r1.error, /remot/);
  const many = fakeRepo({ remotes: ['a', 'b'] });
  const r2 = await pushBranch({ cwd: '/repo', name: 'feat/x', run: many.run });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.error, /a, b/);
  assert.match(r2.error, /terminale/);
  assert.strictEqual(none.pushes().length + many.pushes().length, 0);
});

ok('push: un upstream che è un branch locale non ha niente da pubblicare', async () => {
  const repo = fakeRepo({ config: { 'branch.feat/x.remote': '.', 'branch.feat/x.merge': 'refs/heads/main' } });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /main/);
  assert.strictEqual(repo.pushes().length, 0);
});

ok('push: un remoto che git leggerebbe come opzione non arriva a git', async () => {
  const fromConfig = fakeRepo({ config: { 'branch.feat/x.remote': '--mirror', 'branch.feat/x.merge': 'refs/heads/feat/x' } });
  assert.strictEqual((await pushBranch({ cwd: '/repo', name: 'feat/x', run: fromConfig.run })).ok, false);
  const fromList = fakeRepo({ remotes: ['-x'] });
  assert.strictEqual((await pushBranch({ cwd: '/repo', name: 'feat/x', run: fromList.run })).ok, false);
  assert.strictEqual(fromConfig.pushes().length + fromList.pushes().length, 0);
});

ok('push: un upstream configurato a metà non si pubblica altrove', async () => {
  for (const config of [{ 'branch.feat/x.remote': 'backup' }, { 'branch.feat/x.merge': 'refs/heads/feat/x' }]) {
    const repo = fakeRepo({ config, remotes: ['origin', 'backup'] });
    const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
    assert.strictEqual(r.ok, false, JSON.stringify(config));
    assert.match(r.error, /a metà/);
    assert.strictEqual(repo.pushes().length, 0);
  }
});

ok('push: un upstream che non è un branch (merge strano) si rifiuta', async () => {
  const repo = fakeRepo({ config: { 'branch.feat/x.remote': 'origin', 'branch.feat/x.merge': 'refs/tags/v1' } });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(repo.pushes().length, 0);
});

ok('push: nomi non validi o branch che non c\'è, senza lanciare git push', async () => {
  const repo = fakeRepo();
  for (const name of ['-f', '--all', '', 'a b', undefined, 'non/esiste']) {
    const r = await pushBranch({ cwd: '/repo', name, run: repo.run });
    assert.strictEqual(r.ok, false, String(name));
  }
  assert.strictEqual(repo.pushes().length, 0);
  assert.strictEqual((await pushBranch({ cwd: '', name: 'feat/x', run: repo.run })).ok, false);
});

ok('push: fuori da un repository lo dice come gli altri comandi', async () => {
  const run = async () => { throw gitError('fatal: not a git repository (or any of the parent directories): .git'); };
  assert.deepStrictEqual(await pushBranch({ cwd: '/tmp', name: 'feat/x', run }), { ok: false, reason: 'not-a-repo' });
});

ok('push: rifiutato perché il remoto è più avanti, il motivo di git e cosa fare', async () => {
  const stderr = 'To ../r.git\n ! [rejected]        feat/x -> feat/x (fetch first)\nerror: failed to push some refs to \'../r.git\'\nhint: Updates were rejected because the remote contains work that you do\nhint: not have locally.\n';
  const repo = fakeRepo({ config: TRACKING, push: () => { throw gitError(stderr); } });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.rejected, true);
  assert.match(r.error, /\[rejected\]/);
  assert.match(r.error, /pull o rebase/);
  assert.ok(!r.error.includes('hint:'), 'i suggerimenti di git li sostituisce il nostro');
  assert.strictEqual(repo.pushes().length, 1, 'non si riprova in nessun altro modo');
});

ok('push: senza credenziali utilizzabili spiega di fare un push dal terminale', async () => {
  const messages = [
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    'remote: Invalid username or password.\nfatal: Authentication failed for \'https://github.com/a/b.git/\'',
  ];
  for (const stderr of messages) {
    const repo = fakeRepo({ push: () => { throw gitError(stderr); } });
    const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /dal terminale/, stderr);
    assert.ok(r.error.includes(stderr.split('\n')[0]), 'il messaggio di git resta');
  }
});

ok('push: tempo scaduto, git interrotto e l\'errore lo dice', async () => {
  const repo = fakeRepo({ push: () => { throw gitError('', { killed: true }); } });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, new RegExp(`${PUSH_TIMEOUT_MS / 1000} s`));
});

ok('push: un hook pre-push che rifiuta, il suo messaggio arriva all\'utente', async () => {
  const repo = fakeRepo({ push: () => { throw gitError('pre-push: i test non passano\nerror: failed to push some refs\n'); } });
  const r = await pushBranch({ cwd: '/repo', name: 'feat/x', run: repo.run });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /i test non passano/);
  assert.ok(!r.rejected);
});
