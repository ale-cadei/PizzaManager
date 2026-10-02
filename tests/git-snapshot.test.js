const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* «Ultimo giro» del pannello delle modifiche (docs/plans/32, decisione 7):
   la fotografia dei file è un tree git fatto con un indice dell'app. Qui
   cosa si chiede a git, senza git; il caso vero sta in integration.test.js. */
const { snapshotTree, isTreeId, MAX_NEW_FILE_BYTES, MAX_NEW_FILES } = require('../lib/git-snapshot');

const TREE = 'a'.repeat(40);

function setup(files = {}, answers = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-snaptest-'));
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-snaptmp-'));
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), content);
  fs.mkdirSync(path.join(dir, '.git'));
  if (answers.noIndex !== true) fs.writeFileSync(path.join(dir, '.git', 'index'), 'INDICE VERO');
  const calls = [];
  const run = async (args, opts) => {
    const index = opts.env && fs.existsSync(opts.env.GIT_INDEX_FILE) ? fs.readFileSync(opts.env.GIT_INDEX_FILE, 'utf8') : null;
    calls.push({ args, env: opts.env || null, index });
    if (answers.fail && args.includes(answers.fail.on)) { const e = answers.fail; answers.fail = e.once ? null : e; throw Object.assign(new Error(e.stderr), { stderr: e.stderr }); }
    if (args.includes('--show-toplevel')) return `${dir}\n`;
    if (args.includes('--git-path')) return '.git/index\n';
    if (args.includes('ls-files')) return typeof answers.untracked === 'function' ? answers.untracked() : answers.untracked || '';
    if (args.includes('write-tree')) return answers.tree === undefined ? `${TREE}\n` : answers.tree;
    if (args.includes('add') && opts.env) fs.writeFileSync(opts.env.GIT_INDEX_FILE, 'INDICE DELL\'APP');
    return '';
  };
  return { dir, tmpdir, run, calls, cleanup: () => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmpdir, { recursive: true, force: true }); } };
}

const verbs = (calls) => calls.filter((c) => c.env).map((c) => c.args.filter((a) => !a.startsWith('-')).join(' '));

ok('fotografia: indice dell\'app copiato da quello vero, poi add, update-index e write-tree', async (t) => {
  const { dir, tmpdir, run, calls, cleanup } = setup({ 'nuovo.txt': 'x' }, { untracked: 'nuovo.txt\0' });
  t.after(cleanup);
  const r = await snapshotTree({ cwd: dir, run, tmpdir, now: () => 42 });
  assert.deepStrictEqual(r, { ok: true, root: dir, tree: TREE, at: 42, partial: false });
  assert.deepStrictEqual(verbs(calls), ['add', 'ls-files', 'update-index nuovo.txt', 'write-tree']);
  assert.strictEqual(calls.find((c) => c.env).index, 'INDICE VERO', 'l\'indice dell\'app non parte da quello vero');
  const env = calls.find((c) => c.env).env;
  assert.ok(env.GIT_INDEX_FILE.startsWith(tmpdir), 'l\'indice dell\'app sta dentro il repository');
  assert.deepStrictEqual([env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_COUNT], ['core.hooksPath', '1'], 'gli hook dell\'utente partono');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.git', 'index'), 'utf8'), 'INDICE VERO');
  const add = calls.find((c) => c.args.includes('update-index')).args;
  assert.deepStrictEqual(add.slice(0, 4), ['update-index', '--add', '--remove', '--'], 'un file sparito farebbe fallire tutto');
});

ok('fotografia: la seconda volta riusa l\'indice dell\'app, non lo ricopia', async (t) => {
  const { dir, tmpdir, run, calls, cleanup } = setup();
  t.after(cleanup);
  await snapshotTree({ cwd: dir, run, tmpdir });
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'INDICE CAMBIATO');
  calls.length = 0;
  await snapshotTree({ cwd: dir, run, tmpdir });
  assert.strictEqual(calls.find((c) => c.env).index, 'INDICE DELL\'APP');
});

