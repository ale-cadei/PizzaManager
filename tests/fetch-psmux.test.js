const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { fetchPsmux, PSMUX } = require('../scripts/fetch-psmux');

/* psmux nel pacchetto Windows (docs/plans/52, punto 1): lo zip della release a
   versione fissata, verificato con lo SHA-256 scritto nel repo, prima di
   electron-builder. Qui download ed estrazione sono finti: si prova cosa
   finisce in vendor/psmux e cosa no. */
const ZIP = Buffer.from('uno zip finto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const quiet = () => {};

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-fetch-psmux-'));
  const root = path.join(base, 'repo');
  const tmp = path.join(base, 'tmp');
  fs.mkdirSync(root);
  fs.mkdirSync(tmp);
  const release = { ...PSMUX, sha256: sha(ZIP) };
  const calls = { download: 0, extract: [] };
  const download = async (url) => { calls.download++; assert.strictEqual(url, release.url); return ZIP; };
  /** Estrae i file chiesti, con un contenuto riconoscibile; `missing` ne salta uno. */
  const extract = (missing) => (zip, out, files) => {
    calls.extract.push({ zip: fs.readFileSync(zip), files });
    for (const f of files) if (f !== missing) fs.writeFileSync(path.join(out, f), `contenuto di ${f}`);
  };
  const vendor = path.join(root, 'vendor', 'psmux');
  return { base, root, tmp, release, calls, download, extract, vendor, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

ok('fetch-psmux: scarica, verifica lo SHA-256 e mette exe e licenza in vendor/psmux', async () => {
  const s = setup();
  const r = await fetchPsmux({ root: s.root, release: s.release, download: s.download, extract: s.extract(), tmp: s.tmp, log: quiet });
  assert.deepStrictEqual(r, { ok: true, version: s.release.version });
  assert.deepStrictEqual(fs.readdirSync(s.vendor).sort(), ['LICENSE', 'SOURCE.sha256', 'psmux.exe']);
  assert.strictEqual(fs.readFileSync(path.join(s.vendor, 'psmux.exe'), 'utf8'), 'contenuto di psmux.exe');
  assert.deepStrictEqual(s.calls.extract.map((c) => c.files), [['psmux.exe', 'LICENSE']], 'solo i due file che servono, non tmux.exe e pmux.exe');
  assert.ok(s.calls.extract[0].zip.equals(ZIP));
  assert.deepStrictEqual(fs.readdirSync(s.tmp), [], 'la cartella di lavoro se ne va');
  s.done();
});

ok('fetch-psmux: uno zip con un altro SHA-256 non si apre e non tocca vendor/psmux', async () => {
  const s = setup();
  const release = { ...s.release, sha256: 'a'.repeat(64) };
  const r = await fetchPsmux({ root: s.root, release, download: s.download, extract: s.extract(), tmp: s.tmp, log: quiet });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /SHA-256/);
  assert.deepStrictEqual(s.calls.extract, [], 'niente estrazione di un file non verificato');
  assert.strictEqual(fs.existsSync(s.vendor), false);
  assert.deepStrictEqual(fs.readdirSync(s.tmp), []);
  s.done();
});

ok('fetch-psmux: già presente con lo stesso SHA-256 non si riscarica', async () => {
  const s = setup();
  await fetchPsmux({ root: s.root, release: s.release, download: s.download, extract: s.extract(), tmp: s.tmp, log: quiet });
  const r = await fetchPsmux({ root: s.root, release: s.release, download: s.download, extract: s.extract(), tmp: s.tmp, log: quiet });
  assert.deepStrictEqual(r, { ok: true, version: s.release.version, skipped: true });
  assert.strictEqual(s.calls.download, 1);
  s.done();
});

ok('fetch-psmux: una versione diversa (altro SHA-256) o un file mancante si riscarica', async () => {
  const s = setup();
  fs.mkdirSync(s.vendor, { recursive: true });
  fs.writeFileSync(path.join(s.vendor, 'psmux.exe'), 'vecchio');
  fs.writeFileSync(path.join(s.vendor, 'SOURCE.sha256'), 'b'.repeat(64));
  await fetchPsmux({ root: s.root, release: s.release, download: s.download, extract: s.extract(), tmp: s.tmp, log: quiet });
  assert.strictEqual(fs.readFileSync(path.join(s.vendor, 'psmux.exe'), 'utf8'), 'contenuto di psmux.exe');
  fs.rmSync(path.join(s.vendor, 'LICENSE'));
  await fetchPsmux({ root: s.root, release: s.release, download: s.download, extract: s.extract(), tmp: s.tmp, log: quiet });
  assert.strictEqual(s.calls.download, 2);
  s.done();
});

ok('fetch-psmux: se nello zip manca un file, vendor/psmux resta com era', async () => {
  const s = setup();
  fs.mkdirSync(s.vendor, { recursive: true });
  fs.writeFileSync(path.join(s.vendor, 'psmux.exe'), 'quello di prima');
  const r = await fetchPsmux({ root: s.root, release: s.release, download: s.download, extract: s.extract('LICENSE'), tmp: s.tmp, log: quiet });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /LICENSE/);
  assert.strictEqual(fs.readFileSync(path.join(s.vendor, 'psmux.exe'), 'utf8'), 'quello di prima');
  assert.deepStrictEqual(fs.readdirSync(s.tmp), []);
  s.done();
});

ok('fetch-psmux: un download fallito è un errore leggibile, non un eccezione', async () => {
  const s = setup();
  const download = async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); };
  const r = await fetchPsmux({ root: s.root, release: s.release, download, extract: s.extract(), tmp: s.tmp, log: quiet });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ENOTFOUND/);
  s.done();
});

ok('fetch-psmux: la release fissata è l originale psmux, con versione e SHA-256 coerenti', () => {
  assert.strictEqual(PSMUX.version, '3.3.8');
  assert.strictEqual(PSMUX.url, 'https://github.com/psmux/psmux/releases/download/v3.3.8/psmux-v3.3.8-windows-x64.zip');
  assert.match(PSMUX.sha256, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(PSMUX.files, ['psmux.exe', 'LICENSE']);
});

/* Il pacchetto Windows porta psmux in resources\psmux, che e' dove lo cerca
   psmuxDirs nell'app impacchettata; dist:win lo scarica prima di costruire. */
ok('build: dist:win scarica psmux prima di electron-builder e lo mette in resources/psmux', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts['dist:win'], /^node scripts\/fetch-psmux\.js && electron-builder --win/);
  assert.deepStrictEqual(pkg.build.win.extraResources, [{ from: 'vendor/psmux', to: 'psmux', filter: ['psmux.exe', 'LICENSE'] }]);
  const { psmuxDirs } = require('../lib/psmux-install');
  const dirs = psmuxDirs({ packaged: true, resourcesPath: 'C:\\PM\\resources', env: { LOCALAPPDATA: 'C:\\L' } });
  assert.strictEqual(dirs.sourceDir, 'C:\\PM\\resources\\psmux', 'dove lo mette il pacchetto è dove lo cerca l app');
});
