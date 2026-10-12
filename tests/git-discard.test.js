const assert = require('node:assert');
const { test: ok } = require('node:test');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Scartare le modifiche non staged di un file, e annullare (docs/plans/56).
   I file stanno su disco in una cartella temporanea; git è finto: risponde
   allo stato delle sezioni, salva i blob in una mappa e `restore` scrive il
   contenuto dell'indice. Il caso con git vero sta in tests/integration.test.js. */
const D = require('../lib/git-discard');

const NUL = '\0';
const z = (...parts) => parts.join(NUL) + NUL;
const noBusy = () => false;
const fail = (code, stderr) => Object.assign(new Error(`exit ${code}`), { code, stderr, stdout: '' });
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

/**
 * `work`/`others`: le risposte di `diff --name-status` e `ls-files`;
 * `index`: il contenuto nell'indice dei file tracciati, quello che `restore` rimette.
 */
function fakeRepo({ work = '', others = '', index = {}, merging = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-discard-')));
  const objects = new Map();
  const calls = [];
  const file = (rel) => path.join(root, rel);
  const run = async (args, opts = {}) => {
    calls.push({ args, opts });
    if (args.includes('--show-toplevel')) return `${root}\n`;
    if (args.includes('MERGE_HEAD')) { if (merging) return 'deadbeef\n'; throw fail(1, ''); }
    if (args.includes('--git-path')) return '.git/rebase-merge\n.git/rebase-apply\n';
    if (args.includes('--verify')) return 'abc1234\n';
    if (args.includes('ls-files')) return others;
    if (args.includes('diff') && args.includes('--name-status')) return work;
    if (args[0] === 'hash-object') {
      const buf = fs.readFileSync(file(args[args.length - 1]));
      if (args.includes('-w')) objects.set(blobSha(buf), buf);
      return `${blobSha(buf)}\n`;
    }
    if (args.includes('restore')) {
      const rel = args[args.length - 1];
      fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
      // Come git: un collegamento si sostituisce, non si scrive attraverso
      fs.rmSync(file(rel), { force: true });
      fs.writeFileSync(file(rel), index[rel]);
      return '';
    }
    if (args[0] === 'cat-file' && args[1] === '-t') {
      if (objects.has(args[2])) return 'blob\n';
      throw fail(128, `fatal: Not a valid object name ${args[2]}`);
    }
    if (args[0] === 'cat-file') return opts.buffer ? objects.get(args[2]) : String(objects.get(args[2]));
    throw new Error(`git ${args.join(' ')} non previsto`);
  };
  const writes = () => calls.filter((c) => c.args.includes('restore') || c.args.includes('-w'));
  const done = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, run, calls, objects, file, writes, done, exists: noBusy };
}

const opts = (repo, extra) => ({ cwd: repo.root, run: repo.run, exists: repo.exists, ...extra });

ok('scarta: un file modificato torna com\'è nell\'indice, e Annulla lo rimette con i permessi', async () => {
  const repo = fakeRepo({ work: z('M', 'lib/a.js'), index: { 'lib/a.js': 'indice\n' } });
  try {
    fs.mkdirSync(repo.file('lib'));
    fs.writeFileSync(repo.file('lib/a.js'), 'dell\'agente\n', { mode: 0o755 });
    fs.chmodSync(repo.file('lib/a.js'), 0o755);
    const r = await D.discardFile(opts(repo, { path: 'lib/a.js' }));
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.untracked, false);
    assert.strictEqual(fs.readFileSync(repo.file('lib/a.js'), 'utf8'), 'indice\n');
    assert.ok(repo.calls.some((c) => c.args.join(' ') === '--literal-pathspecs restore --worktree -- lib/a.js'));
    assert.ok(repo.calls.every((c) => c.opts.cwd === repo.root), 'tutto dalla radice');
    const saved = Buffer.from('dell\'agente\n');
    assert.deepStrictEqual(r.undo, { path: 'lib/a.js', blob: blobSha(saved), mode: 0o755, after: blobSha(Buffer.from('indice\n')) });
    assert.ok(repo.objects.has(r.undo.blob), 'il contenuto è salvato in git prima di scartare');

    fs.chmodSync(repo.file('lib/a.js'), 0o644);
    assert.deepStrictEqual(await D.undoDiscard(opts(repo, { token: r.undo })), { ok: true, path: 'lib/a.js' });
    assert.strictEqual(fs.readFileSync(repo.file('lib/a.js'), 'utf8'), 'dell\'agente\n');
    assert.strictEqual(fs.statSync(repo.file('lib/a.js')).mode & 0o777, 0o755);
  } finally {
    repo.done();
  }
});

