const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorCopy, numberedName, pickProperties, MAX_FILES, MAX_BYTES } = require('../lib/editor-copy');

/* Una radice (la cartella della sessione), una cartella «fuori» coi
   sorgenti, e un cestino finto che sposta invece di cancellare. */
function setup(t, opts = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-copy-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  const out = path.join(base, 'fuori');
  const bin = path.join(base, 'cestino');
  for (const d of [root, out, bin]) fs.mkdirSync(d);
  const trashed = [];
  const trash = async (p) => { trashed.push(p); fs.renameSync(p, path.join(bin, `${trashed.length}-${path.basename(p)}`)); };
  // Il disco e' quello vero: il platform deve essere il suo (su Windows i percorsi sono C:\...).
  const copy = createEditorCopy({ editorFs: createEditorFs({ root }), trash, platform: process.platform, ...opts });
  const write = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  return { root, out, trashed, copy, write };
}

ok('numberedName: il numero prima dell estensione, non nei file col punto davanti né nelle cartelle', () => {
  assert.strictEqual(numberedName('a.txt', 2, false), 'a (2).txt');
  assert.strictEqual(numberedName('a.tar.gz', 3, false), 'a.tar (3).gz');
  assert.strictEqual(numberedName('.env', 2, false), '.env (2)');
  assert.strictEqual(numberedName('Makefile', 2, false), 'Makefile (2)');
  assert.strictEqual(numberedName('v1.2', 2, true), 'v1.2 (2)');
  assert.deepStrictEqual(pickProperties('linux'), ['openFile', 'multiSelections']);
  assert.deepStrictEqual(pickProperties('darwin'), ['openFile', 'openDirectory', 'multiSelections']);
  assert.strictEqual(MAX_FILES, 10000);
  assert.strictEqual(MAX_BYTES, 1024 ** 3);
});

