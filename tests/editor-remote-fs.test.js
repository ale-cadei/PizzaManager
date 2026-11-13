// lib/editor-remote-fs.js sopra il canale vero e l'helper col python locale
// (docs/plans/94): stesse forme di risposta di lib/editor-fs.js, e i moduli
// git dell'editor che girano col `run` remoto.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { createRemoteChannel } = require('../lib/remote-channel');
const { createEditorRemoteFs } = require('../lib/editor-remote-fs');
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorGit } = require('../lib/editor-git');
const { listAllFiles, gitStatusLetters } = require('../lib/editor-index');
const { createEditorDefinition } = require('../lib/editor-definition');

function has(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; }
}
const PYTHON = process.platform !== 'win32' && has('python3', ['-c', 'import sys; assert sys.version_info >= (3, 6)']);
const GIT = has('git', ['--version']);

function setup(t) {
  if (!PYTHON) { t.skip('serve python3 (e sh)'); return null; }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-rfs-')));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-rfs-home-'));
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, 'data'), GIT_CEILING_DIRECTORIES: path.dirname(root) };
  const fakeSpawn = (cmd, args, opts) => spawn('sh', ['-c', args[args.length - 1]], { ...opts, env });
  const channel = createRemoteChannel({ host: 'nas', sshBin: 'ssh', spawn: fakeSpawn });
  t.after(() => channel.close());
  return { root, home, channel, rfs: createEditorRemoteFs({ channel, dir: root }) };
}

test('remote-fs: stesse risposte di editor-fs su lettura, scrittura, albero', async (t) => {
  const s = setup(t);
  if (!s) return;
  const local = createEditorFs({ root: s.root, platform: 'linux' });
  fs.mkdirSync(path.join(s.root, 'b'));
  fs.writeFileSync(path.join(s.root, 'a10.txt'), '﻿ciao\n');
  fs.writeFileSync(path.join(s.root, 'a2.txt'), 'x');
  fs.writeFileSync(path.join(s.root, 'bin'), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(s.root, 'latin'), Buffer.from([0xe8]));

  assert.strictEqual(await s.rfs.realRoot(), s.root);
  assert.deepStrictEqual(await s.rfs.list(''), await local.list(''));
  for (const rel of ['a10.txt', 'bin', 'latin', 'b', 'manca', '../x']) {
    assert.deepStrictEqual(await s.rfs.read(rel), await local.read(rel), rel);
  }
  const first = await s.rfs.read('a10.txt');
  const w = await s.rfs.write('a10.txt', 'nuovo è', { expectedMtime: first.mtime, bom: true });
  assert.strictEqual(w.ok, true);
  assert.deepStrictEqual(fs.readFileSync(path.join(s.root, 'a10.txt')), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('nuovo è')]));
  assert.deepStrictEqual(await s.rfs.write('a10.txt', 'y', { expectedMtime: first.mtime }), { ok: false, conflict: true, mtime: w.mtime });
  assert.deepStrictEqual(await s.rfs.stat('a10.txt'), await local.stat('a10.txt'));
  assert.deepStrictEqual(await s.rfs.write('../x', 'y'), { ok: false, error: 'Il percorso esce dalla cartella della sessione.' });
});

test('remote-fs: crea, rinomina, cestina con i messaggi di editor-fs', async (t) => {
  const s = setup(t);
  if (!s) return;
  assert.deepStrictEqual(await s.rfs.mkdir('d'), { ok: true });
  assert.deepStrictEqual(await s.rfs.create('d/a.txt'), { ok: true });
  assert.deepStrictEqual(await s.rfs.create('d/a.txt'), { ok: false, error: 'Esiste già un file o una cartella con quel nome.' });
  assert.deepStrictEqual(await s.rfs.rename('d/a.txt', 'b.txt'), { ok: true, rel: 'd/b.txt' });
  assert.deepStrictEqual(await s.rfs.rename('d/b.txt', 'x/y'), { ok: false, error: 'Nome non valido.' });
  assert.deepStrictEqual(await s.rfs.trash('d/b.txt'), { ok: true });
  assert.ok(!fs.existsSync(path.join(s.root, 'd/b.txt')));
  assert.ok(fs.existsSync(path.join(s.home, 'data/Trash/files/b.txt')));
  const st = await s.rfs.statMany(['d', 'd/b.txt', '../fuori']);
  assert.deepStrictEqual(Object.keys(st.mtimes).sort(), ['d', 'd/b.txt']);
  assert.strictEqual(st.mtimes['d/b.txt'], null);
});

