const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Pannello «cosa ha cambiato» (docs/plans/32): lib/git-changes.js legge
   l'elenco dei file toccati e il diff di uno di loro. Qui parsing e scelte
   senza git: `run` finto che risponde in base al sottocomando. Il caso con
   git vero sta in tests/integration.test.js. */
const {
  parseNameStatus, parseNumstat, parseNulList, mergeChanges, parseUnifiedDiff,
  countLines, isSafeRelative, createCountCache, readChanges, readFileDiff,
} = require('../lib/git-changes');

const NUL = '\0';
const z = (...parts) => parts.join(NUL) + NUL;

/* ---------- parsing ---------- */

ok('changes: parseNameStatus legge modificati, aggiunti, cancellati e rinominati', () => {
  const text = z('M', 'app.js', 'A', 'lib/nuovo.js', 'D', 'vecchio.js', 'R087', 'a.js', 'b.js', 'T', 'link', 'C100', 'x.js', 'y.js');
  assert.deepStrictEqual(parseNameStatus(text), [
    { status: 'M', path: 'app.js' },
    { status: 'A', path: 'lib/nuovo.js' },
    { status: 'D', path: 'vecchio.js' },
    { status: 'R', path: 'b.js', oldPath: 'a.js' },
    { status: 'M', path: 'link' },
    { status: 'A', path: 'y.js' },
  ]);
});

ok('changes: parseNumstat legge righe, binari e rinominati', () => {
  const text = '12\t3\tapp.js' + NUL + '-\t-\tlogo.png' + NUL + '4\t1\t' + NUL + 'a.js' + NUL + 'b.js' + NUL;
  assert.deepStrictEqual(parseNumstat(text), [
    { path: 'app.js', added: 12, removed: 3, binary: false },
    { path: 'logo.png', added: null, removed: null, binary: true },
    { path: 'b.js', oldPath: 'a.js', added: 4, removed: 1, binary: false },
  ]);
});

ok('changes: nomi con spazi, accenti e caratteri strani restano interi', () => {
  const text = z('M', 'cartella con spazi/perché è.md', 'A', 'a\tb.txt');
  assert.deepStrictEqual(parseNameStatus(text).map((f) => f.path), ['cartella con spazi/perché è.md', 'a\tb.txt']);
  const num = '1\t0\tcartella con spazi/perché è.md' + NUL;
  assert.strictEqual(parseNumstat(num)[0].path, 'cartella con spazi/perché è.md');
});

ok('changes: output vuoto o spazzatura non esplode', () => {
  assert.deepStrictEqual(parseNameStatus(''), []);
  assert.deepStrictEqual(parseNumstat(''), []);
  assert.deepStrictEqual(parseNulList(''), []);
  assert.deepStrictEqual(parseNameStatus('Z' + NUL), []);
  assert.deepStrictEqual(parseNumstat('niente tab' + NUL), []);
});

ok('changes: mergeChanges unisce stato, righe e non tracciati, in ordine di percorso', () => {
  const files = mergeChanges(
    [{ status: 'M', path: 'z.js' }, { status: 'R', path: 'b.js', oldPath: 'a.js' }],
    [{ path: 'z.js', added: 2, removed: 1, binary: false }, { path: 'b.js', oldPath: 'a.js', added: 0, removed: 0, binary: false }],
    [{ path: 'm.txt', added: 3, removed: 0, binary: false }],
  );
  assert.deepStrictEqual(files.map((f) => [f.path, f.status, f.added]), [['b.js', 'R', 0], ['m.txt', '?', 3], ['z.js', 'M', 2]]);
  assert.strictEqual(files[0].oldPath, 'a.js');
  assert.strictEqual(files[1].untracked, true);
});

ok('changes: countLines conta le righe, riconosce i binari', () => {
  assert.deepStrictEqual(countLines(Buffer.from('')), { lines: 0, binary: false });
  assert.deepStrictEqual(countLines(Buffer.from('a\nb\n')), { lines: 2, binary: false });
  assert.deepStrictEqual(countLines(Buffer.from('a\nb')), { lines: 2, binary: false });
  assert.deepStrictEqual(countLines(Buffer.from([0x89, 0x50, 0x00, 0x01])), { lines: 0, binary: true });
});

