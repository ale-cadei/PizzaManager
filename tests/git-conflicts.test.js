const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Conflitti di un'operazione a metà (docs/plans/69): letture, argv e
   controlli con un git finto; il giro vero sta in tests/integration.test.js. */
const C = require('../lib/git-conflicts');

const ROOT = '/repo';
const fail = (code, stderr = '', extra = {}) => Object.assign(new Error(`exit ${code}`), { code, stderr, stdout: '', ...extra });

/* `status --porcelain=v2 -z`: una riga «u» per file in conflitto, «1» per i risolti */
const u = (xy, p) => `u ${xy} N... 100644 100644 100644 100644 h1 h2 h3 ${p}`;
const one = (xy, p) => `1 ${xy} N... 100644 100644 100644 hH hI ${p}`;

/**
 * git finto. `heads`: i ref speciali che esistono (MERGE_HEAD…); `rebase`:
 * contenuto di .git/rebase-merge ({head-name, onto, msgnum, end}) o null;
 * `status`: le voci di status; `files`: il contenuto dei file sul disco;
 * `cont(args)`: cosa fa il continue / commit; dopo, `after` dice cosa resta a metà.
 */
function fakeRepo({
  heads = ['MERGE_HEAD'], rebase = null, status = [], statusAfter = null, files = {}, symlinks = [],
  mergeMsg = "Merge branch 'feat/x'\n", current = 'main', cont = () => '', after = [],
} = {}) {
  const calls = [];
  let live = heads;
  let rebasing = rebase;
  let continued = false;
  const run = async (args, opts) => {
    calls.push({ args, opts });
    const a = args.filter((x) => !['--literal-pathspecs'].includes(x));
    if (a.includes('--show-toplevel')) return `${ROOT}\n`;
    if (a[0] === 'rev-parse' && a.includes('--git-path')) return a.filter((x, i) => a[i - 1] === '--git-path').map((p) => `.git/${p}`).join('\n');
    if (a[0] === 'rev-parse' && a.includes('--verify')) {
      const ref = a[a.length - 1];
      if (live.includes(ref)) return 'abc1234def\n';
      if (ref === 'HEAD^{commit}') return 'fff0000\n';
      throw fail(1);
    }
    if (a[0] === 'symbolic-ref') return `${current}\n`;
    if (a[0] === 'log') return 'messaggio del commit\n';
    if (a[0] === 'for-each-ref') return 'main\n';
    if (a.includes('status')) return (continued && statusAfter ? statusAfter : status).map((s) => `${s}\0`).join(''); // dopo i -c di GIT_GLOBAL
    if (a[0] === 'diff' && a.includes('--diff-filter=U')) return status.filter((s) => s.startsWith('u ')).map((s) => `${s.split(' ').slice(10).join(' ')}\0`).join('');
    if (['add', 'rm', 'checkout'].includes(a[0])) return '';
    if (a[0] === 'commit' || a.includes('--continue')) {
      continued = true;
      const out = cont(args, opts);
      live = after; rebasing = after.includes('rebase') ? rebasing : null;
      return out;
    }
    if (a.includes('--abort')) { live = []; rebasing = null; return ''; }
    throw fail(128, `git finto: ${args.join(' ')}`);
  };
  const exists = (p) => Boolean(rebasing) && /rebase-merge$/.test(p);
  const fsp = {
    readFile: async (p) => {
      const rel = p.replace(/^\/repo\//, '');
      if (rebasing && /rebase-merge[\\/]/.test(p)) return `${rebasing[p.split(/[\\/]/).pop()]}\n`;
      if (/MERGE_MSG$/.test(p)) return mergeMsg;
      if (rel in files) return files[rel];
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    stat: async (p) => {
      const rel = p.replace(/^\/repo\//, '');
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: Buffer.byteLength(files[rel]) };
    },
    // Come lib/git-changes.js: lstat non segue il collegamento, open+read legge solo l'inizio
    lstat: async (p) => {
      const rel = p.replace(/^\/repo\//, '');
      if (symlinks.includes(rel)) return { size: 0, isFile: () => false, isSymbolicLink: () => true };
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: Buffer.byteLength(files[rel]), isFile: () => true };
    },
    open: async (p) => {
      const rel = p.replace(/^\/repo\//, '');
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const buf = Buffer.from(files[rel]);
      return {
        read: async (dst, offset, length, position) => {
          const slice = buf.subarray(position, position + length);
          slice.copy(dst, offset);
          return { bytesRead: slice.length };
        },
        close: async () => {},
      };
    },
  };
  const sent = () => calls.map((c) => c.args.join(' '));
  return { run, exists, fsp, calls, sent, platform: 'linux' };
}

const opts = (r, extra = {}) => ({ cwd: `${ROOT}/sub`, run: r.run, exists: r.exists, fsp: r.fsp, platform: 'linux', ...extra });

ok('conflitti: niente a metà → op null, una lettura sola', async () => {
  const r = fakeRepo({ heads: [] });
  assert.deepStrictEqual(await C.readConflicts(opts(r)), { ok: true, root: ROOT, op: null });
  assert.ok(!r.sent().some((s) => s.startsWith('status')));
});

ok('conflitti: merge, file per tipo, blocchi contati, risolti a parte', async () => {
  const r = fakeRepo({
    status: [u('UU', 'lib/a b.js'), u('UD', 'old.js'), u('AA', 'img.png'), one('M.', 'README.md'), '? nuovo.txt'],
    files: {
      'lib/a b.js': '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feat/x\n<<<<<<< HEAD\n=======\n>>>>>>> feat/x\n',
      'old.js': 'x\n', 'img.png': 'PNG\0\0binario',
    },
  });
  const c = await C.readConflicts(opts(r));
  assert.strictEqual(c.op, 'merge');
  assert.deepStrictEqual(c.what, { incoming: 'feat/x', into: 'main', step: null, total: null, commit: 'abc1234', subject: null });
  assert.deepStrictEqual(c.files, [
    { path: 'img.png', kind: 'both-added', binary: true, blocks: null },
    { path: 'lib/a b.js', kind: 'both-modified', binary: false, blocks: 2 },
    { path: 'old.js', kind: 'deleted-by-them', binary: false, blocks: 0 },
  ]);
  assert.deepStrictEqual(c.resolved, ['README.md']);
  const status = r.calls.find((x) => x.args.includes('status'));
  assert.ok(status.args.includes('--porcelain=v2') && status.args.includes('-z'));
});

ok('conflitti: rebase, passo e commit che si sta riapplicando', async () => {
  const r = fakeRepo({ heads: ['REBASE_HEAD'], rebase: { 'head-name': 'refs/heads/feat/x', onto: 'aaa111', msgnum: '3', end: '7' }, status: [u('UU', 'a.js')], files: { 'a.js': 'x\n' } });
  const c = await C.readConflicts(opts(r));
  assert.strictEqual(c.op, 'rebase');
  assert.deepStrictEqual(c.what, { incoming: 'feat/x', into: 'main', step: 3, total: 7, commit: 'abc1234', subject: 'messaggio del commit' });
});

ok('conflitti: cherry-pick e revert dicono il commit', async () => {
  for (const [head, op] of [['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]) {
    const c = await C.readConflicts(opts(fakeRepo({ heads: [head], status: [] })));
    assert.strictEqual(c.op, op);
    assert.strictEqual(c.what.commit, 'abc1234');
    assert.strictEqual(c.what.subject, 'messaggio del commit');
    assert.strictEqual(c.what.into, 'main');
  }
});

/* describeFile da sola (fix round finale, docs/plans/69): binario deciso
   sempre dalle prime righe lette con un handle, mai da fsp.stat+readFile
   intero, e mai seguendo un collegamento. */
ok('describeFile: file grande sopra MAX_READ_BYTES → blocchi non contati, ma il binario si vede lo stesso', async () => {
  const head = '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feat/x\n';
  const fsp = {
    lstat: async () => ({ size: 5 * 1024 * 1024, isFile: () => true }),
    open: async () => ({
      read: async (dst) => { const s = Buffer.from(head); s.copy(dst); return { bytesRead: s.length }; },
      close: async () => {},
    }),
    readFile: async () => { throw new Error('non deve leggere un file grande tutto intero'); },
  };
  const f = { path: 'big.txt', kind: 'both-modified' };
  assert.deepStrictEqual(await C.describeFile(fsp, 'linux', '/repo', f), { ...f, binary: false, blocks: null });
});

ok('describeFile: file grande e binario (NUL nelle prime righe) → binary:true senza leggerlo tutto', async () => {
  const fsp = {
    lstat: async () => ({ size: 5 * 1024 * 1024, isFile: () => true }),
    open: async () => ({
      read: async (dst) => { const s = Buffer.from('PNG\0\0resto'); s.copy(dst); return { bytesRead: s.length }; },
      close: async () => {},
    }),
    readFile: async () => { throw new Error('non deve leggere un file grande tutto intero'); },
  };
  const f = { path: 'big.png', kind: 'both-added' };
  assert.deepStrictEqual(await C.describeFile(fsp, 'linux', '/repo', f), { ...f, binary: true, blocks: null });
});

ok('describeFile: un collegamento non si segue, niente stat né lettura sul bersaglio', async () => {
  const fsp = {
    lstat: async () => ({ size: 0, isFile: () => false, isSymbolicLink: () => true }),
    open: async () => { throw new Error('non deve aprire un collegamento'); },
    readFile: async () => { throw new Error('non deve leggere un collegamento'); },
  };
  const f = { path: 'link', kind: 'both-modified' };
  assert.deepStrictEqual(await C.describeFile(fsp, 'linux', '/repo', f), { ...f, binary: true, blocks: null });
});

ok('risolvi "mark": un collegamento si rifiuta prima di leggerlo', async () => {
  const r = fakeRepo({ status: [u('UU', 'link.js')], symlinks: ['link.js'] });
  const res = await C.resolveFile(opts(r, { path: 'link.js', how: 'mark' }));
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /non è un file normale/);
});

ok('risolvi: argv per ogni scelta, sempre -- e --literal-pathspecs', async () => {
  const cases = [
    ['mark', 'UU', 'a.js', 'pulito\n', [['add', '--', 'a.js']]],
    ['ours', 'UU', 'a.js', 'x', [['checkout', '--ours', '--', 'a.js'], ['add', '--', 'a.js']]],
    ['theirs', 'AA', 'a.js', 'x', [['checkout', '--theirs', '--', 'a.js'], ['add', '--', 'a.js']]],
    ['keep', 'UD', 'a.js', 'x', [['add', '--', 'a.js']]],
    ['delete', 'DU', 'a.js', 'x', [['rm', '--quiet', '--', 'a.js']]],
  ];
  for (const [how, xy, p, text, expected] of cases) {
    const r = fakeRepo({ status: [u(xy, p)], files: { [p]: text } });
    const res = await C.resolveFile(opts(r, { path: p, how }));
    assert.deepStrictEqual(res, { ok: true }, `${how}: ${res.error}`);
    const writes = r.calls.filter((c) => ['add', 'rm', 'checkout'].includes(c.args[1]));
    assert.deepStrictEqual(writes.map((c) => c.args), expected.map((e) => ['--literal-pathspecs', ...e]), how);
    assert.ok(writes.every((c) => c.opts.cwd === ROOT));
  }
});

ok('risolvi: rifiuta percorsi fuori, file non in conflitto, how sconosciuto, lato cancellato, marcatori', async () => {
  const r = fakeRepo({ status: [u('UU', 'a.js'), u('UD', 'old.js')], files: { 'a.js': 'su\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feat/x\n', 'old.js': 'x' } });
  const no = async (extra, re) => {
    const res = await C.resolveFile(opts(r, extra));
    assert.strictEqual(res.ok, false, JSON.stringify(extra));
    assert.match(res.error, re);
  };
  await no({ path: '../fuori.js', how: 'mark' }, /percorso/i);
  await no({ path: 'b.js', how: 'mark' }, /non è (più )?fra i file in conflitto/);
  await no({ path: 'a.js', how: 'rm -rf' }, /scelta/i);
  await no({ path: 'old.js', how: 'theirs' }, /cancellato/);
  await no({ path: 'a.js', how: 'mark' }, /marcatori/);
  assert.ok(!r.calls.some((c) => ['add', 'rm', 'checkout'].includes(c.args[1])), 'ha scritto nonostante il rifiuto');
});

ok('continua: merge → commit --no-edit col tempo massimo e GIT_EDITOR=true', async () => {
  const r = fakeRepo({ status: [], after: [] });
  assert.deepStrictEqual(await C.continueOp(opts(r, { op: 'merge' })), { ok: true, done: true });
  const c = r.calls.find((x) => x.args[0] === 'commit');
  assert.deepStrictEqual(c.args, ['commit', '--no-edit']);
  assert.strictEqual(c.opts.env.GIT_EDITOR, 'true');
  assert.ok(c.opts.timeout > 0);
  assert.ok(!c.args.includes('--no-verify'));
});

ok('continua: un rebase che si ferma di nuovo → stopped', async () => {
  const rebase = { 'head-name': 'refs/heads/feat/x', onto: 'aaa111', msgnum: '1', end: '2' };
  const r = fakeRepo({
    heads: [], rebase, status: [], statusAfter: [u('UU', 'b.js')],
    cont: () => { throw fail(1, 'CONFLICT (content)'); }, after: ['rebase'],
  });
  const res = await C.continueOp(opts(r, { op: 'rebase' }));
  assert.deepStrictEqual(res, { ok: true, stopped: true });
  assert.ok(r.sent().includes('rebase --continue'));
});

ok('continua: rebase che fallisce senza conflitti e senza avanzare → ok:false, messaggio di git', async () => {
  const rebase = { 'head-name': 'refs/heads/feat/x', onto: 'aaa111', msgnum: '1', end: '2' };
  const r = fakeRepo({
    heads: [], rebase, status: [], statusAfter: [],
    cont: () => { throw fail(1, 'error: you must edit all merge conflicts and then\nmark them as resolved'); },
    after: ['rebase'],
  });
  const res = await C.continueOp(opts(r, { op: 'rebase' }));
  assert.strictEqual(res.ok, false);
  assert.ok(!res.stopped);
  assert.match(res.error, /edit all merge conflicts/);
  assert.ok(r.sent().includes('rebase --continue'));
});

ok('continua: merge fermato da un hook (non timeout), MERGE_HEAD resta → ok:false, non stopped', async () => {
  const r = fakeRepo({
    heads: ['MERGE_HEAD'], status: [],
    cont: () => { throw fail(1, 'hook pre-commit ha rifiutato il commit'); },
  });
  const res = await C.continueOp(opts(r, { op: 'merge' }));
  assert.strictEqual(res.ok, false);
  assert.ok(!res.stopped);
  assert.match(res.error, /hook pre-commit/);
});

ok('continua: rifiutato con file in conflitto, con op che non combacia, con op sconosciuta', async () => {
  const conflicted = fakeRepo({ status: [u('UU', 'a.js')] });
  assert.match((await C.continueOp(opts(conflicted, { op: 'merge' }))).error, /ancora in conflitto/);
  assert.match((await C.continueOp(opts(fakeRepo(), { op: 'rebase' }))).error, /pannello era vecchio/);
  assert.match((await C.continueOp(opts(fakeRepo(), { op: 'merge --strategy=ours' }))).error, /operazione/i);
  assert.ok(!conflicted.sent().some((s) => s.startsWith('commit')));
});

ok('continua: tempo scaduto → il messaggio del commit', async () => {
  const r = fakeRepo({ status: [], cont: () => { throw fail(null, '', { killed: true }); } });
  const res = await C.continueOp(opts(r, { op: 'merge' }));
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /nessuna risposta/);
});

ok('annulla: <op> --abort, solo se è quella a metà', async () => {
  for (const [head, op] of [['MERGE_HEAD', 'merge'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]) {
    const r = fakeRepo({ heads: [head] });
    assert.deepStrictEqual(await C.abortOp(opts(r, { op })), { ok: true });
    assert.ok(r.sent().includes(`${op} --abort`));
  }
  const r = fakeRepo({ heads: ['MERGE_HEAD'] });
  assert.match((await C.abortOp(opts(r, { op: 'revert' }))).error, /pannello era vecchio/);
  assert.ok(!r.sent().some((s) => s.includes('--abort')));
});
