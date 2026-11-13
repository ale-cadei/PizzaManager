// lib/remote-helper.py attraverso lib/remote-channel.js (docs/plans/94).
// Al posto di ssh, `sh -c <ultimo argomento>`: è quello che farebbe la shell
// di login del server, quindi si prova anche il quoting del bootstrap.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { createRemoteChannel, createRemoteChannels, sshArgs, startFailure, HELPER_FILE } = require('../lib/remote-channel');

function hasPython() {
  try { execFileSync('python3', ['-c', 'import sys; assert sys.version_info >= (3, 6)'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const PYTHON = process.platform !== 'win32' && hasPython();

function setup(t, env = {}) {
  if (!PYTHON) { t.skip('serve python3 (e sh)'); return null; }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-helper-')));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-helper-home-'));
  const fakeSpawn = (cmd, args, opts) => spawn('sh', ['-c', args[args.length - 1]], { ...opts, env: { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, 'data'), ...env } });
  const ch = createRemoteChannel({ host: 'nas', sshBin: 'ssh', spawn: fakeSpawn });
  t.after(() => ch.close());
  const req = (op, args = {}) => ch.request(op, { root, ...args });
  return { root, home, ch, req };
}

test('helper: solo ASCII (il bootstrap ne legge la lunghezza in byte)', () => {
  const src = fs.readFileSync(HELPER_FILE);
  assert.ok(src.every((b) => b < 128), 'remote-helper.py deve restare ASCII');
});

test('sshArgs: -T, BatchMode, host dopo --, il bootstrap quotato', () => {
  const a = sshArgs('nas');
  assert.deepStrictEqual(a.slice(0, 5), ['-T', '-o', 'BatchMode=yes', '--', 'nas']);
  assert.match(a[5], /^python3 -u -c '/);
});

test('startFailure: messaggi che dicono cosa fare', () => {
  assert.match(startFailure('nas: Permission denied (publickey,password).', 255), /chiave SSH/);
  assert.match(startFailure('sh: 1: python3: not found', 127), /python3/);
  assert.match(startFailure('ssh: Could not resolve hostname nas', 255), /non raggiungibile/);
});

test('helper: root espande ~ e risolve i symlink', async (t) => {
  const s = setup(t);
  if (!s) return;
  const r = await s.ch.request('root', { dir: '~' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.path, fs.realpathSync(s.home));
  const missing = await s.ch.request('root', { dir: '/non/esiste' });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.code, 'ENOENT');
});

test('helper: list, create, mkdir, rename, read, write con conflitto', async (t) => {
  const s = setup(t);
  if (!s) return;
  assert.strictEqual((await s.req('mkdir', { rel: 'src' })).ok, true);
  assert.strictEqual((await s.req('create', { rel: 'src/a.txt' })).ok, true);
  assert.strictEqual((await s.req('create', { rel: 'src/a.txt' })).code, 'EEXIST');
  fs.mkdirSync(path.join(s.root, '.git'));

  const list = await s.req('list', { rel: '' });
  assert.deepStrictEqual(list.entries.map((e) => [e.name, e.kind]), [['src', 'dir']], '.git nascosta');

  const first = await s.req('read', { rel: 'src/a.txt' });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(Buffer.from(first.data, 'base64').length, 0);

  const data = Buffer.from('ciao è\n').toString('base64');
  const w = await s.req('write', { rel: 'src/a.txt', data, expectedMtime: first.mtime });
  assert.strictEqual(w.ok, true, w.error);
  assert.strictEqual(fs.readFileSync(path.join(s.root, 'src/a.txt'), 'utf8'), 'ciao è\n');
  const stale = await s.req('write', { rel: 'src/a.txt', data, expectedMtime: first.mtime - 1000 });
  assert.deepStrictEqual([stale.ok, stale.conflict, stale.mtime], [false, true, w.mtime]);
  const fresh = await s.req('write', { rel: 'src/nuovo.txt', data, expectedMtime: null });
  assert.strictEqual(fresh.ok, true);

  const r = await s.req('rename', { rel: 'src/a.txt', name: 'b.txt' });
  assert.deepStrictEqual([r.ok, r.rel], [true, 'src/b.txt']);
  assert.strictEqual((await s.req('rename', { rel: 'src/b.txt', name: 'nuovo.txt' })).code, 'EEXIST');
  assert.strictEqual((await s.req('rename', { rel: 'src/b.txt', name: '../x' })).code, 'EINVALNAME');

  const st = await s.req('stat_many', { rels: ['src/b.txt', 'manca', '../fuori'] });
  assert.strictEqual(typeof st.mtimes['src/b.txt'], 'number');
  assert.strictEqual(st.mtimes.manca, null);
  assert.strictEqual(st.mtimes['../fuori'], null);
});

test('helper: scrittura mantiene il mode e rifiuta i file in sola lettura', async (t) => {
  const s = setup(t);
  if (!s) return;
  const p = path.join(s.root, '.env');
  fs.writeFileSync(p, 'x');
  fs.chmodSync(p, 0o600);
  const before = await s.req('stat', { rel: '.env' });
  assert.strictEqual((await s.req('write', { rel: '.env', data: 'eQ==', expectedMtime: before.mtime })).ok, true);
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600);
  fs.chmodSync(p, 0o400);
  const ro = await s.req('stat', { rel: '.env' });
  if (process.getuid && process.getuid() === 0) return; // root scrive comunque
  assert.strictEqual((await s.req('write', { rel: '.env', data: 'eg==', expectedMtime: ro.mtime })).code, 'EACCES');
});

test('helper: niente fuori dalla radice, nemmeno via symlink', async (t) => {
  const s = setup(t);
  if (!s) return;
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-fuori-'));
  fs.writeFileSync(path.join(outside, 'segreto'), 'no');
  fs.symlinkSync(outside, path.join(s.root, 'link'));
  for (const [op, args] of [['read', { rel: '../x' }], ['read', { rel: '/etc/passwd' }], ['read', { rel: 'link/segreto' }],
    ['list', { rel: 'link' }], ['create', { rel: 'link/nuovo' }], ['write', { rel: 'link/segreto', data: '', expectedMtime: null }]]) {
    const r = await s.req(op, args);
    assert.strictEqual(r.code, 'EOUTSIDE', `${op} ${args.rel}`);
  }
  assert.strictEqual(fs.readFileSync(path.join(outside, 'segreto'), 'utf8'), 'no');
});

test('helper: cestino freedesktop, mai unlink', async (t) => {
  const s = setup(t);
  if (!s) return;
  fs.writeFileSync(path.join(s.root, 'via.txt'), '1');
  assert.strictEqual((await s.req('trash', { rel: 'via.txt' })).ok, true);
  fs.writeFileSync(path.join(s.root, 'via.txt'), '2');
  assert.strictEqual((await s.req('trash', { rel: 'via.txt' })).ok, true);
  const trash = path.join(s.home, 'data', 'Trash');
  assert.deepStrictEqual(fs.readdirSync(path.join(trash, 'files')).sort(), ['via.txt', 'via.txt.2']);
  assert.match(fs.readFileSync(path.join(trash, 'info', 'via.txt.trashinfo'), 'utf8'), /^\[Trash Info\]\nPath=\/.*via\.txt\nDeletionDate=/);
  assert.strictEqual((await s.req('trash', { rel: '' })).code, 'EOUTSIDE', 'la radice non si butta');
});

test('helper: git con argomenti fissi, comandi e opzioni pericolose rifiutati', async (t) => {
  const s = setup(t);
  if (!s) return;
  try { execFileSync('git', ['init', '-q', s.root]); } catch { t.skip('git assente'); return; }
  fs.writeFileSync(path.join(s.root, 'a.js'), 'const x = 1;\n');
  const ls = await s.req('git', { cwd: s.root, args: ['ls-files', '--others', '-z'] });
  assert.deepStrictEqual([ls.status, ls.stdout], [0, 'a.js\0']);
  const blob = await s.req('git', { cwd: s.root, args: ['ls-files', '--others'], buffer: true });
  assert.strictEqual(Buffer.from(blob.stdout, 'base64').toString(), 'a.js\n');
  const ign = await s.req('git', { cwd: s.root, args: ['check-ignore', '-q', '--', 'a.js'] });
  assert.strictEqual(ign.status, 1);

  for (const args of [['config', 'core.pager', 'x'], ['grep', '-Ovim', '-e', 'x'], ['grep', '--open-files-in-pager=sh', 'x'],
    ['status', '--output=/tmp/x'], ['grep', '-c', 'x']]) {
    const r = await s.req('git', { cwd: s.root, args });
    assert.strictEqual(r.code, 'EINVAL', args.join(' '));
  }
  // dopo -e o -- è un pattern, non un'opzione
  const grep = await s.req('git', { cwd: s.root, args: ['grep', '-n', '--untracked', '-e', '-c', '--', '.'] });
  assert.strictEqual(grep.status, 1, grep.stderr);
  assert.strictEqual((await s.req('git', { cwd: '/', args: ['status'] })).code, 'EOUTSIDE');
});

test('helper: walk salta .git e node_modules', async (t) => {
  const s = setup(t);
  if (!s) return;
  for (const f of ['a', 'd/b', 'node_modules/x', '.git/y']) {
    fs.mkdirSync(path.dirname(path.join(s.root, f)), { recursive: true });
    fs.writeFileSync(path.join(s.root, f), '');
  }
  const r = await s.req('walk', { max: 10 });
  assert.deepStrictEqual(r.files.sort(), ['a', 'd/b']);
  assert.strictEqual((await s.req('walk', { max: 1 })).truncated, true);
});

test('helper: operazione sconosciuta o riga rotta non chiudono il canale', async (t) => {
  const s = setup(t);
  if (!s) return;
  assert.strictEqual((await s.ch.request('rm_rf', {})).code, 'EINVAL');
  assert.strictEqual((await s.req('stat', { rel: '' })).exists, true);
});

test('canale: richieste concorrenti tornano ognuna alla sua', async (t) => {
  const s = setup(t);
  if (!s) return;
  for (const n of ['a', 'b', 'c']) fs.writeFileSync(path.join(s.root, n), n.repeat(3));
  const rs = await Promise.all(['a', 'b', 'c'].map((rel) => s.req('read', { rel })));
  assert.deepStrictEqual(rs.map((r) => Buffer.from(r.data, 'base64').toString()), ['aaa', 'bbb', 'ccc']);
});

test('canale: server che si chiude → errore tradotto, poi si riapre', async (t) => {
  if (!PYTHON) { t.skip('serve sh'); return; }
  let calls = 0;
  const fakeSpawn = (cmd, args, opts) => {
    calls += 1;
    return calls === 1
      ? spawn('sh', ['-c', 'echo "nas: Permission denied (publickey)." >&2; exit 255'], opts)
      : spawn('sh', ['-c', args[args.length - 1]], opts);
  };
  const ch = createRemoteChannel({ host: 'nas', sshBin: 'ssh', spawn: fakeSpawn });
  t.after(() => ch.close());
  await assert.rejects(ch.request('root', { dir: '/' }), (e) => e.code === 'ECHANNEL' && /chiave SSH/.test(e.message));
  const r = await ch.request('root', { dir: '/' });
  assert.deepStrictEqual([r.ok, r.path], [true, '/']);
});

test('canale: client assente → errore, niente eccezione non gestita', async () => {
  const ch = createRemoteChannel({ host: 'nas', sshBin: '/non/esiste/ssh' });
  await assert.rejects(ch.request('root', { dir: '/' }), /non trovato/);
});

test('canale: processo che muore a metà richiesta → la richiesta fallisce', async (t) => {
  if (!PYTHON) { t.skip('serve sh'); return; }
  // risponde ready e poi muore senza rispondere
  const fakeSpawn = (cmd, args, opts) => spawn('sh', ['-c', 'head -c 1 >/dev/null; echo \'{"ready": true}\'; sleep 0.2; echo boom >&2; exit 3'], opts);
  const ch = createRemoteChannel({ host: 'nas', sshBin: 'ssh', spawn: fakeSpawn });
  t.after(() => ch.close());
  await assert.rejects(ch.request('stat', {}), (e) => e.code === 'ECHANNEL' && /boom/.test(e.message));
  assert.strictEqual(ch.connected, false);
});

test('canale: richiesta senza risposta → timeout, il canale resta', async (t) => {
  if (!PYTHON) { t.skip('serve sh'); return; }
  const fakeSpawn = (cmd, args, opts) => spawn('sh', ['-c', 'echo \'{"ready": true}\'; cat >/dev/null'], opts);
  const ch = createRemoteChannel({ host: 'nas', sshBin: 'ssh', spawn: fakeSpawn, requestTimeoutMs: 100 });
  t.after(() => ch.close());
  await assert.rejects(ch.request('stat', {}), /in tempo/);
  assert.strictEqual(ch.connected, true);
});

test('canali: uno per host, solo ssh, ssh assente spiegato', () => {
  const made = [];
  const create = (o) => { const c = { o, close: () => { c.closed = true; } }; made.push(c); return c; };
  const chs = createRemoteChannels({ resolveClient: () => ({ path: '/usr/bin/ssh' }), create });
  assert.strictEqual(chs.get('ssh:nas'), chs.get('ssh:nas'));
  assert.notStrictEqual(chs.get('ssh:nas'), chs.get('ssh:pi'));
  assert.deepStrictEqual(made.map((c) => [c.o.host, c.o.sshBin]), [['nas', '/usr/bin/ssh'], ['pi', '/usr/bin/ssh']]);
  assert.throws(() => chs.get('wsl:Ubuntu'), /non valido/);
  assert.throws(() => chs.get('local'), /non valido/);
  made[0].o.onClose();
  assert.notStrictEqual(chs.get('ssh:nas'), made[0], 'dopo la chiusura se ne apre uno nuovo');
  chs.closeAll();
  assert.ok(made.slice(1).every((c) => c.closed), 'chiude quelli ancora aperti');
  const none = createRemoteChannels({ resolveClient: () => ({ path: null }), create });
  assert.throws(() => none.get('ssh:nas'), /non trovato/);
});
