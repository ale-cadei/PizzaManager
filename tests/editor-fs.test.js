const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorFs, MAX_READ } = require('../lib/editor-fs');
const { resolveBinary } = require('../lib/binaries');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-editor-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

ok('createEditorFs: la cartella deve esistere ed essere una cartella', (t) => {
  const root = tmp(t);
  put(root, 'f.txt', 'x');
  assert.throws(() => createEditorFs({ root: path.join(root, 'manca') }));
  assert.throws(() => createEditorFs({ root: path.join(root, 'f.txt') }));
  assert.throws(() => createEditorFs({}));
});

ok('read: percorsi che escono si rifiutano, anche via symlink', async (t) => {
  const root = tmp(t);
  const outside = tmp(t);
  put(outside, 'secret.txt', 'segreto');
  fs.symlinkSync(outside, path.join(root, 'link'));
  const efs = createEditorFs({ root });
  for (const rel of ['../x', '/etc/passwd', 'link/secret.txt']) {
    assert.strictEqual((await efs.read(rel)).reason, 'outside', rel);
  }
  assert.strictEqual((await efs.write('link/nuovo.txt', 'x', { expectedMtime: null })).ok, false);
  assert.ok(!fs.existsSync(path.join(outside, 'nuovo.txt')));
});

ok('read: un symlink che resta dentro si segue', async (t) => {
  const root = tmp(t);
  put(root, 'src/a.js', 'ciao');
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'alias'));
  const r = await createEditorFs({ root }).read('alias/a.js');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'ciao');
  assert.strictEqual(r.path, path.join(root, 'src', 'a.js'));
});

ok('read: binari, troppo grandi, non UTF-8, mancanti, cartelle', async (t) => {
  const root = tmp(t);
  put(root, 'bin', Buffer.from([0x41, 0x00, 0x42]));
  put(root, 'big', Buffer.alloc(MAX_READ + 1, 0x41));
  put(root, 'latin1', Buffer.from([0x63, 0x61, 0x66, 0xe8]));
  fs.mkdirSync(path.join(root, 'dir'));
  const efs = createEditorFs({ root });
  assert.strictEqual((await efs.read('bin')).reason, 'binary');
  assert.strictEqual((await efs.read('big')).reason, 'too-large');
  assert.strictEqual((await efs.read('latin1')).reason, 'not-utf8');
  assert.strictEqual((await efs.read('manca.txt')).reason, 'missing');
  assert.strictEqual((await efs.read('dir')).reason, 'not-file');
});

ok('read/write: CRLF intatto, BOM tolto in lettura e rimesso in scrittura', async (t) => {
  const root = tmp(t);
  put(root, 'crlf.txt', 'a\r\nb\r\n');
  put(root, 'bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ciao')]));
  const efs = createEditorFs({ root });
  const crlf = await efs.read('crlf.txt');
  assert.strictEqual(crlf.text, 'a\r\nb\r\n');
  assert.strictEqual(crlf.bom, false);
  const bom = await efs.read('bom.txt');
  assert.strictEqual(bom.text, 'ciao');
  assert.strictEqual(bom.bom, true);
  const w = await efs.write('bom.txt', 'ciao2', { expectedMtime: bom.mtime, bom: true });
  assert.strictEqual(w.ok, true);
  assert.deepStrictEqual([...fs.readFileSync(path.join(root, 'bom.txt'))].slice(0, 3), [0xef, 0xbb, 0xbf]);
  assert.strictEqual((await efs.read('bom.txt')).text, 'ciao2');
});

ok('write: atomica, mode conservato, nessun temporaneo lasciato', async (t) => {
  const root = tmp(t);
  const p = put(root, 'secret.env', 'A=1');
  fs.chmodSync(p, 0o600);
  // Su Windows non ci sono permessi POSIX: resta 0o666, ed e' quello che si conserva.
  const mode = fs.statSync(p).mode & 0o777;
  assert.strictEqual(mode, process.platform === 'win32' ? 0o666 : 0o600);
  const efs = createEditorFs({ root });
  const r = await efs.read('secret.env');
  const w = await efs.write('secret.env', 'A=2', { expectedMtime: r.mtime });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(typeof w.mtime, 'number');
  assert.strictEqual(fs.statSync(p).mode & 0o777, mode);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'A=2');
  assert.deepStrictEqual(fs.readdirSync(root), ['secret.env']);
});

ok('write: mtime diverso sul disco = conflitto, il file non si tocca', async (t) => {
  const root = tmp(t);
  const p = put(root, 'a.txt', 'uno');
  const efs = createEditorFs({ root });
  const r = await efs.read('a.txt');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(p, later, later);
  const w = await efs.write('a.txt', 'due', { expectedMtime: r.mtime });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.conflict, true);
  assert.strictEqual(w.mtime, fs.statSync(p).mtimeMs);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'uno');
  // expectedMtime null su un file che esiste: conflitto anche quello
  assert.strictEqual((await efs.write('a.txt', 'tre', { expectedMtime: null })).conflict, true);
  // expectedMtime null su un file che non c'è: si crea
  assert.strictEqual((await efs.write('nuovo.txt', 'x', { expectedMtime: null })).ok, true);
  assert.strictEqual(fs.readFileSync(path.join(root, 'nuovo.txt'), 'utf8'), 'x');
});

