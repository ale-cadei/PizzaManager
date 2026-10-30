const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorGit } = require('../lib/editor-git');
const { runGit } = require('../lib/git-run');
const { resolveBinary } = require('../lib/binaries');

/* Il testo di HEAD per le barrette dell'editor (docs/plans/63): repository
   di prova in una tmpdir, git vero. Saltati se git manca. In fondo le
   scelte senza git, con un `run` finto. */
const GIT = resolveBinary('git').path;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Prova', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Prova', GIT_COMMITTER_EMAIL: 'p@x' };

function tmp(t) {
  // .native come git: su macOS /var -> /private/var, su Windows i nomi corti 8.3
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edgit-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
/** Un repository di prova; `git(...)` lancia git lì dentro. */
function repo(t) {
  const dir = tmp(t);
  const git = (...args) => execFileSync(GIT, args, { cwd: dir, env: ENV });
  git('init', '-q', '-b', 'main');
  return { dir, git };
}
const commit = (git) => { git('add', '-A'); git('commit', '-q', '-m', 'prova'); };

ok('headText: il file com è in HEAD, anche se sul disco è cambiato', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'a.txt', 'uno\ndue\n');
  commit(git);
  put(dir, 'a.txt', 'uno\ncambiato\n');
  assert.deepStrictEqual(await createEditorGit({ root: dir }).headText('a.txt'), { ok: true, text: 'uno\ndue\n' });
});

ok('headText: non tracciato o solo nell indice → text null', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'a.txt', 'a\n');
  commit(git);
  put(dir, 'nuovo.txt', 'n\n');
  put(dir, 'in-stage.txt', 's\n');
  git('add', 'in-stage.txt');
  const g = createEditorGit({ root: dir });
  assert.deepStrictEqual(await g.headText('nuovo.txt'), { ok: true, text: null });
  assert.deepStrictEqual(await g.headText('in-stage.txt'), { ok: true, text: null });
});

ok('headText: la cartella della scheda è una sottocartella del repository', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'sub/b.txt', 'b\n');
  commit(git);
  assert.deepStrictEqual(await createEditorGit({ root: path.join(dir, 'sub') }).headText('b.txt'), { ok: true, text: 'b\n' });
  // Separatori di Windows: arrivano a git come /
  assert.deepStrictEqual(await createEditorGit({ root: dir }).headText('sub\\b.txt'), { ok: true, text: 'b\n' });
});

ok('headText: repository senza commit → text null', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir } = repo(t);
  put(dir, 'a.txt', 'a\n');
  assert.deepStrictEqual(await createEditorGit({ root: dir }).headText('a.txt'), { ok: true, text: null });
});

ok('headText: fuori da un repository → not-repo', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const root = tmp(t);
  put(root, 'a.txt', 'a\n');
  // git non risale sopra la tmpdir: se stesse dentro un repository, «fuori» non si proverebbe
  const run = (args, o) => runGit(args, { ...o, env: { GIT_CEILING_DIRECTORIES: path.dirname(root) } });
  assert.deepStrictEqual(await createEditorGit({ root, run }).headText('a.txt'), { ok: false, reason: 'not-repo' });
});

ok('headText: binario e troppo grande non si confrontano; il BOM non arriva', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'logo.bin', Buffer.from([1, 0, 2]));
  put(dir, 'grande.txt', 'x'.repeat(100));
  put(dir, 'bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ciao\n')]));
  commit(git);
  const g = createEditorGit({ root: dir });
  assert.deepStrictEqual(await g.headText('logo.bin'), { ok: false, reason: 'binary' });
  assert.deepStrictEqual(await g.headText('bom.txt'), { ok: true, text: 'ciao\n' });
  assert.deepStrictEqual(await createEditorGit({ root: dir, maxRead: 10 }).headText('grande.txt'), { ok: false, reason: 'too-large' });
});

ok('headText: un file in un repository annidato si confronta col suo HEAD, non è tutto nuovo', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const outer = repo(t);
  put(outer.dir, 'a.txt', 'a\n');
  commit(outer.git);
  // Un repository dentro l'altro, non tracciato da quello esterno (un worktree in .worktrees/, un clone)
  const inner = path.join(outer.dir, 'dentro');
  put(inner, 'f.txt', 'uno\ndue\n');
  const git = (...args) => execFileSync(GIT, args, { cwd: inner, env: ENV });
  git('init', '-q', '-b', 'main');
  commit(git);
  put(inner, 'f.txt', 'uno\ncambiato\n');
  assert.deepStrictEqual(await createEditorGit({ root: outer.dir }).headText('dentro/f.txt'), { ok: true, text: 'uno\ndue\n' });
});