ok('planCopy: file e cartelle senza conflitti, contati ricorsivamente, senza scrivere', async (t) => {
  const { root, out, copy, write } = setup(t);
  const a = write(path.join(out, 'a.txt'), 'ciao');
  write(path.join(out, 'd', 'x.txt'), '12345');
  write(path.join(out, 'd', 'sub', 'y.txt'), '1');
  const plan = await copy.planCopy([a, path.join(out, 'd')], '');
  assert.deepStrictEqual(plan, {
    ok: true,
    items: [{ name: 'a.txt', kind: 'file' }, { name: 'd', kind: 'dir' }],
    conflicts: [],
    count: 5, // a.txt, d, d/x.txt, d/sub, d/sub/y.txt
    bytes: 10,
  });
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

ok('planCopy: i conflitti sono quelli di primo livello e dicono cosa c è già', async (t) => {
  const { root, out, copy, write } = setup(t);
  write(path.join(root, 'src', 'a.txt'));
  fs.mkdirSync(path.join(root, 'src', 'd'));
  write(path.join(out, 'd', 'x.txt'));
  const sources = [write(path.join(out, 'a.txt')), path.join(out, 'd'), write(path.join(out, 'b.txt'))];
  const plan = await copy.planCopy(sources, 'src');
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.conflicts, [
    { name: 'a.txt', kind: 'file', existingKind: 'file' },
    { name: 'd', kind: 'dir', existingKind: 'dir' },
  ]);
});

ok('planCopy: destinazione fuori dalla radice, inesistente o file si rifiuta', async (t) => {
  const { root, out, copy, write } = setup(t);
  const a = write(path.join(out, 'a.txt'));
  write(path.join(root, 'f.txt'));
  assert.strictEqual((await copy.planCopy([a], '../fuori')).ok, false);
  fs.symlinkSync(out, path.join(root, 'link'));
  assert.deepStrictEqual(await copy.planCopy([a], 'link'), { ok: false, error: 'Il percorso esce dalla cartella della sessione.' });
  assert.deepStrictEqual(await copy.planCopy([a], 'f.txt'), { ok: false, error: 'La destinazione non è una cartella.' });
  assert.deepStrictEqual(await copy.planCopy([a], 'manca'), { ok: false, error: 'La destinazione non è una cartella.' });
  assert.deepStrictEqual(await copy.planCopy([a], 42), { ok: false, error: 'La destinazione non è una cartella.' });
});

ok('planCopy: sorgenti mancanti, relativi, inesistenti, troppi o la radice del disco si rifiutano', async (t) => {
  const { out, copy } = setup(t);
  for (const sources of [undefined, [], 'a', [42], ['relativo.txt']]) {
    assert.strictEqual((await copy.planCopy(sources, '')).ok, false, JSON.stringify(sources));
  }
  assert.deepStrictEqual(await copy.planCopy([], ''), { ok: false, error: 'Niente da copiare.' });
  assert.deepStrictEqual(await copy.planCopy(['relativo.txt'], ''), { ok: false, error: 'Percorso non valido.' });
  assert.deepStrictEqual(await copy.planCopy([path.join(out, 'no.txt')], ''), { ok: false, error: '«no.txt» non esiste più.' });
  assert.deepStrictEqual(await copy.planCopy(['/'], ''), { ok: false, error: 'Non si copia la radice di un disco.' });
  const many = Array.from({ length: 1001 }, (_, i) => path.join(out, `f${i}`));
  assert.deepStrictEqual(await copy.planCopy(many, ''), { ok: false, error: 'Troppi elementi: più di 1000.' });
});

ok('planCopy: due sorgenti con lo stesso nome si rifiutano; lo stesso percorso due volte conta una', async (t) => {
  const { out, copy, write } = setup(t);
  const a = write(path.join(out, 'x', 'a.txt'));
  const b = write(path.join(out, 'y', 'a.txt'));
  assert.deepStrictEqual(await copy.planCopy([a, b], ''), { ok: false, error: 'Due elementi si chiamano «a.txt»: copiali uno alla volta.' });
  assert.deepStrictEqual((await copy.planCopy([a, a + '/'], '')).items, [{ name: 'a.txt', kind: 'file' }]);
});

ok('planCopy: una cartella non si copia dentro se stessa né in una sua sottocartella', async (t) => {
  const { root, copy, write } = setup(t);
  write(path.join(root, 'd', 'sub', 'x.txt'));
  const d = path.join(root, 'd');
  assert.deepStrictEqual(await copy.planCopy([d], 'd/sub'), { ok: false, error: '«d» non si copia dentro se stessa.' });
  assert.deepStrictEqual(await copy.planCopy([d], 'd'), { ok: false, error: '«d» non si copia dentro se stessa.' });
  assert.strictEqual((await copy.planCopy([path.join(d, 'sub')], '')).ok, true, 'una sottocartella verso la radice va bene');
});

/* Sul runner della CI la cartella temporanea e' C:\Users\RUNNER~1\...: un
   nome corto 8.3. realpathSync lo lascia corto, realpath nativo lo allunga,
   e i due lati del controllo non si riconoscevano piu'. */
ok('planCopy e runCopy: «dentro se stessa» regge anche con la sessione aperta da un nome corto 8.3', async (t) => {
  if (process.platform !== 'win32') return t.skip('nomi 8.3 solo su Windows');
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-copy-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const longRoot = path.join(base, 'cartella con nome lungo');
  fs.mkdirSync(path.join(longRoot, 'd', 'd', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(longRoot, 'd', 'd', 'sub', 'x.txt'), 'x');
  const shortRoot = execFileSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${longRoot}") do @echo %~sI`],
    { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
  if (shortRoot.toLowerCase() === longRoot.toLowerCase()) return t.skip('il volume non genera nomi 8.3');
  const copy = createEditorCopy({ editorFs: createEditorFs({ root: shortRoot }), trash: async () => assert.fail('niente cestino'), platform: process.platform });
  const d = path.join(longRoot, 'd');
  assert.deepStrictEqual(await copy.planCopy([d], 'd/d'), { ok: false, error: '«d» non si copia dentro se stessa.' });
  const r = await copy.runCopy({ sources: [path.join(d, 'd')], destRel: '' }, { d: 'replace' });
  assert.deepStrictEqual(r.failed, [{ name: 'd', error: 'Sta dentro l\'elemento da sostituire.' }]);
});

ok('planCopy: oltre i limiti di elementi o di byte si rifiuta prima di copiare', async (t) => {
  const { out, copy, write } = setup(t, { maxFiles: 3, maxBytes: 10 });
  for (const n of ['a', 'b', 'c']) write(path.join(out, 'd', n), '123');
  assert.deepStrictEqual(await copy.planCopy([path.join(out, 'd')], ''), { ok: false, error: 'Troppi file e cartelle: più di 3.' });
  const big = write(path.join(out, 'grande.bin'), '12345678901');
  assert.deepStrictEqual(await copy.planCopy([big], ''), { ok: false, error: 'Troppo grande: più di 10 byte.' });
});

ok('planCopy: i link non si seguono, né per contare né per girare in tondo', async (t) => {
  const { out, copy, write } = setup(t, { maxFiles: 3 });
  for (const n of ['1', '2', '3', '4', '5']) write(path.join(out, 'grande', n));
  fs.mkdirSync(path.join(out, 'd'));
  fs.symlinkSync(path.join(out, 'grande'), path.join(out, 'd', 'link'));
  fs.symlinkSync(out, path.join(out, 'd', 'giro'));
  const plan = await copy.planCopy([path.join(out, 'd')], '');
  assert.strictEqual(plan.ok, true, plan.error);
  assert.strictEqual(plan.count, 3); // d, d/link, d/giro
});

ok('planCopy: un file speciale (pipe) dentro una cartella si rifiuta', async (t) => {
  if (process.platform === 'win32') return t.skip('niente mkfifo');
  const { out, copy } = setup(t);
  fs.mkdirSync(path.join(out, 'd'));
  try {
    execFileSync('mkfifo', [path.join(out, 'd', 'tubo')]);
  } catch (e) {
    if (e.code === 'ENOENT') return t.skip('mkfifo non disponibile');
    throw e;
  }
  assert.deepStrictEqual(await copy.planCopy([path.join(out, 'd')], ''), { ok: false, error: '«tubo» non è un file né una cartella.' });
});

ok('runCopy: copia file e cartelle col contenuto, i link come link', async (t) => {
  const { root, out, copy, write } = setup(t);
  write(path.join(out, 'a.txt'), 'ciao');
  write(path.join(out, 'd', 'sub', 'y.txt'), 'y');
  fs.symlinkSync('sub/y.txt', path.join(out, 'd', 'link'));
  const r = await copy.runCopy({ sources: [path.join(out, 'a.txt'), path.join(out, 'd')], destRel: '' }, {});
  assert.deepStrictEqual(r, { ok: true, copied: 2, skipped: 0, failed: [] });
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'ciao');
  assert.strictEqual(fs.readFileSync(path.join(root, 'd', 'sub', 'y.txt'), 'utf8'), 'y');
  // Il link resta link e punta dove puntava (su Windows Node l'ha salvato come sub\y.txt).
  assert.strictEqual(fs.readlinkSync(path.join(root, 'd', 'link')), fs.readlinkSync(path.join(out, 'd', 'link')));
  assert.strictEqual(fs.readFileSync(path.join(root, 'd', 'link'), 'utf8'), 'y');
  assert.strictEqual(fs.readFileSync(path.join(out, 'a.txt'), 'utf8'), 'ciao', 'l originale resta');
});

ok('runCopy: sostituisci passa dal cestino, tieni entrambi prende il primo nome libero, salta non tocca', async (t) => {
  const { root, out, copy, write, trashed } = setup(t);
  write(path.join(root, 'a.txt'), 'vecchio a');
  write(path.join(root, 'b.txt'), 'vecchio b');
  write(path.join(root, 'b (2).txt'), 'occupato');
  write(path.join(root, 'c.txt'), 'vecchio c');
  const sources = ['a.txt', 'b.txt', 'c.txt'].map((n) => write(path.join(out, n), `nuovo ${n}`));
  const r = await copy.runCopy({ sources, destRel: '' }, { 'a.txt': 'replace', 'b.txt': 'keep-both', 'c.txt': 'skip' });
  assert.deepStrictEqual(r, { ok: true, copied: 2, skipped: 1, failed: [] });
  assert.deepStrictEqual(trashed, [path.join(root, 'a.txt')]);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'nuovo a.txt');
  assert.strictEqual(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'vecchio b');
  assert.strictEqual(fs.readFileSync(path.join(root, 'b (2).txt'), 'utf8'), 'occupato');
  assert.strictEqual(fs.readFileSync(path.join(root, 'b (3).txt'), 'utf8'), 'nuovo b.txt');
  assert.strictEqual(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'vecchio c');
});

ok('runCopy: senza decisione, o con una sconosciuta, tiene entrambi; una cartella prende «d (2)»', async (t) => {
  const { root, out, copy, write } = setup(t);
  write(path.join(root, 'x.txt'), 'vecchio');
  write(path.join(root, 'd', 'vecchio.txt'));
  const sources = [write(path.join(out, 'x.txt'), 'nuovo'), path.dirname(write(path.join(out, 'd', 'nuovo.txt')))];
  assert.deepStrictEqual(await copy.runCopy({ sources, destRel: '' }, { d: 'boh' }), { ok: true, copied: 2, skipped: 0, failed: [] });
  assert.strictEqual(fs.readFileSync(path.join(root, 'x (2).txt'), 'utf8'), 'nuovo');
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'd (2)')), ['nuovo.txt']);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'd')), ['vecchio.txt']);
  assert.strictEqual((await copy.runCopy({ sources: [sources[0]], destRel: '' })).copied, 1, 'decisions assenti');
  assert.ok(fs.existsSync(path.join(root, 'x (3).txt')));
});

