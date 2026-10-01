const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* I file che git non porta nel worktree (docs/plans/36-sessione-worktree.md):
   node_modules in symlink, e quello che elenca .worktreeinclude copiato. Sul
   filesystem vero di una tmpdir; git finto, perché cosa è ignorato lo decide
   lui (il caso con git vero sta in tests/integration.test.js). */
const { linkIgnored } = require('../lib/worktree-files');

const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

function layout() {
  const base = tmp('ais-wtf-');
  const root = path.join(base, 'progetto');
  const dir = path.join(base, 'progetto.worktrees', 'feat-x');
  const exclude = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  return { base, root, dir, exclude, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

// check-ignore esce con 1 quando niente è ignorato
const gitError = () => Object.assign(new Error('Command failed: git'), { stderr: '', code: 1 });

/**
 * Un git finto: `listed` è l'output di ls-files sui pattern di
 * .worktreeinclude, `ignored` i percorsi che check-ignore dice ignorati
 * (tutti, se non indicato), `exclude` dove sta info/exclude.
 */
function fakeGit({ listed = '', ignored = null, exclude, failList = false } = {}) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    if (args[0] === 'ls-files') {
      if (failList) throw new Error('git esploso');
      return listed;
    }
    if (args.includes('check-ignore')) {
      const asked = args.slice(args.indexOf('--') + 1);
      const hit = asked.filter((p) => (ignored ? ignored.includes(p) : true));
      if (!hit.length) throw gitError();
      return hit.map((p) => `${p}\n`).join('');
    }
    if (args[0] === 'rev-parse' && args.includes('info/exclude')) return `${exclude}\n`;
    throw new Error(`inatteso: ${args.join(' ')}`);
  };
  return { run, calls };
}

ok('worktree-files: node_modules del progetto arriva nel worktree come symlink', async () => {
  const { root, dir, exclude, done } = layout();
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'a.js'), 'x');

  const warnings = await linkIgnored({ root, dir, run: fakeGit({ exclude }).run });
  assert.deepStrictEqual(warnings, []);
  const link = path.join(dir, 'node_modules');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'node_modules copiato invece che collegato');
  assert.strictEqual(fs.readFileSync(path.join(link, 'pkg', 'a.js'), 'utf8'), 'x');

  // Buttare il worktree non deve toccare le dipendenze del progetto
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(fs.existsSync(path.join(root, 'node_modules', 'pkg', 'a.js')), 'node_modules del progetto cancellato');
  done();
});

/* `node_modules/` nel .gitignore vale solo per le cartelle: il symlink
   resterebbe un file nuovo, il worktree sembrerebbe sempre «con modifiche» e
   un `git add -A` dell'agente lo committerebbe */
ok('worktree-files: se git non ignora il symlink, lo si esclude in info/exclude (una volta sola)', async () => {
  const { root, dir, exclude, done } = layout();
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(exclude, '# git ls-files --others --exclude-from=.git/info/exclude\n');
  const git = fakeGit({ ignored: [], exclude });

  assert.deepStrictEqual(await linkIgnored({ root, dir, run: git.run }), []);
  const checked = git.calls.find((c) => c.args.includes('check-ignore'));
  assert.strictEqual(checked.cwd, dir, 'chiesto a git fuori dal worktree');
  assert.match(fs.readFileSync(exclude, 'utf8'), /^\/node_modules$/m);

  // Una seconda volta (altro worktree) la riga non si ripete
  fs.rmSync(path.join(dir, 'node_modules'));
  await linkIgnored({ root, dir, run: git.run });
  assert.strictEqual(fs.readFileSync(exclude, 'utf8').match(/^\/node_modules$/gm).length, 1);
  done();
});

ok('worktree-files: se il progetto ignora già il symlink, info/exclude non si tocca', async () => {
  const { root, dir, exclude, done } = layout();
  fs.mkdirSync(path.join(root, 'node_modules'));
  await linkIgnored({ root, dir, run: fakeGit({ exclude }).run });
  assert.ok(!fs.existsSync(exclude), 'info/exclude scritto senza motivo');
  done();
});