ok('changes: parseUnifiedDiff legge blocchi, numeri di riga e note', () => {
  const text = [
    'diff --git a/app.js b/app.js',
    'index 111..222 100644',
    '--- a/app.js',
    '+++ b/app.js',
    '@@ -1,3 +1,3 @@ function x() {',
    ' uno',
    '-due',
    '+DUE',
    ' tre',
    '@@ -10,2 +10,3 @@',
    ' dieci',
    '+nuova',
    ' undici',
    '\\ No newline at end of file',
    '',
  ].join('\n');
  const d = parseUnifiedDiff(text);
  assert.strictEqual(d.binary, false);
  assert.strictEqual(d.truncated, false);
  assert.strictEqual(d.hunks.length, 2);
  assert.strictEqual(d.hunks[0].header, '@@ -1,3 +1,3 @@ function x() {');
  assert.deepStrictEqual(d.hunks[0].lines, [
    { kind: 'ctx', oldNo: 1, newNo: 1, text: 'uno' },
    { kind: 'del', oldNo: 2, newNo: null, text: 'due' },
    { kind: 'add', oldNo: null, newNo: 2, text: 'DUE' },
    { kind: 'ctx', oldNo: 3, newNo: 3, text: 'tre' },
  ]);
  assert.deepStrictEqual(d.hunks[1].lines.map((l) => [l.kind, l.oldNo, l.newNo]), [
    ['ctx', 10, 10], ['add', null, 11], ['ctx', 11, 12], ['note', null, null],
  ]);
});

ok('changes: parseUnifiedDiff riconosce un binario', () => {
  const d = parseUnifiedDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n');
  assert.strictEqual(d.binary, true);
  assert.deepStrictEqual(d.hunks, []);
});

ok('changes: un diff enorme si tronca e lo dice', () => {
  const body = Array.from({ length: 50 }, (_, i) => `+riga ${i}`).join('\n');
  const d = parseUnifiedDiff(`@@ -0,0 +1,50 @@\n${body}\n`, { maxLines: 10 });
  assert.strictEqual(d.truncated, true);
  assert.strictEqual(d.hunks[0].lines.length, 10);
});

ok('changes: un testo con markup resta testo', () => {
  const d = parseUnifiedDiff('@@ -1 +1 @@\n-<b>x</b>\n+<script>alert(1)</script>\n');
  assert.strictEqual(d.hunks[0].lines[1].text, '<script>alert(1)</script>');
});

ok('changes: isSafeRelative rifiuta assoluti, risalite e vuoti, anche su Windows', () => {
  assert.strictEqual(isSafeRelative('lib/x.js'), true);
  assert.strictEqual(isSafeRelative('cartella con spazi/è.md'), true);
  for (const bad of ['', '/etc/passwd', '../fuori', 'lib/../../fuori', 'a\0b', null, 42]) {
    assert.strictEqual(isSafeRelative(bad), false, JSON.stringify(bad));
  }
  assert.strictEqual(isSafeRelative('C:\\Windows\\win.ini', { platform: 'win32' }), false);
  assert.strictEqual(isSafeRelative('lib\\..\\..\\fuori', { platform: 'win32' }), false);
  assert.strictEqual(isSafeRelative('\\\\server\\share', { platform: 'win32' }), false);
  assert.strictEqual(isSafeRelative('lib/x.js', { platform: 'win32' }), true);
});

/* ---------- letture, con git finto ---------- */

const ROOT = '/repo';

/** `run` finto: risponde col primo gestore il cui nome compare negli argomenti */
function fakeGit(answers, calls = []) {
  return async (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    const sub = args.find((a) => !a.startsWith('-') && !a.includes('='));
    const key = Object.keys(answers).find((k) => k === sub || (k.includes(' ') && k.split(' ').every((w) => args.includes(w))));
    const a = answers[key];
    if (a === undefined) throw Object.assign(new Error(`git finto: ${args.join(' ')}`), { stderr: 'fatal: inatteso' });
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(args) : a;
  };
}

const gitError = (stderr) => Object.assign(new Error(stderr), { stderr });