ok('runCopy: un sorgente sparito dopo il piano è un errore suo, gli altri si copiano', async (t) => {
  const { root, out, copy, write } = setup(t);
  const sources = [write(path.join(out, 'a.txt')), write(path.join(out, 'b.txt'))];
  assert.strictEqual((await copy.planCopy(sources, '')).ok, true);
  fs.rmSync(sources[1]);
  assert.deepStrictEqual(await copy.runCopy({ sources, destRel: '' }, {}), { ok: true, copied: 1, skipped: 0, failed: [{ name: 'b.txt', error: 'Non esiste più.' }] });
  assert.deepStrictEqual(fs.readdirSync(root), ['a.txt']);
});

ok('runCopy: sostituire un elemento con se stesso fa una copia accanto, non lo cestina', async (t) => {
  const { root, copy, write, trashed } = setup(t);
  const a = write(path.join(root, 'a.txt'), 'mio');
  assert.deepStrictEqual(await copy.runCopy({ sources: [a], destRel: '' }, { 'a.txt': 'replace' }), { ok: true, copied: 1, skipped: 0, failed: [] });
  assert.deepStrictEqual(trashed, []);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a (2).txt'), 'utf8'), 'mio');
});

ok('runCopy: non si sostituisce una cartella che contiene il sorgente', async (t) => {
  const { root, copy, write, trashed } = setup(t);
  write(path.join(root, 'd', 'd', 'x.txt'));
  const r = await copy.runCopy({ sources: [path.join(root, 'd', 'd')], destRel: '' }, { d: 'replace' });
  assert.deepStrictEqual(r, { ok: true, copied: 0, skipped: 0, failed: [{ name: 'd', error: 'Sta dentro l\'elemento da sostituire.' }] });
  assert.deepStrictEqual(trashed, []);
  assert.ok(fs.existsSync(path.join(root, 'd', 'd', 'x.txt')));
});

ok('runCopy: rifà i controlli del piano', async (t) => {
  const { out, copy, write } = setup(t);
  const a = write(path.join(out, 'a.txt'));
  assert.strictEqual((await copy.runCopy({ sources: [a], destRel: '../fuori' }, {})).ok, false);
  assert.deepStrictEqual(await copy.runCopy({}, {}), { ok: false, error: 'La destinazione non è una cartella.' });
  assert.deepStrictEqual(await copy.runCopy({ sources: [], destRel: '' }, {}), { ok: false, error: 'Niente da copiare.' });
  assert.deepStrictEqual(await copy.runCopy(undefined, undefined), { ok: false, error: 'La destinazione non è una cartella.' });
});
