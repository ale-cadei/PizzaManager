const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* La radice del "progetto" di una sessione: la directory che contiene .git,
   risalendo dalla directory di lavoro. Senza .git il progetto è la directory
   stessa, così nessuna sessione resta senza gruppo. */
const { findProjectRoot } = require('../lib/project-root');

// realpathSync: su macOS os.tmpdir() è /var/... che è un symlink a /private/var
const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

ok('progetto: la radice è la directory con .git, anche da una sottocartella profonda', () => {
  const root = tmp('ais-repo-');
  fs.mkdirSync(path.join(root, '.git'));
  const deep = path.join(root, 'src', 'renderer', 'parts');
  fs.mkdirSync(deep, { recursive: true });

  assert.strictEqual(findProjectRoot(deep), root, 'la risalita non trova il repo');
  assert.strictEqual(findProjectRoot(root), root, 'la radice stessa non si riconosce');
  fs.rmSync(root, { recursive: true, force: true });
});

ok('progetto: .git come file vale quanto la directory, se il repository a cui punta non si legge', () => {
  const root = tmp('ais-wt-');
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /altrove/.git/worktrees/x\n');
  const sub = path.join(root, 'pacchetto');
  fs.mkdirSync(sub);

  assert.strictEqual(findProjectRoot(sub), root, 'un worktree non viene riconosciuto come progetto');
  fs.rmSync(root, { recursive: true, force: true });
});

/* Il layout che crea `git worktree add`: nel worktree `.git` è un file che
   punta a <principale>/.git/worktrees/<nome>, e lì `commondir` rimanda alla
   directory comune. Il worktree appartiene al progetto principale
   (docs/plans/36-sessione-worktree.md). */
function makeWorktreeLayout(gitdirLine) {
  const base = tmp('ais-wtl-');
  const main = path.join(base, 'progetto');
  const wt = path.join(base, 'progetto.worktrees', 'feat-x');
  const admin = path.join(main, '.git', 'worktrees', 'feat-x');
  fs.mkdirSync(admin, { recursive: true });
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdirLine(admin, wt)}\n`);
  return { base, main, wt };
}

ok('progetto: un worktree appartiene al progetto principale', () => {
  const { base, main, wt } = makeWorktreeLayout((admin) => admin);

  assert.strictEqual(findProjectRoot(wt), main, 'il worktree fa gruppo a sé');
  assert.strictEqual(findProjectRoot(path.join(wt, 'src')), main, 'da una sottocartella del worktree');
  assert.strictEqual(findProjectRoot(main), main, 'il progetto principale resta sé stesso');
  fs.rmSync(base, { recursive: true, force: true });
});

ok('progetto: gitdir relativo (worktree.useRelativePaths) porta allo stesso progetto', () => {
  const { base, main, wt } = makeWorktreeLayout((admin, from) => path.relative(from, admin));

  assert.strictEqual(findProjectRoot(wt), main);
  fs.rmSync(base, { recursive: true, force: true });
});

ok('progetto: un submodule resta un progetto a sé', () => {
  const base = tmp('ais-sub-');
  const main = path.join(base, 'progetto');
  const modules = path.join(main, '.git', 'modules', 'lib');
  const sub = path.join(main, 'vendor', 'lib');
  fs.mkdirSync(modules, { recursive: true });
  fs.mkdirSync(sub, { recursive: true });
  // Il submodule punta a .git/modules/<x>, che non ha `commondir`
  fs.writeFileSync(path.join(sub, '.git'), `gitdir: ${modules}\n`);

  assert.strictEqual(findProjectRoot(sub), sub, 'il submodule è finito nel progetto che lo contiene');
  fs.rmSync(base, { recursive: true, force: true });
});

ok('progetto: un .git file illeggibile o strano lascia la cartella com\'è', () => {
  const at = (p) => p === '/w/feat/.git';
  const cases = {
    spazzatura: () => 'non sono un file git',
    'commondir verso un repository bare': (f) => (f.endsWith('.git') ? 'gitdir: /srv/bare.git/worktrees/feat\n' : '..\n'),
    'permessi negati': () => { throw new Error('EACCES: permission denied'); },
  };
  for (const [name, readFile] of Object.entries(cases)) {
    assert.strictEqual(findProjectRoot('/w/feat', { exists: at, readFile }), '/w/feat', name);
  }
});

ok('progetto: senza .git fino alla radice del filesystem vale la directory di partenza', () => {
  assert.strictEqual(findProjectRoot('/home/tizio/note', { exists: () => false }), '/home/tizio/note');
  assert.strictEqual(findProjectRoot('/home/tizio/note/', { exists: () => false }), '/home/tizio/note',
    'lo slash finale non viene normalizzato');
  assert.strictEqual(findProjectRoot('/', { exists: () => false }), '/');
});

ok('progetto: input inutilizzabile non produce un gruppo fantasma', () => {
  for (const v of [null, undefined, '', '   ', 'relativo/senza/slash', 42]) {
    assert.strictEqual(findProjectRoot(v, { exists: () => false }), null, `accettato ${JSON.stringify(v)}`);
  }
});

ok('progetto: un errore del filesystem non fa saltare la risalita', () => {
  const boom = () => { throw new Error('EACCES: permission denied'); };
  assert.strictEqual(findProjectRoot('/opt/segreto/lavoro', { exists: boom }), '/opt/segreto/lavoro');
});

ok('progetto: la cartella di un worktree tolto appartiene ancora al suo progetto', () => {
  const git = new Set(['/src/progetto/.git']);
  const exists = (p) => git.has(p);
  const pathImpl = path.posix;
  assert.strictEqual(findProjectRoot('/src/progetto.worktrees/feat-x/src', { exists, pathImpl }), '/src/progetto');
  // Se anche il progetto non c'è (o non è un repository) vale la cartella com'è
  assert.strictEqual(findProjectRoot('/src/altro.worktrees/feat-x', { exists, pathImpl }), '/src/altro.worktrees/feat-x');
});