ok('headText: un file in un sottomodulo si confronta col HEAD del sottomodulo', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const lib = repo(t);
  put(lib.dir, 'f.txt', 'del sottomodulo\n');
  commit(lib.git);
  const main = repo(t);
  put(main.dir, 'a.txt', 'a\n');
  main.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib.dir, 'sub');
  commit(main.git);
  assert.deepStrictEqual(await createEditorGit({ root: main.dir }).headText('sub/f.txt'), { ok: true, text: 'del sottomodulo\n' });
});

ok('headText: scheda su una cartella che non è un repository ma ne contiene uno', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const root = tmp(t);
  const proj = path.join(root, 'progetto');
  put(proj, 'f.txt', 'uno\n');
  const git = (...args) => execFileSync(GIT, args, { cwd: proj, env: ENV });
  git('init', '-q', '-b', 'main');
  commit(git);
  put(root, 'sciolto.txt', 's\n');
  // git non risale sopra la tmpdir: se stesse dentro un repository, «fuori» non si proverebbe
  const run = (args, o) => runGit(args, { ...o, env: { GIT_CEILING_DIRECTORIES: path.dirname(root) } });
  const g = createEditorGit({ root, run });
  assert.deepStrictEqual(await g.headText('progetto/f.txt'), { ok: true, text: 'uno\n' });
  assert.deepStrictEqual(await g.headText('sciolto.txt'), { ok: false, reason: 'not-repo' });
});

ok('headText: un file ignorato da git → ignored, non tutto nuovo', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, '.gitignore', '.env\ndist/\n');
  commit(git);
  put(dir, '.env', 'SEGRETO=1\n');
  put(dir, 'dist/out.js', 'x\n');
  put(dir, 'nuovo.txt', 'n\n');
  const g = createEditorGit({ root: dir });
  assert.deepStrictEqual(await g.headText('.env'), { ok: false, reason: 'ignored' });
  assert.deepStrictEqual(await g.headText('dist/out.js'), { ok: false, reason: 'ignored' });
  assert.deepStrictEqual(await g.headText('nuovo.txt'), { ok: true, text: null }, 'non tracciato ma non ignorato');
});

ok('headText: percorsi che escono dalla radice si rifiutano senza lanciare git', async (t) => {
  const calls = [];
  const root = tmp(t);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  const g = createEditorGit({ root, run: async (...a) => { calls.push(a); return Buffer.from(''); } });
  for (const rel of ['../x', 'a/../../b', '/etc/passwd', 'C:\\x', '', null, 'link/altro.txt']) {
    assert.deepStrictEqual(await g.headText(rel), { ok: false, reason: 'outside' }, String(rel));
  }
  assert.deepStrictEqual(calls, []);
});