ok('scarta: un file non tracciato si cancella, Annulla lo ricrea', async () => {
  const repo = fakeRepo({ others: z('nuovo.txt') });
  try {
    fs.writeFileSync(repo.file('nuovo.txt'), Buffer.from([0, 1, 2, 255]));
    const r = await D.discardFile(opts(repo, { path: 'nuovo.txt' }));
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.untracked, true);
    assert.ok(!fs.existsSync(repo.file('nuovo.txt')));
    assert.strictEqual(r.undo.after, null);
    assert.ok(!repo.calls.some((c) => c.args.includes('restore')), 'un non tracciato git non lo rimette');
    assert.strictEqual((await D.undoDiscard(opts(repo, { token: r.undo }))).ok, true);
    assert.deepStrictEqual(fs.readFileSync(repo.file('nuovo.txt')), Buffer.from([0, 1, 2, 255]), 'byte per byte');
  } finally {
    repo.done();
  }
});

ok('scarta: un file cancellato torna; Annulla lo ricancella', async () => {
  const repo = fakeRepo({ work: z('D', 'via.txt'), index: { 'via.txt': 'c\'era\n' } });
  try {
    const r = await D.discardFile(opts(repo, { path: 'via.txt' }));
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(fs.readFileSync(repo.file('via.txt'), 'utf8'), 'c\'era\n');
    assert.strictEqual(r.undo.blob, null, 'prima non c\'era');
    assert.strictEqual((await D.undoDiscard(opts(repo, { token: r.undo }))).ok, true);
    assert.ok(!fs.existsSync(repo.file('via.txt')));
  } finally {
    repo.done();
  }
});

ok('scarta: Annulla rifiuta se il file è cambiato dopo lo scarto, e non lo tocca', async () => {
  const repo = fakeRepo({ work: z('M', 'a.js'), index: { 'a.js': 'indice\n' } });
  try {
    fs.writeFileSync(repo.file('a.js'), 'prima\n');
    const r = await D.discardFile(opts(repo, { path: 'a.js' }));
    fs.writeFileSync(repo.file('a.js'), 'l\'agente ci ha riscritto\n');
    const u = await D.undoDiscard(opts(repo, { token: r.undo }));
    assert.strictEqual(u.ok, false);
    assert.match(u.error, /a\.js è cambiato dopo lo scarto/);
    assert.strictEqual(fs.readFileSync(repo.file('a.js'), 'utf8'), 'l\'agente ci ha riscritto\n');
    // Cancellato dopo lo scarto: è cambiato anche questo
    fs.rmSync(repo.file('a.js'));
    assert.strictEqual((await D.undoDiscard(opts(repo, { token: r.undo }))).ok, false);
    assert.ok(!fs.existsSync(repo.file('a.js')));
  } finally {
    repo.done();
  }
});

ok('scarta: percorsi non validi, o non più fra i non staged, non arrivano a git', async () => {
  const repo = fakeRepo({ work: z('M', 'a.js'), index: { 'a.js': 'x' } });
  try {
    for (const bad of ['../fuori', '/etc/passwd', '', undefined, 42, 'a\0b']) {
      const r = await D.discardFile(opts(repo, { path: bad }));
      assert.strictEqual(r.ok, false, JSON.stringify(bad));
    }
    const gone = await D.discardFile(opts(repo, { path: 'sparito.js' }));
    assert.strictEqual(gone.ok, false);
    assert.match(gone.error, /sparito\.js non è più fra le modifiche non staged/);
    assert.deepStrictEqual(repo.writes(), []);
  } finally {
    repo.done();
  }
});

