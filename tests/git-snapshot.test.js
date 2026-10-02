const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* «Ultimo giro» del pannello delle modifiche (docs/plans/32, decisione 7):
   la fotografia dei file è un tree git fatto con un indice temporaneo. Qui
   cosa si chiede a git, senza git; il caso vero sta in integration.test.js. */
const { snapshotTree, isTreeId, MAX_NEW_FILE_BYTES } = require('../lib/git-snapshot');

const TREE = 'a'.repeat(40);

function setup(files = {}, answers = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-snaptest-'));
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), content);
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'INDICE VERO');
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, env: opts.env || null, index: opts.env ? fs.readFileSync(opts.env.GIT_INDEX_FILE, 'utf8') : null });
    if (args.includes('--show-toplevel')) return `${dir}\n`;
    if (args.includes('--git-path')) return '.git/index\n';
    if (args.includes('ls-files')) return answers.untracked || '';
    if (args.includes('write-tree')) return answers.tree === undefined ? `${TREE}\n` : answers.tree;
    return '';
  };
  return { dir, run, calls, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

ok('fotografia: indice temporaneo copiato da quello vero, poi add e write-tree', async (t) => {
  const { dir, run, calls, cleanup } = setup({ 'nuovo.txt': 'x' }, { untracked: 'nuovo.txt\0' });
  t.after(cleanup);
  const r = await snapshotTree({ cwd: dir, run, now: () => 42 });
  assert.deepStrictEqual(r, { ok: true, root: dir, tree: TREE, at: 42 });
  const withIndex = calls.filter((c) => c.env);
  assert.deepStrictEqual(withIndex.map((c) => c.args.filter((a) => !a.startsWith('-')).join(' ')),
    ['add', 'ls-files', 'add nuovo.txt', 'write-tree']);
  assert.ok(withIndex.every((c) => c.index === 'INDICE VERO'), 'l\'indice temporaneo non parte da quello vero');
  assert.ok(withIndex.every((c) => !c.env.GIT_INDEX_FILE.startsWith(dir)), 'l\'indice temporaneo sta dentro il repository');
  assert.ok(!fs.existsSync(withIndex[0].env.GIT_INDEX_FILE), 'l\'indice temporaneo è rimasto');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.git', 'index'), 'utf8'), 'INDICE VERO');
  assert.ok(calls.find((c) => c.args.includes('nuovo.txt')).args.includes('--literal-pathspecs'));
});

ok('fotografia: i file nuovi troppo grandi restano fuori', async (t) => {
  const { dir, run, calls, cleanup } = setup({ 'piccolo.txt': 'x', 'grande.bin': Buffer.alloc(MAX_NEW_FILE_BYTES + 1) },
    { untracked: 'piccolo.txt\0grande.bin\0' });
  t.after(cleanup);
  await snapshotTree({ cwd: dir, run });
  const added = calls.filter((c) => c.args.includes('--')).flatMap((c) => c.args.slice(c.args.indexOf('--') + 1));
  assert.deepStrictEqual(added, ['piccolo.txt']);
});

ok('fotografia: fuori da un repository lo dice; una risposta strana di git è un errore', async (t) => {
  const notRepo = await snapshotTree({ cwd: '/x', run: async () => { throw Object.assign(new Error('x'), { stderr: 'fatal: not a git repository' }); } });
  assert.deepStrictEqual(notRepo, { ok: false, reason: 'not-a-repo' });
  const { dir, run, cleanup } = setup({}, { tree: 'non-un-tree\n' });
  t.after(cleanup);
  assert.strictEqual((await snapshotTree({ cwd: dir, run })).ok, false);
  assert.strictEqual((await snapshotTree({ cwd: '' })).ok, false);
});

ok('fotografia: isTreeId accetta solo sha1 e sha256 esadecimali', () => {
  assert.strictEqual(isTreeId('a'.repeat(40)), true);
  assert.strictEqual(isTreeId('b'.repeat(64)), true);
  for (const bad of ['', 'A'.repeat(40), 'a'.repeat(39), '--output=x', 'HEAD', null, 42]) assert.strictEqual(isTreeId(bad), false, String(bad));
});