test('remote-fs: cartella che non c\'è o canale caduto → errore leggibile', async (t) => {
  const s = setup(t);
  if (!s) return;
  const missing = createEditorRemoteFs({ channel: s.channel, dir: '/non/esiste/proprio' });
  assert.deepStrictEqual(await missing.list(''), { ok: false, error: 'Non esiste più.' });
  const dead = createEditorRemoteFs({ channel: { request: async () => { throw Object.assign(new Error('Server non raggiungibile: x'), { code: 'ECHANNEL' }); } }, dir: '/srv' });
  assert.deepStrictEqual(await dead.read('a'), { ok: false, reason: 'error', error: 'Server non raggiungibile: x' });
  assert.deepStrictEqual(await dead.list(''), { ok: false, error: 'Server non raggiungibile: x' });
});

test('remote-fs: editor-git, editor-index ed editor-definition col run remoto', async (t) => {
  const s = setup(t);
  if (!s) return;
  if (!GIT) { t.skip('git assente'); return; }
  const g = (...a) => execFileSync('git', ['-C', s.root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  g('init', '-q');
  fs.mkdirSync(path.join(s.root, 'src'));
  fs.writeFileSync(path.join(s.root, 'src/a.js'), 'function pizza() {}\n');
  g('add', '.');
  g('commit', '-q', '-m', 'uno');
  fs.writeFileSync(path.join(s.root, 'src/a.js'), 'function pizza() {}\nconst b = pizza();\n');
  fs.writeFileSync(path.join(s.root, 'nuovo.txt'), '');

  const realRoot = await s.rfs.realRoot();
  const git = createEditorGit({ root: realRoot, resolve: s.rfs.resolveInside, run: s.rfs.run });
  assert.deepStrictEqual(await git.headText('src/a.js'), { ok: true, text: 'function pizza() {}\n' });
  assert.deepStrictEqual(await git.headText('nuovo.txt'), { ok: true, text: null });
  assert.strictEqual((await git.headText('../x')).reason, 'outside');
  const blame = await git.blameLine('src/a.js', 1, 'function pizza() {}\n');
  assert.strictEqual(blame.ok, true);
  assert.strictEqual(blame.blame.summary, 'uno');

  const all = await listAllFiles({ root: realRoot, realRoot, run: s.rfs.run, walkFiles: s.rfs.walkFiles });
  assert.deepStrictEqual(all.files.sort(), ['nuovo.txt', 'src/a.js']);
  assert.deepStrictEqual(await gitStatusLetters({ root: realRoot, realRoot, run: s.rfs.run }), { ok: true, status: { 'nuovo.txt': 'U', 'src/a.js': 'M' } });

  const def = await createEditorDefinition({ root: realRoot, realRoot, run: s.rfs.run }).find({ word: 'pizza' });
  assert.deepStrictEqual(def.results.map((r) => [r.rel, r.line]), [['src/a.js', 1]]);
});

test('remote-fs: fuori da git Ctrl+P legge la cartella sul server', async (t) => {
  const s = setup(t);
  if (!s) return;
  fs.writeFileSync(path.join(s.root, 'a'), '');
  const realRoot = await s.rfs.realRoot();
  const all = await listAllFiles({ root: realRoot, realRoot, run: s.rfs.run, walkFiles: s.rfs.walkFiles });
  assert.deepStrictEqual(all, { ok: true, files: ['a'], truncated: false });
  assert.deepStrictEqual(await gitStatusLetters({ root: realRoot, realRoot, run: s.rfs.run }), { ok: true, status: {} });
});