function repoAnswers(extra = {}) {
  return {
    'rev-parse --show-toplevel': `${ROOT}\n`,
    'rev-parse --verify': 'abc123\n',
    'diff --name-status': z('M', 'app.js'),
    'diff --numstat': '2\t1\tapp.js' + NUL,
    'ls-files': '',
    ...extra,
  };
}

ok('changes: readChanges nella cartella principale confronta con HEAD', async () => {
  const calls = [];
  const r = await readChanges({ cwd: `${ROOT}/lib`, run: fakeGit(repoAnswers(), calls) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.root, ROOT);
  assert.strictEqual(r.against, 'abc123');
  assert.strictEqual(r.base, null);
  assert.deepStrictEqual(r.files, [{ path: 'app.js', status: 'M', added: 2, removed: 1, binary: false }]);
  assert.deepStrictEqual(r.totals, { files: 1, added: 2, removed: 1 });
  // tutto dalla radice: ls-files --others darebbe percorsi relativi alla cwd
  assert.ok(calls.slice(1).every((c) => c.cwd === ROOT));
  const diff = calls.find((c) => c.args.includes('--numstat')).args;
  for (const flag of ['--no-ext-diff', '--no-textconv', '--no-color', '-z', 'diff.suppressBlankEmpty=false']) assert.ok(diff.includes(flag), flag);
});

ok('changes: con una base confronta con il punto di partenza del branch', async () => {
  const calls = [];
  const run = fakeGit(repoAnswers({ 'merge-base': 'fff999\n' }), calls);
  const r = await readChanges({ cwd: ROOT, base: 'main', run });
  assert.strictEqual(r.against, 'fff999');
  assert.strictEqual(r.base, 'main');
  const mb = calls.find((c) => c.args.includes('merge-base')).args;
  assert.deepStrictEqual(mb.slice(-2), ['refs/heads/main', 'HEAD']);
});

ok('changes: con una base conta a parte i file non ancora committati', async () => {
  const run = fakeGit(repoAnswers({
    'merge-base': 'fff999\n',
    'diff --name-status': z('A', 'b.js', 'M', 'c.js'),
    'diff --numstat': '1\t0\tb.js' + NUL + '2\t0\tc.js' + NUL,
    'diff --name-only': z('c.js'),
    'ls-files': z('nuovo.txt'),
  }));
  const r = await readChanges({ cwd: ROOT, base: 'main', run, fsp: { lstat: async () => { throw new Error('no'); } } });
  assert.strictEqual(r.uncommitted, 2, 'c.js modificato e nuovo.txt non tracciato; b.js è nei commit');
});

ok('changes: contro HEAD tutto quello che si vede è non committato', async () => {
  const r = await readChanges({ cwd: ROOT, run: fakeGit(repoAnswers()) });
  assert.strictEqual(r.uncommitted, 1);
});

ok('changes: una base che non esiste più ricade su HEAD', async () => {
  const run = fakeGit(repoAnswers({ 'rev-parse --verify': (args) => {
    if (args.includes('refs/heads/sparito')) throw gitError('');
    return 'abc123\n';
  } }));
  const r = await readChanges({ cwd: ROOT, base: 'sparito', run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.against, 'abc123');
  assert.strictEqual(r.base, null);
});

ok('changes: una base che non è un nome di branch valido si rifiuta senza chiamare git', async () => {
  for (const base of ['-c', '--output=/tmp/x', 'a..b', 'con spazio', 42]) {
    const calls = [];
    const r = await readChanges({ cwd: ROOT, base, run: fakeGit(repoAnswers(), calls) });
    assert.strictEqual(r.ok, false, String(base));
    assert.strictEqual(calls.length, 0, String(base));
  }
});

ok('changes: una cartella che non è un repository lo dice, senza errore', async () => {
  const run = fakeGit({ 'rev-parse --show-toplevel': gitError('fatal: not a git repository (or any of the parent directories): .git') });
  assert.deepStrictEqual(await readChanges({ cwd: '/tmp/note', run }), { ok: false, reason: 'not-a-repo' });
});

ok('changes: senza cwd risponde con un errore', async () => {
  for (const cwd of [undefined, '', 42]) {
    const r = await readChanges({ cwd, run: fakeGit({}) });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error);
  }
});

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-changes-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

ok('changes: i file non tracciati si contano leggendoli; grandi e collegamenti no', async (t) => {
  const dir = tmpRepo({ 'nuovo.txt': 'a\nb\nc\n', 'grande.txt': 'x'.repeat(64), 'img.bin': Buffer.from([1, 0, 2]) });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  try { fs.symlinkSync('/etc/hosts', path.join(dir, 'link')); } catch { /* Windows senza privilegi */ }
  const run = fakeGit({
    'rev-parse --show-toplevel': `${dir}\n`, 'rev-parse --verify': 'abc\n', 'diff --name-status': '', 'diff --numstat': '',
    'ls-files': z('nuovo.txt', 'grande.txt', 'img.bin', 'link'),
  });
  const r = await readChanges({ cwd: dir, run, maxCountBytes: 32 });
  const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
  assert.deepStrictEqual([by['nuovo.txt'].status, by['nuovo.txt'].added], ['?', 3]);
  assert.strictEqual(by['grande.txt'].added, null);
  assert.strictEqual(by['img.bin'].binary, true);
  if (by.link) assert.deepStrictEqual([by.link.added, by.link.special], [null, true], 'un collegamento non si segue');
  assert.ok(by['nuovo.txt'].stamp, 'un file nuovo ha il suo timbro');
  assert.deepStrictEqual(r.totals, { files: r.files.length, added: 3, removed: 0 });
});

ok('changes: in un repository senza commit tutto è nuovo', async (t) => {
  const dir = tmpRepo({ 'a.txt': 'uno\n' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = fakeGit({
    'rev-parse --show-toplevel': `${dir}\n`,
    'rev-parse --verify': gitError(''),
    'ls-files --cached': z('a.txt'),
    'ls-files --others': '',
  });
  const r = await readChanges({ cwd: dir, run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.against, null);
  assert.deepStrictEqual(r.files.map((f) => [f.path, f.status, f.added]), [['a.txt', 'A', 1]]);
});

ok('changes: oltre il tetto di file l\'elenco si tronca e lo dice', async () => {
  const many = Array.from({ length: 30 }, (_, i) => `f${String(i).padStart(2, '0')}.js`);
  const run = fakeGit(repoAnswers({
    'diff --name-status': z(...many.flatMap((p) => ['M', p])),
    'diff --numstat': many.map((p) => `1\t0\t${p}`).join(NUL) + NUL,
  }));
  const r = await readChanges({ cwd: ROOT, run, maxFiles: 10 });
  assert.strictEqual(r.files.length, 10);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.totals.files, 30, 'il totale conta anche quelli non mostrati');
});

ok('changes: readFileDiff accetta solo un file dell\'elenco attuale', async () => {
  const calls = [];
  const run = fakeGit(repoAnswers({ 'diff --no-color': '@@ -1 +1 @@\n-a\n+b\n' }), calls);
  for (const p of ['../../etc/passwd', '/etc/passwd', 'altro.js', '', null]) {
    const r = await readFileDiff({ cwd: ROOT, path: p, run });
    assert.strictEqual(r.ok, false, String(p));
  }
  assert.ok(!calls.some((c) => c.args.includes('--no-color') && !c.args.includes('--numstat') && !c.args.includes('--name-status')),
    'nessun diff chiesto per un percorso rifiutato');
  const r = await readFileDiff({ cwd: ROOT, path: 'app.js', run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'M');
  assert.deepStrictEqual(r.hunks[0].lines.map((l) => l.kind), ['del', 'add']);
  const diff = calls.filter((c) => c.args.includes('diff') && !c.args.includes('--numstat') && !c.args.includes('--name-status')).pop().args;
  assert.ok(diff.includes('--literal-pathspecs'), 'il percorso non è un glob');
  assert.deepStrictEqual(diff.slice(-3), ['abc123', '--', 'app.js']);
});

ok('changes: readFileDiff di un rinominato passa entrambi i percorsi', async () => {
  const calls = [];
  const run = fakeGit(repoAnswers({
    'diff --name-status': z('R090', 'a.js', 'b.js'),
    'diff --numstat': '1\t1\t' + NUL + 'a.js' + NUL + 'b.js' + NUL,
    'diff --no-color': '@@ -1 +1 @@\n-x\n+y\n',
  }), calls);
  const r = await readFileDiff({ cwd: ROOT, path: 'b.js', run });
  assert.strictEqual(r.ok, true);
  const diff = calls.pop().args;
  assert.deepStrictEqual(diff.slice(-3), ['--', 'a.js', 'b.js']);
});

ok('changes: readFileDiff di un file nuovo lo mostra tutto come aggiunta', async (t) => {
  const dir = tmpRepo({ 'nuovo.txt': 'uno\n<b>due</b>\n' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = fakeGit({
    'rev-parse --show-toplevel': `${dir}\n`, 'rev-parse --verify': 'abc\n', 'diff --name-status': '', 'diff --numstat': '',
    'ls-files': z('nuovo.txt'),
  });
  const r = await readFileDiff({ cwd: dir, path: 'nuovo.txt', run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, '?');
  assert.strictEqual(r.hunks[0].header, '@@ -0,0 +1,2 @@');
  assert.deepStrictEqual(r.hunks[0].lines, [
    { kind: 'add', oldNo: null, newNo: 1, text: 'uno' },
    { kind: 'add', oldNo: null, newNo: 2, text: '<b>due</b>' },
  ]);
});

ok('changes: readFileDiff di un file nuovo troppo lungo si tronca', async (t) => {
  const dir = tmpRepo({ 'lungo.txt': Array.from({ length: 40 }, (_, i) => `r${i}`).join('\n') });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = fakeGit({
    'rev-parse --show-toplevel': `${dir}\n`, 'rev-parse --verify': 'abc\n', 'diff --name-status': '', 'diff --numstat': '',
    'ls-files': z('lungo.txt'),
  });
  const r = await readFileDiff({ cwd: dir, path: 'lungo.txt', run, maxLines: 5 });
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.hunks[0].lines.length, 5);
});

ok('changes: le righe di un file nuovo non cambiato non si ricontano a ogni giro', async (t) => {
  const dir = tmpRepo({ 'nuovo.txt': 'a\nb\n' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = fakeGit({
    'rev-parse --show-toplevel': `${dir}\n`, 'rev-parse --verify': 'abc\n', 'diff --name-status': '', 'diff --numstat': '',
    'ls-files': z('nuovo.txt'),
  });
  let opened = 0;
  const fsp = { lstat: (p) => fs.promises.lstat(p), open: (...a) => { opened += 1; return fs.promises.open(...a); } };
  const countCache = createCountCache();
  await readChanges({ cwd: dir, run, fsp, countCache });
  const again = await readChanges({ cwd: dir, run, fsp, countCache });
  assert.strictEqual(opened, 1);
  assert.strictEqual(again.files[0].added, 2);
  fs.writeFileSync(path.join(dir, 'nuovo.txt'), 'a\nb\nc\n');
  fs.utimesSync(path.join(dir, 'nuovo.txt'), new Date(), new Date(Date.now() + 5000));
  const changed = await readChanges({ cwd: dir, run, fsp, countCache });
  assert.strictEqual(changed.files[0].added, 3, 'riscritto: si riconta');
  assert.notStrictEqual(changed.files[0].stamp, again.files[0].stamp);
});

ok('changes: readFileDiff non rilegge tutti i file nuovi per trovarne uno', async (t) => {
  const dir = tmpRepo({ 'uno.txt': 'x\n' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const run = fakeGit({
    'rev-parse --show-toplevel': `${dir}\n`, 'rev-parse --verify': 'abc\n', 'diff --name-status': '',
    'ls-files': (args) => (args.includes('--') ? z(args[args.length - 1]) : z('uno.txt', 'altri.txt')),
  }, calls);
  const r = await readFileDiff({ cwd: dir, path: 'uno.txt', run });
  assert.strictEqual(r.ok, true, r.error);
  const ls = calls.filter((c) => c.args.includes('ls-files')).map((c) => c.args);
  assert.ok(ls.every((a) => a.includes('--literal-pathspecs') && a[a.length - 1] === 'uno.txt'), 'ls-files senza il percorso');
});
