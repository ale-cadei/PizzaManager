// Server SSH scritto a mano nella nuova sessione (docs/plans/96):
// `host`, `utente@host`, `utente@host:porta`.
const assert = require('node:assert');
const { test } = require('node:test');

const remote = require('../lib/remote-env');
const { sshArgs } = require('../lib/remote-channel');
const { recentSshTargets } = require('../lib/recent-dirs');

test('parseSshTarget: host, utente@host, utente@host:porta', () => {
  assert.deepStrictEqual(remote.parseSshTarget('nas'), { user: null, host: 'nas', port: null });
  assert.deepStrictEqual(remote.parseSshTarget('ale@10.0.0.5'), { user: 'ale', host: '10.0.0.5', port: null });
  assert.deepStrictEqual(remote.parseSshTarget('ale@srv.example.com:2222'), { user: 'ale', host: 'srv.example.com', port: 2222 });
  assert.deepStrictEqual(remote.parseSshTarget('srv:65535'), { user: null, host: 'srv', port: 65535 });
});

test('parseSshTarget: opzioni di ssh travestite, porte e forme sbagliate → null', () => {
  const bad = ['', ' nas', '-oProxyCommand=sh', 'ale@-oProxyCommand=sh', '-l@host', 'a@b@c', '@host', 'ale@',
    'host:', 'host:0', 'host:65536', 'host:22x', 'host:-1', 'a b', 'ale@host;id', '[::1]', 'host\n', 'ale@host:2:2'];
  for (const text of bad) assert.strictEqual(remote.parseSshTarget(text), null, JSON.stringify(text));
  assert.strictEqual(remote.parseSshTarget(undefined), null);
  assert.strictEqual(remote.parseSshTarget(42), null);
});

test('normalizeSshTarget: spazi intorno via, :22 via, il resto com\'è', () => {
  assert.strictEqual(remote.normalizeSshTarget('  ale@host:22 '), 'ale@host');
  assert.strictEqual(remote.normalizeSshTarget('ale@host:2222'), 'ale@host:2222');
  assert.strictEqual(remote.normalizeSshTarget('nas'), 'nas');
  assert.strictEqual(remote.normalizeSshTarget('ale@-x'), null);
  assert.strictEqual(remote.normalizeSshTarget(''), null);
});

test('sshDestArgs: porta con -p prima di --, destinazione dopo', () => {
  assert.deepStrictEqual(remote.sshDestArgs('nas'), ['--', 'nas']);
  assert.deepStrictEqual(remote.sshDestArgs('ale@host:2222'), ['-p', '2222', '--', 'ale@host']);
  assert.throws(() => remote.sshDestArgs('-oProxyCommand=sh'));
});

test('parseEnvKey: server scritti a mano validi, opzioni rifiutate; WSL resta un nome', () => {
  assert.deepStrictEqual(remote.parseEnvKey('ssh:ale@host:2222'), { kind: 'ssh', host: 'ale@host:2222' });
  assert.strictEqual(remote.envKey({ kind: 'ssh', host: 'ale@host:2222' }), 'ssh:ale@host:2222');
  assert.strictEqual(remote.parseEnvKey('ssh:ale@-oProxyCommand=sh'), null);
  assert.strictEqual(remote.parseEnvKey('ssh:ale@host:99999'), null);
  assert.strictEqual(remote.parseEnvKey('wsl:ale@host'), null);
});

test('wrapRemote e canale dell\'editor: la porta arriva a ssh', () => {
  const w = remote.wrapRemote({ env: { kind: 'ssh', host: 'ale@host:2222' }, cwd: '~', shell: true, sshBin: 'ssh' });
  assert.deepStrictEqual(w.args.slice(0, 5), ['-t', '-p', '2222', '--', 'ale@host']);
  assert.strictEqual(w.args.length, 6);
  const a = sshArgs('ale@host:2222');
  assert.deepStrictEqual(a.slice(0, 7), ['-T', '-o', 'BatchMode=yes', '-p', '2222', '--', 'ale@host']);
  assert.match(a[7], /^python3 -u -c '/);
});

test('recentSshTargets: server scritti a mano dalla cronologia, recenti prima, senza doppioni', () => {
  const history = [
    { env: 'ssh:ale@a:2222', cwd: '~' },
    { env: 'local', cwd: '/w' },
    { cwd: '/vecchia' },
    { env: 'ssh:nas', cwd: '~' },
    { env: 'ssh:ale@a:2222', cwd: '/srv' },
    { env: 'wsl:Debian', cwd: '~' },
    { env: 'ssh:-oProxyCommand=sh', cwd: '~' },
    { env: 'ssh:root@b', cwd: '~' },
    null,
  ];
  assert.deepStrictEqual(recentSshTargets(history, { exclude: ['nas'] }), ['ale@a:2222', 'root@b']);
  assert.deepStrictEqual(recentSshTargets(history, { exclude: [], limit: 1 }), ['ale@a:2222']);
  assert.deepStrictEqual(recentSshTargets(null), []);
});

test('ipc: list-remote-envs con i recenti scritti a mano, check-ssh-target dice la chiave o perché no', async () => {
  const { registerRemoteEnvHandlers } = require('../app/remote-envs');
  const handlers = {};
  registerRemoteEnvHandlers({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    hosts: { list: async () => ({ ssh: ['nas'], wsl: [] }) },
    history: { load: () => [{ env: 'ssh:nas' }, { env: 'ssh:ale@b:2222' }] },
  });
  assert.deepStrictEqual(await handlers['list-remote-envs']({}, {}), { ssh: ['nas'], wsl: [], recent: ['ale@b:2222'] });
  assert.deepStrictEqual(await handlers['check-ssh-target']({}, { text: ' ale@srv:22 ' }), { ok: true, env: 'ssh:ale@srv' });
  for (const text of ['', '-oProxyCommand=sh', 'ale@srv:0', null]) {
    const r = await handlers['check-ssh-target']({}, { text });
    assert.strictEqual(r.ok, false, String(text));
    assert.match(r.error, /utente@host/);
  }
});

test('ipc: cronologia illeggibile → niente recenti, gli host ci sono', async () => {
  const { registerRemoteEnvHandlers } = require('../app/remote-envs');
  const handlers = {};
  const orig = console.error;
  console.error = () => {};
  try {
    registerRemoteEnvHandlers({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
      hosts: { list: async () => ({ ssh: ['nas'], wsl: [] }) },
      history: { load: () => { throw new Error('rotto'); } },
    });
    assert.deepStrictEqual(await handlers['list-remote-envs']({}, {}), { ssh: ['nas'], wsl: [], recent: [] });
  } finally {
    console.error = orig;
  }
});