ok('fotografia: senza indice vero si parte vuoti; un altro errore di copia non vale come vuoto', async (t) => {
  const { dir, tmpdir, run, cleanup } = setup({}, { noIndex: true });
  t.after(cleanup);
  assert.strictEqual((await snapshotTree({ cwd: dir, run, tmpdir })).ok, true);
  const other = setup();
  t.after(other.cleanup);
  const fsp = { ...fs.promises, copyFile: async () => { throw Object.assign(new Error('disco pieno'), { code: 'ENOSPC' }); } };
  const r = await snapshotTree({ cwd: other.dir, run: other.run, tmpdir: other.tmpdir, fsp });
  assert.strictEqual(r.ok, false);
  assert.ok(!other.calls.some((c) => c.args.includes('write-tree')), 'fotografia fatta con un indice vuoto');
});

ok('fotografia: i file nuovi troppo grandi restano fuori', async (t) => {
  const { dir, tmpdir, run, calls, cleanup } = setup({ 'piccolo.txt': 'x', 'grande.bin': Buffer.alloc(MAX_NEW_FILE_BYTES + 1) },
    { untracked: 'piccolo.txt\0grande.bin\0' });
  t.after(cleanup);
  await snapshotTree({ cwd: dir, run, tmpdir });
  const added = calls.filter((c) => c.args.includes('update-index')).flatMap((c) => c.args.slice(c.args.indexOf('--') + 1));
  assert.deepStrictEqual(added, ['piccolo.txt']);
});

ok('fotografia: troppi file nuovi, nessuno entra e lo dice', async (t) => {
  const many = Array.from({ length: MAX_NEW_FILES + 1 }, (_, i) => `f${i}`).join('\0') + '\0';
  const { dir, tmpdir, run, calls, cleanup } = setup({}, { untracked: many });
  t.after(cleanup);
  const r = await snapshotTree({ cwd: dir, run, tmpdir });
  assert.strictEqual(r.partial, true);
  assert.ok(!calls.some((c) => c.args.includes('update-index')));
});

ok('fotografia: un lock rimasto sull\'indice dell\'app si rifà, una volta', async (t) => {
  const { dir, tmpdir, run, calls, cleanup } = setup({}, { fail: { on: 'write-tree', stderr: 'fatal: Unable to create \'/x/index.lock\': File exists.', once: true } });
  t.after(cleanup);
  const r = await snapshotTree({ cwd: dir, run, tmpdir });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(calls.filter((c) => c.args.includes('write-tree')).length, 2);
});

ok('fotografia: due fotografie dello stesso repository non si accavallano', async (t) => {
  const { dir, tmpdir, cleanup } = setup();
  t.after(cleanup);
  let running = 0;
  let overlap = false;
  const run = async (args) => {
    if (args.includes('--show-toplevel')) return `${dir}\n`;
    if (args.includes('--git-path')) return '.git/index\n';
    running += 1;
    if (running > 1) overlap = true;
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return args.includes('write-tree') ? `${TREE}\n` : '';
  };
  await Promise.all([snapshotTree({ cwd: dir, run, tmpdir }), snapshotTree({ cwd: dir, run, tmpdir })]);
  assert.strictEqual(overlap, false);
});

ok('fotografia: fuori da un repository lo dice; una risposta strana di git è un errore', async (t) => {
  const notRepo = await snapshotTree({ cwd: '/x', run: async () => { throw Object.assign(new Error('x'), { stderr: 'fatal: not a git repository' }); } });
  assert.deepStrictEqual(notRepo, { ok: false, reason: 'not-a-repo' });
  const { dir, tmpdir, run, cleanup } = setup({}, { tree: 'non-un-tree\n' });
  t.after(cleanup);
  assert.strictEqual((await snapshotTree({ cwd: dir, run, tmpdir })).ok, false);
  assert.strictEqual((await snapshotTree({ cwd: '' })).ok, false);
});

ok('fotografia: isTreeId accetta solo sha1 e sha256 esadecimali', () => {
  assert.strictEqual(isTreeId('a'.repeat(40)), true);
  assert.strictEqual(isTreeId('b'.repeat(64)), true);
  for (const bad of ['', 'A'.repeat(40), 'a'.repeat(39), '--output=x', 'HEAD', null, 42]) assert.strictEqual(isTreeId(bad), false, String(bad));
});
