const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createPsmuxInstall, parsePsmuxVersion } = require('../lib/psmux-install');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ais-psmux-'));
const V_338 = 'tmux 3.3.8\r\npsmux 3.3.8 (66cf613 2026-08-18)\r\n';

/** Un "psmux.exe" finto nella cartella delle risorse, e un -V che risponde per lui. */
function fixture({ version = V_338, exe = true } = {}) {
  const root = tmp();
  const sourceDir = path.join(root, 'resources', 'psmux');
  const localDir = path.join(root, 'local', 'psmux');
  fs.mkdirSync(sourceDir, { recursive: true });
  if (exe) fs.writeFileSync(path.join(sourceDir, 'psmux.exe'), 'exe-3.3.8');
  const calls = [];
  const run = (file, args) => { calls.push([file, args]); return version; };
  return { root, sourceDir, localDir, calls, run, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

ok('versione: si prende dalla riga psmux di -V, non dalla prima (che dice tmux)', () => {
  assert.strictEqual(parsePsmuxVersion(V_338), '3.3.8');
  assert.strictEqual(parsePsmuxVersion('tmux 3.3.8\npsmux 3.3.8 (66cf613 2026-08-18)\n'), '3.3.8');
});

ok('versione: il tmux di MSYS2 stampa solo "tmux 3.x" e non passa (Q5)', () => {
  assert.strictEqual(parsePsmuxVersion('tmux 3.4\n'), null);
  assert.strictEqual(parsePsmuxVersion(''), null);
  assert.strictEqual(parsePsmuxVersion(undefined), null);
});

ok('versione: diventa un nome di cartella, quindi niente separatori né ..', () => {
  assert.strictEqual(parsePsmuxVersion('psmux ..\\..\\evil\n'), null);
  assert.strictEqual(parsePsmuxVersion('psmux 3.3/8\n'), null);
  assert.strictEqual(parsePsmuxVersion('psmux 3.3.8-pizza.1 (abc)\n'), '3.3.8-pizza.1', 'una build del fork resta valida');
});

ok('install: copia l exe nella cartella della sua versione e lo lancia da lì', () => {
  const f = fixture();
  const r = createPsmuxInstall(f).install();
  assert.deepStrictEqual(r, { bin: path.join(f.localDir, '3.3.8', 'psmux.exe'), version: '3.3.8' });
  assert.strictEqual(fs.readFileSync(r.bin, 'utf8'), 'exe-3.3.8');
  assert.deepStrictEqual(f.calls, [[path.join(f.sourceDir, 'psmux.exe'), ['-V']]]);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(r.bin)), ['psmux.exe'], 'nessun file temporaneo rimasto');
  f.done();
});

ok('install: una copia già presente non si riscrive (potrebbe essere in uso da una sessione)', () => {
  const f = fixture();
  const dest = path.join(f.localDir, '3.3.8', 'psmux.exe');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, 'copia-in-uso');
  const r = createPsmuxInstall(f).install();
  assert.strictEqual(r.bin, dest);
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'copia-in-uso');
  f.done();
});

ok('install: senza exe nel pacchetto restituisce null e non lancia niente', () => {
  const f = fixture({ exe: false });
  assert.strictEqual(createPsmuxInstall(f).install(), null);
  assert.deepStrictEqual(f.calls, []);
  f.done();
});

ok('install: un exe che non si dichiara psmux non si installa', () => {
  const f = fixture({ version: 'tmux 3.4\n' });
  assert.strictEqual(createPsmuxInstall(f).install(), null);
  assert.strictEqual(fs.existsSync(f.localDir), false);
  f.done();
});

ok('install: se -V fallisce (antivirus, exe rotto) ricade su null senza eccezioni', () => {
  const f = fixture();
  const run = () => { throw new Error('spawn EPERM'); };
  assert.strictEqual(createPsmuxInstall({ ...f, run }).install(), null);
  f.done();
});

ok('install: se la copia fallisce ricade su null senza eccezioni', () => {
  const f = fixture();
  fs.mkdirSync(path.dirname(f.localDir), { recursive: true });
  fs.writeFileSync(f.localDir, 'un file al posto della cartella');
  assert.strictEqual(createPsmuxInstall(f).install(), null);
  f.done();
});

ok('binFor: l exe di una versione installata, null se manca o se la versione non è valida', () => {
  const f = fixture();
  const inst = createPsmuxInstall(f);
  const { bin } = inst.install();
  assert.strictEqual(inst.binFor('3.3.8'), bin);
  assert.strictEqual(inst.binFor('3.3.7'), null);
  assert.strictEqual(inst.binFor('..'), null);
  assert.strictEqual(inst.binFor(undefined), null);
  f.done();
});

ok('installedVersions: le cartelle di versione con dentro l exe, nient altro', () => {
  const f = fixture();
  const inst = createPsmuxInstall(f);
  assert.deepStrictEqual(inst.installedVersions(), [], 'cartella locale ancora assente');
  inst.install();
  fs.mkdirSync(path.join(f.localDir, '3.3.7'));
  fs.writeFileSync(path.join(f.localDir, '3.3.7', 'psmux.exe'), 'vecchio');
  fs.mkdirSync(path.join(f.localDir, '3.2.0'));
  fs.mkdirSync(path.join(f.localDir, 'non-una-versione'));
  fs.writeFileSync(path.join(f.localDir, 'note.txt'), '');
  assert.deepStrictEqual(inst.installedVersions().sort(), ['3.3.7', '3.3.8']);
  f.done();
});

ok('prune: toglie le versioni fuori da keep e lascia quelle tenute e le cartelle estranee', () => {
  const f = fixture();
  const inst = createPsmuxInstall(f);
  inst.install();
  for (const v of ['3.3.6', '3.3.7']) {
    fs.mkdirSync(path.join(f.localDir, v));
    fs.writeFileSync(path.join(f.localDir, v, 'psmux.exe'), v);
  }
  fs.mkdirSync(path.join(f.localDir, 'non-una-versione'));
  const removed = inst.prune(['3.3.8', '3.3.7']);
  assert.deepStrictEqual(removed, ['3.3.6']);
  assert.deepStrictEqual(inst.installedVersions().sort(), ['3.3.7', '3.3.8']);
  assert.ok(fs.existsSync(path.join(f.localDir, 'non-una-versione')));
  f.done();
});

ok('prune: una cartella che non si cancella (exe in uso) non ferma le altre', () => {
  const f = fixture();
  for (const v of ['3.3.6', '3.3.7']) {
    fs.mkdirSync(path.join(f.localDir, v), { recursive: true });
    fs.writeFileSync(path.join(f.localDir, v, 'psmux.exe'), v);
  }
  const rm = (p, opts) => { if (p.endsWith('3.3.6')) throw new Error('EBUSY'); fs.rmSync(p, opts); };
  const removed = createPsmuxInstall({ ...f, rm }).prune([]);
  assert.deepStrictEqual(removed, ['3.3.7']);
  assert.ok(fs.existsSync(path.join(f.localDir, '3.3.6')));
  f.done();
});
