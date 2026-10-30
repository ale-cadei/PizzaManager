const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { listAllFiles, gitStatusLetters, letterOf, parsePorcelain } = require('../lib/editor-index');
const { resolveBinary } = require('../lib/binaries');

/* Elenco piatto dei file (Ctrl+P) e lettere git dell'albero (docs/plans/75):
   su cartelle vere in una tmpdir, con git vero quando c'è. */

function tmp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edidx-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root, rel, text = '') {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const hasGit = () => Boolean(resolveBinary('git').path);

ok('listAllFiles: fuori da git legge la cartella, senza .git e node_modules, con / come separatore', async (t) => {
  const root = tmp(t);
  put(root, 'a.js');
  put(root, 'src/lib/b.js');
  put(root, 'node_modules/x/index.js');
  const r = await listAllFiles({ root, run: async () => { throw Object.assign(new Error('no'), { stderr: 'fatal: not a git repository' }); } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.files.sort(), ['a.js', 'src/lib/b.js']);
  assert.strictEqual(r.truncated, false);
});

ok('listAllFiles: un tetto alle voci, e lo dice', async (t) => {
  const root = tmp(t);
  for (let i = 0; i < 8; i++) put(root, `f${i}.txt`);
  const r = await listAllFiles({ root, max: 5, run: async () => { throw new Error('no git'); } });
  assert.strictEqual(r.files.length, 5);
  assert.strictEqual(r.truncated, true);
});

ok('listAllFiles: in un repository i tracciati e i nuovi, senza gli ignorati, relativi alla cartella', async (t) => {
  if (!hasGit()) return t.skip('git non installato su questa macchina');
  const repo = tmp(t);
  git(repo, 'init', '-q');
  put(repo, '.gitignore', 'build/\n');
  put(repo, 'app/a.js');
  put(repo, 'app/build/out.js');
  put(repo, 'app/sub/nuovo.js');
  put(repo, 'fuori.js');
  git(repo, 'add', '.gitignore', 'app/a.js', 'fuori.js');
  const r = await listAllFiles({ root: path.join(repo, 'app') });
  assert.deepStrictEqual(r.files.sort(), ['a.js', 'sub/nuovo.js']);
});

ok('listAllFiles: una radice che non esiste è un errore, non un crash', async () => {
  const r = await listAllFiles({ root: '/non/esiste/proprio' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

ok('letterOf: M, U, A, D dallo stato porcelain', () => {
  const cases = { ' M': 'M', 'M ': 'M', MM: 'M', '??': 'U', 'A ': 'A', AM: 'A', 'R ': 'A', ' D': 'D', 'D ': 'D', UU: 'M', AA: 'M', DD: 'M' };
  for (const [xy, letter] of Object.entries(cases)) assert.strictEqual(letterOf(xy), letter, JSON.stringify(xy));
});

ok('parsePorcelain: le rinomine portano il percorso vecchio, che si salta', () => {
  const out = ' M a.js\0R  nuovo.js\0vecchio.js\0?? dir/x.txt\0';
  assert.deepStrictEqual(parsePorcelain(out), [{ xy: ' M', path: 'a.js' }, { xy: 'R ', path: 'nuovo.js' }, { xy: '??', path: 'dir/x.txt' }]);
});

ok('gitStatusLetters: relative alla cartella della scheda, solo quelle sotto', async (t) => {
  if (!hasGit()) return t.skip('git non installato su questa macchina');
  const repo = tmp(t);
  git(repo, 'init', '-q');
  put(repo, 'app/a.js', 'uno');
  put(repo, 'app/b.js', 'due');
  put(repo, 'fuori.js', 'tre');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'primo');
  put(repo, 'app/a.js', 'uno cambiato');
  put(repo, 'app/sub/nuovo.js', 'x');
  put(repo, 'fuori.js', 'cambiato');
  fs.rmSync(path.join(repo, 'app', 'b.js'));
  put(repo, 'app/aggiunto.js', 'y');
  git(repo, 'add', 'app/aggiunto.js');
  const r = await gitStatusLetters({ root: path.join(repo, 'app') });
  assert.deepStrictEqual(r, { ok: true, status: { 'a.js': 'M', 'aggiunto.js': 'A', 'b.js': 'D', 'sub/nuovo.js': 'U' } });
});

ok('gitStatusLetters: fuori da un repository nessuna lettera, senza errore', async (t) => {
  const root = tmp(t);
  const r = await gitStatusLetters({ root, run: async () => { throw Object.assign(new Error('x'), { stderr: 'fatal: not a git repository (or any parent)' }); } });
  assert.deepStrictEqual(r, { ok: true, status: {} });
});