ok('scarta: con un merge a metà non si scrive', async () => {
  const repo = fakeRepo({ work: z('M', 'a.js'), index: { 'a.js': 'x' }, merging: true });
  try {
    fs.writeFileSync(repo.file('a.js'), 'y');
    const r = await D.discardFile(opts(repo, { path: 'a.js' }));
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /merge a metà/);
    assert.deepStrictEqual(repo.writes(), []);
    assert.strictEqual(fs.readFileSync(repo.file('a.js'), 'utf8'), 'y');
  } finally {
    repo.done();
  }
});

ok('scarta: un non tracciato che non è un file vero resta dov\'è', async () => {
  const repo = fakeRepo({ others: z('link', 'cartella') });
  try {
    fs.symlinkSync('/etc/hostname', repo.file('link'));
    fs.mkdirSync(repo.file('cartella'));
    for (const rel of ['link', 'cartella']) {
      const r = await D.discardFile(opts(repo, { path: rel }));
      assert.strictEqual(r.ok, false, rel);
      assert.match(r.error, /dal terminale/);
    }
    assert.ok(fs.lstatSync(repo.file('link')).isSymbolicLink());
    assert.ok(fs.existsSync(repo.file('cartella')));
  } finally {
    repo.done();
  }
});

ok('scarta: un tracciato che è un collegamento si scarta, ma senza Annulla', async () => {
  const repo = fakeRepo({ work: z('M', 'link'), index: { link: 'file vero\n' } });
  try {
    fs.symlinkSync('/etc/hostname', repo.file('link'));
    const r = await D.discardFile(opts(repo, { path: 'link' }));
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.undo, null);
    assert.ok(!repo.calls.some((c) => c.args.includes('-w')), 'niente da salvare: sarebbe il bersaglio');
  } finally {
    repo.done();
  }
});

ok('scarta: un gettone non valido non scrive niente', async () => {
  const repo = fakeRepo();
  try {
    fs.writeFileSync(repo.file('a.js'), 'adesso\n');
    const now = blobSha(Buffer.from('adesso\n'));
    const good = { path: 'a.js', blob: 'a'.repeat(40), mode: 0o644, after: now };
    const bad = [
      null, 'a.js', {}, { ...good, path: '../a.js' }, { ...good, path: '/etc/passwd' },
      { ...good, blob: 'xyz' }, { ...good, blob: '-p' }, { ...good, after: 'HEAD' },
      { ...good, mode: 0o4755 }, { ...good, mode: '644' }, { ...good, blob: null, after: null },
    ];
    for (const token of bad) {
      const r = await D.undoDiscard(opts(repo, { token }));
      assert.strictEqual(r.ok, false, JSON.stringify(token));
    }
    // Ben fatto ma con un blob che git non ha: rifiutato, file intatto
    const missing = await D.undoDiscard(opts(repo, { token: good }));
    assert.strictEqual(missing.ok, false);
    assert.match(missing.error, /non c'è più in git/);
    assert.strictEqual(fs.readFileSync(repo.file('a.js'), 'utf8'), 'adesso\n');
  } finally {
    repo.done();
  }
});

ok('scarta: Annulla non scrive fuori dal repository passando da un collegamento', async () => {
  const repo = fakeRepo();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-fuori-')));
  try {
    fs.symlinkSync(outside, repo.file('esce'));
    fs.writeFileSync(path.join(outside, 'x'), 'di fuori\n');
    const token = { path: 'esce/x', blob: 'b'.repeat(40), mode: 0o644, after: blobSha(Buffer.from('di fuori\n')) };
    const r = await D.undoDiscard(opts(repo, { token }));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(fs.readFileSync(path.join(outside, 'x'), 'utf8'), 'di fuori\n');
  } finally {
    repo.done();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
