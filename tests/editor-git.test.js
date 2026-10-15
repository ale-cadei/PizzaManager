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

ok('headText: percorsi che escono dalla radice si rifiutano senza lanciare git', async () => {
  const calls = [];
  const g = createEditorGit({ root: '/w', run: async (...a) => { calls.push(a); return Buffer.from(''); } });
  for (const rel of ['../x', 'a/../../b', '/etc/passwd', 'C:\\x', '', null]) {
    assert.deepStrictEqual(await g.headText(rel), { ok: false, reason: 'outside' }, String(rel));
  }
  assert.deepStrictEqual(calls, []);
});

ok('headText: argomenti di git e risposte riconosciute dallo stderr', async () => {
  const args = [];
  const fine = createEditorGit({ root: '/w', run: async (a, o) => { args.push([a, o.cwd, o.buffer]); return Buffer.from('ciao'); } });
  assert.deepStrictEqual(await fine.headText('sub\\a.txt'), { ok: true, text: 'ciao' });
  assert.deepStrictEqual(args, [[['cat-file', 'blob', 'HEAD:./sub/a.txt'], '/w', true]]);

  const failing = (e) => createEditorGit({ root: '/w', run: async () => { throw e; } }).headText('a.txt');
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
