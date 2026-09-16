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

ok('progetto: .git come file (worktree e submodule) vale quanto la directory', () => {
  const root = tmp('ais-wt-');
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /altrove/.git/worktrees/x\n');
  const sub = path.join(root, 'pacchetto');
  fs.mkdirSync(sub);

  assert.strictEqual(findProjectRoot(sub), root, 'un worktree non viene riconosciuto come progetto');
  fs.rmSync(root, { recursive: true, force: true });
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