ok('worktree-files: senza node_modules nel progetto, o se il worktree ce l\'ha già, non si collega niente', async () => {
  const { root, dir, exclude, done } = layout();
  const git = fakeGit({ exclude });
  assert.deepStrictEqual(await linkIgnored({ root, dir, run: git.run }), []);
  assert.ok(!fs.existsSync(path.join(dir, 'node_modules')));
  assert.deepStrictEqual(git.calls, [], 'git chiamato senza niente da fare');

  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  assert.deepStrictEqual(await linkIgnored({ root, dir, run: git.run }), []);
  assert.ok(!fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink(), 'sostituito il node_modules del worktree');
  done();
});

ok('worktree-files: su Windows il collegamento è una junction (non chiede privilegi)', async () => {
  const { root, dir, exclude, done } = layout();
  fs.mkdirSync(path.join(root, 'node_modules'));
  const made = [];
  await linkIgnored({ root, dir, run: fakeGit({ exclude }).run, platform: 'win32', symlink: (target, link, type) => made.push(type) });
  assert.deepStrictEqual(made, ['junction']);
  done();
});

ok('worktree-files: .worktreeinclude copia i file elencati e ignorati, con i loro permessi', async () => {
  const { root, dir, exclude, done } = layout();
  fs.writeFileSync(path.join(root, '.worktreeinclude'), '.env\nconfig/\n');
  fs.writeFileSync(path.join(root, '.env'), 'SEGRETO=1\n', { mode: 0o600 });
  fs.chmodSync(path.join(root, '.env'), 0o600);
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'local.json'), '{}');
  fs.writeFileSync(path.join(root, 'config', 'nuovo.json'), '{}');
  // config/nuovo.json corrisponde a .worktreeinclude ma git non lo ignora:
  // copiato, renderebbe il worktree «con modifiche» (come fa Claude Code, si salta)
  const git = fakeGit({ exclude, listed: '.env\0config/local.json\0config/nuovo.json\0node_modules/pkg/a.js\0', ignored: ['.env', 'config/local.json'] });

  const warnings = await linkIgnored({ root, dir, run: git.run });
  assert.deepStrictEqual(warnings, []);
  const listing = git.calls.find((c) => c.args[0] === 'ls-files');
  assert.deepStrictEqual(listing.args.slice(0, 4), ['ls-files', '--others', '--ignored', `--exclude-from=${path.join(root, '.worktreeinclude')}`]);
  assert.strictEqual(listing.cwd, root);
  const checked = git.calls.filter((c) => c.args.includes('check-ignore') && c.args.includes('.env'));
  assert.deepStrictEqual(checked.map((c) => c.cwd), [dir], 'ignorato chiesto fuori dal worktree');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'SEGRETO=1\n');
  assert.strictEqual(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600, 'il .env copiato è leggibile da tutti');
  assert.ok(fs.existsSync(path.join(dir, 'config', 'local.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'config', 'nuovo.json')), 'copiato un file che git non ignora');
  assert.ok(!fs.existsSync(path.join(dir, 'node_modules')), 'node_modules copiato file per file');
  done();
});

ok('worktree-files: un percorso che esce dal progetto non si copia', async () => {
  const { base, root, dir, exclude, done } = layout();
  fs.writeFileSync(path.join(root, '.worktreeinclude'), '*\n');
  fs.writeFileSync(path.join(base, 'fuori'), 'no');
  const git = fakeGit({ exclude, listed: `../fuori\0${path.join(base, 'fuori')}\0` });

  await linkIgnored({ root, dir, run: git.run });
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'copiato qualcosa da fuori dal progetto');
  done();
});

ok('worktree-files: un file che non si copia diventa un avviso, gli altri passano', async () => {
  const { root, dir, exclude, done } = layout();
  fs.writeFileSync(path.join(root, '.worktreeinclude'), '.env*\n');
  fs.writeFileSync(path.join(root, '.env'), 'a');

  const warnings = await linkIgnored({ root, dir, run: fakeGit({ exclude, listed: '.env.sparito\0.env\0' }).run });
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /\.env\.sparito/);
  assert.ok(fs.existsSync(path.join(dir, '.env')));
  done();
});

ok('worktree-files: se git non risponde, avviso e nessuna copia', async () => {
  const { root, dir, exclude, done } = layout();
  fs.writeFileSync(path.join(root, '.worktreeinclude'), '.env\n');
  const warnings = await linkIgnored({ root, dir, run: fakeGit({ exclude, failList: true }).run });
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /worktreeinclude/);
  done();
});
