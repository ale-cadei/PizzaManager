const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Dove parte davvero una sessione, e se è stata spostata
   (docs/plans/36-sessione-worktree.md, passo 7): una conversazione nata in un
   worktree poi tolto riparte nella cartella del progetto, e la scheda lo dice
   (l'agente potrebbe credersi ancora sul branch del worktree). */
const { describeWorkdir, resolveWorkdir } = require('../lib/workdir');
const { worktreeProjectDir, CONTAINER_SUFFIX } = require('../lib/worktree-path');

const home = path.resolve('/home/tizio');
const progetto = path.join(home, 'src', 'progetto');
const tolto = path.join(home, 'src', `progetto${CONTAINER_SUFFIX}`, 'feat-x');

ok('worktree-path: il progetto di una cartella dentro <progetto>.worktrees, anche da una sottocartella', () => {
  assert.strictEqual(worktreeProjectDir(tolto), progetto);
  assert.strictEqual(worktreeProjectDir(path.join(tolto, 'src', 'deep')), progetto);
  assert.strictEqual(worktreeProjectDir(progetto), null);
  assert.strictEqual(worktreeProjectDir(path.join(home, '.worktrees', 'x')), null, 'un nome fatto solo del suffisso non è un progetto');
  assert.strictEqual(worktreeProjectDir(''), null);
  assert.strictEqual(worktreeProjectDir('C:\\src\\progetto.worktrees\\feat-x', { pathImpl: path.win32 }), 'C:\\src\\progetto');
});

ok('workdir: un worktree che non c è più riparte nella cartella del progetto, e lo dice', () => {
  const isDir = (p) => p === home || p === progetto;
  assert.deepStrictEqual(describeWorkdir(tolto, { home, isDir }), { dir: progetto, moved: 'worktree', requested: tolto });
  assert.deepStrictEqual(describeWorkdir(path.join(tolto, 'src'), { home, isDir }).dir, progetto);
  assert.strictEqual(resolveWorkdir(tolto, { home, isDir }), progetto);
});

ok('workdir: una cartella sparita finisce nella home e lo dice; una vuota no', () => {
  const isDir = (p) => p === home;
  assert.deepStrictEqual(describeWorkdir('/non/esiste', { home, isDir }), { dir: home, moved: 'missing', requested: path.resolve('/non/esiste') });
  assert.deepStrictEqual(describeWorkdir(tolto, { home, isDir }).moved, 'missing', 'progetto sparito anche lui');
  assert.deepStrictEqual(describeWorkdir('', { home, isDir }), { dir: home, moved: null, requested: null });
  assert.deepStrictEqual(describeWorkdir(progetto, { home, isDir: () => true }), { dir: progetto, moved: null, requested: progetto });
});