ok('headText: argomenti di git e risposte riconosciute dallo stderr', async () => {
  const args = [];
  const resolve = (rel) => path.join('/w', rel);
  const fine = createEditorGit({ root: '/w', resolve, run: async (a, o) => { args.push([a, o.cwd, o.buffer]); return Buffer.from('ciao'); } });
  assert.deepStrictEqual(await fine.headText('sub\\a.txt'), { ok: true, text: 'ciao' });
  assert.deepStrictEqual(args, [[['cat-file', 'blob', 'HEAD:./a.txt'], path.join('/w', 'sub'), true]]);

  const failing = (e) => createEditorGit({ root: '/w', resolve, run: async () => { throw e; } }).headText('a.txt');
  const git = (stderr) => Object.assign(new Error('Command failed'), { stderr });
  assert.deepStrictEqual(await failing(git('fatal: not a git repository (or any of the parent directories): .git\n')), { ok: false, reason: 'not-repo' });
  for (const stderr of ['fatal: Not a valid object name HEAD:./a.txt\n', "fatal: invalid object name 'HEAD'.\n",
    "fatal: path 'a.txt' does not exist in 'HEAD'\n", "fatal: path 'a.txt' exists on disk, but not in 'HEAD'\n"]) {
    assert.deepStrictEqual(await failing(git(stderr)), { ok: true, text: null }, stderr);
  }
  assert.deepStrictEqual(await failing(git('fatal: qualcosa di strano\naltro\n')), { ok: false, reason: 'error', error: 'fatal: qualcosa di strano' });
  assert.deepStrictEqual(await failing(Object.assign(new Error('git non trovato nel PATH'), { missing: true })), { ok: false, reason: 'no-git' });
  assert.deepStrictEqual(await failing(Object.assign(new RangeError('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })), { ok: false, reason: 'too-large' });
});

ok('headText: non in HEAD → si chiede a check-ignore, nella cartella del file', async () => {
  const calls = [];
  const notInHead = Object.assign(new Error('Command failed'), { stderr: 'fatal: Not a valid object name HEAD:./x\n' });
  const g = (ignoredExit) => createEditorGit({
    root: '/w',
    resolve: (rel) => path.join('/w', rel),
    run: async (a, o) => {
      calls.push([a, o.cwd]);
      if (a[0] === 'cat-file') throw notInHead;
      if (!ignoredExit) throw Object.assign(new Error('exit 1'), { code: 1 });
      return '';
    },
  });
  assert.deepStrictEqual(await g(true).headText('d/-x'), { ok: false, reason: 'ignored' });
  assert.deepStrictEqual(calls[1], [['check-ignore', '-q', '--', '-x'], path.join('/w', 'd')]);
  assert.deepStrictEqual(await g(false).headText('d/x'), { ok: true, text: null });
});

/* Chi ha toccato una riga, per la scheda editor (docs/plans/73) */
const { parseBlame } = require('../lib/editor-git');

ok('blameLine: riga committata → autore, data, messaggio; numeri di riga del testo dell editor', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'sub/f.txt', 'a\nb\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'primo messaggio', '--date', '2026-01-02T03:04:05+01:00');
  const g = createEditorGit({ root: dir });
  // Il testo dell'editor ha una riga in più, non salvata: «b» ora è la 3
  const r = await g.blameLine('sub/f.txt', 3, 'a\nnuova\nb\n');
  assert.strictEqual(r.ok, true);
  assert.match(r.blame.hash, /^[0-9a-f]{40}$/);
  assert.deepStrictEqual({ ...r.blame, hash: 'h' }, {
    hash: 'h', uncommitted: false, author: 'Prova', mail: 'p@x', time: Date.parse('2026-01-02T03:04:05+01:00') / 1000, summary: 'primo messaggio',
  });
  assert.deepStrictEqual(await g.blameLine('sub/f.txt', 2, 'a\nnuova\nb\n'), { ok: true, blame: { uncommitted: true } });
});

ok('blameLine: file non in HEAD, repository senza commit → non committata', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'nuovo.txt', 'n\n');
  assert.deepStrictEqual(await createEditorGit({ root: dir }).blameLine('nuovo.txt', 1, 'n\n'), { ok: true, blame: { uncommitted: true } });
  commit(git);
  put(dir, 'dopo.txt', 'd\n');
  assert.deepStrictEqual(await createEditorGit({ root: dir }).blameLine('dopo.txt', 1, 'd\n'), { ok: true, blame: { uncommitted: true } });
});

ok('blameLine: ignorato, fuori da git, riga oltre il testo', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, '.gitignore', '.env\n');
  put(dir, 'a.txt', 'a\n');
  commit(git);
  put(dir, '.env', 'X=1\n');
  const g = createEditorGit({ root: dir });
  assert.deepStrictEqual(await g.blameLine('.env', 1, 'X=1\n'), { ok: false, reason: 'ignored' });
  assert.deepStrictEqual(await g.blameLine('a.txt', 5, 'a\n'), { ok: false, reason: 'no-line' });
  const root = tmp(t);
  put(root, 'a.txt', 'a\n');
  const run = (args, o) => runGit(args, { ...o, env: { GIT_CEILING_DIRECTORIES: path.dirname(root) } });
  assert.deepStrictEqual(await createEditorGit({ root, run }).blameLine('a.txt', 1, 'a\n'), { ok: false, reason: 'not-repo' });
});

ok('blameLine: argomenti rifiutati senza lanciare git; argv e stdin', async () => {
  const calls = [];
  const resolve = (rel) => path.join('/w', rel);
  const out = 'abc 1 1 1\nauthor A\nauthor-mail <a@b>\nauthor-time 10\nsummary s\nfilename x\n\tt\n';
  const g = createEditorGit({ root: '/w', resolve, maxRead: 5, run: async (a, o) => { calls.push([a, o.cwd, o.input]); return out; } });
  for (const [rel, line, text] of [['../x', 1, 'a'], ['a', 0, 'a'], ['a', 1.5, 'a'], ['a', '1', 'a'], ['a', 1, null], ['a', 1, 'troppo lungo']]) {
    const r = await g.blameLine(rel, line, text);
    assert.strictEqual(r.ok, false, JSON.stringify([rel, line, text]));
  }
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(await g.blameLine('d/-f', 2, 'a\nb'), { ok: true, blame: { hash: 'abc', uncommitted: false, author: 'A', mail: 'a@b', time: 10, summary: 's' } });
  assert.deepStrictEqual(calls, [[['blame', '--porcelain', '-L', '2,2', '--contents', '-', '--', '-f'], path.join('/w', 'd'), 'a\nb']]);
});

ok('parseBlame: porcelain di una riga; riga non committata; uscita vuota', () => {
  assert.deepStrictEqual(parseBlame('0000000000000000000000000000000000000000 2 2 1\nauthor Not Committed Yet\nauthor-time 5\nsummary x\n\tX\n'), { uncommitted: true });
  assert.deepStrictEqual(parseBlame('ff 1 1 1\nauthor  Spazi  \nauthor-mail <>\nsummary \n\tcontenuto author finto\n'),
    { hash: 'ff', uncommitted: false, author: ' Spazi  ', mail: '', time: null, summary: '' });
  assert.strictEqual(parseBlame(''), null);
});