ok('write: un file in sola lettura non si sovrascrive, si dice Permesso negato', async (t) => {
  // Il rename passa sopra ai permessi del file (contano quelli della cartella).
  // Su Windows 0444 non vale per chmod; root scrive comunque.
  if (process.platform === 'win32') return t.skip('permessi POSIX');
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root scrive anche sui file in sola lettura');
  const root = tmp(t);
  const p = put(root, 'ro.txt', 'uno');
  fs.chmodSync(p, 0o444);
  const efs = createEditorFs({ root });
  const r = await efs.read('ro.txt');
  const w = await efs.write('ro.txt', 'due', { expectedMtime: r.mtime });
  assert.deepStrictEqual(w, { ok: false, error: 'Permesso negato.' });
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'uno');
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o444);
  assert.deepStrictEqual(fs.readdirSync(root), ['ro.txt'], 'nessun temporaneo lasciato');
});

ok('stat: esiste o no, col suo mtime', async (t) => {
  const root = tmp(t);
  const p = put(root, 'a.txt', 'x');
  const efs = createEditorFs({ root });
  assert.deepStrictEqual(await efs.stat('a.txt'), { ok: true, exists: true, mtime: fs.statSync(p).mtimeMs });
  assert.deepStrictEqual(await efs.stat('manca.txt'), { ok: true, exists: false, mtime: null });
  assert.strictEqual((await efs.stat('../x')).ok, false);
});

ok('create, mkdir, rename: falliscono su una destinazione che esiste', async (t) => {
  const root = tmp(t);
  put(root, 'a.txt', 'x');
  put(root, 'b.txt', 'y');
  const efs = createEditorFs({ root });
  assert.deepStrictEqual(await efs.create('c.txt'), { ok: true });
  assert.strictEqual(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), '');
  const dup = await efs.create('a.txt');
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.error, 'Esiste già un file o una cartella con quel nome.');
  assert.deepStrictEqual(await efs.mkdir('src'), { ok: true });
  assert.strictEqual((await efs.mkdir('src')).ok, false);
  assert.strictEqual((await efs.rename('a.txt', 'b.txt')).ok, false);
  assert.strictEqual(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'y');
  assert.deepStrictEqual(await efs.rename('a.txt', 'z.txt'), { ok: true, rel: 'z.txt' });
  put(root, 'src/x.js', '');
  assert.deepStrictEqual(await efs.rename('src/x.js', 'y.js'), { ok: true, rel: 'src/y.js' });
  assert.strictEqual((await efs.rename('z.txt', 'a/b')).error, 'Nome non valido.');
  assert.strictEqual((await efs.create('src/..')).ok, false);
  assert.strictEqual((await efs.rename('', 'x')).ok, false);
});

ok('list: cartelle prima, ordine naturale, .git nascosta', async (t) => {
  const root = tmp(t);
  for (const f of ['f10.txt', 'f2.txt', 'B.txt', 'a.txt']) put(root, f, '');
  fs.mkdirSync(path.join(root, 'zdir'));
  fs.mkdirSync(path.join(root, '.git'));
  const r = await createEditorFs({ root }).list('');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.entries.map((e) => `${e.kind}:${e.name}`),
    ['dir:zdir', 'file:a.txt', 'file:B.txt', 'file:f2.txt', 'file:f10.txt']);
  assert.ok(r.entries.every((e) => e.ignored === false));
  assert.strictEqual((await createEditorFs({ root }).list('manca')).ok, false);
});

ok('list: ignored lo dice git, dentro un repository', async (t) => {
  if (!resolveBinary('git').path) return t.skip('git non installato su questa macchina');
  const root = tmp(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  put(root, '.gitignore', 'build/\n*.log\n');
  put(root, 'build/out.js', '');
  put(root, 'a.log', '');
  put(root, 'b.js', '');
  const r = await createEditorFs({ root }).list('');
  const ignored = Object.fromEntries(r.entries.map((e) => [e.name, e.ignored]));
  assert.deepStrictEqual(ignored, { build: true, '.gitignore': false, 'a.log': true, 'b.js': false });
});

ok('trashTarget: la voce stessa, mai la radice', (t) => {
  const root = tmp(t);
  put(root, 'a.txt', '');
  const efs = createEditorFs({ root });
  assert.deepStrictEqual(efs.trashTarget('a.txt'), { ok: true, path: path.join(root, 'a.txt') });
  assert.strictEqual(efs.trashTarget('').ok, false);
  assert.strictEqual(efs.trashTarget('manca').ok, false);
  assert.strictEqual(efs.trashTarget('../x').ok, false);
});
