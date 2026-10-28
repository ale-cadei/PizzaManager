#!/usr/bin/env node
/* Scarica psmux per il pacchetto Windows (docs/plans/52-psmux-backend.md,
 * punto 1): lo zip della release ufficiale, a versione fissata, verificato con
 * lo SHA-256 scritto qui. psmux.exe e il suo LICENSE finiscono in
 * vendor/psmux, da dove electron-builder li copia in resources\psmux
 * (`build.win.extraResources`) e l'app di sviluppo li prende direttamente.
 *
 * Cambiare versione (o passare al fork del piano 51) vuol dire cambiare URL e
 * SHA-256 qui sotto, dopo aver rifatto le prove di «Come rifare le prove»
 * (docs/plans/40-risultati.md), compresa quella con un server della versione
 * vecchia e il client nuovo.
 *
 * Uso: `node scripts/fetch-psmux.js` (lo lancia `npm run dist:win`). */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PSMUX = {
  version: '3.3.8',
  url: 'https://github.com/psmux/psmux/releases/download/v3.3.8/psmux-v3.3.8-windows-x64.zip',
  // Lo stesso che GitHub pubblica per l'asset della release (digest sha256)
  sha256: '1ad127ba937194a890b933a73d9b023e297bd73dc742abd841bf159984c2effe',
  // Lo zip ha anche tmux.exe e pmux.exe, lo stesso binario con altri nomi: non servono
  files: ['psmux.exe', 'LICENSE'],
};
/** Accanto ai file: dice da quale zip vengono, cosi' una seconda build non riscarica. */
const STAMP = 'SOURCE.sha256';

async function defaultDownload(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download di ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Estrae `files` da uno zip con il tar.exe di Windows (bsdtar, apre gli zip).
 * Percorso completo apposta: nel PATH di Git Bash `tar` e' quello GNU, che
 * gli zip non li apre.
 */
function defaultExtract(zip, out, files, { env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  if (platform !== 'win32') throw new Error('psmux si prepara su Windows: serve il tar.exe di sistema');
  const tar = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const r = spawn(tar, ['-xf', zip, '-C', out, ...files], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar.exe: ${String(r.stderr || r.error || r.status).trim()}`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function alreadyThere(dest, release) {
  try {
    if (fs.readFileSync(path.join(dest, STAMP), 'utf8').trim() !== release.sha256) return false;
    return release.files.every((f) => fs.existsSync(path.join(dest, f)));
  } catch {
    return false;
  }
}

/**
 * Prepara `<root>/vendor/psmux`. Lo zip si apre solo dopo la verifica, in una
 * cartella di lavoro nuova; vendor/psmux si sostituisce solo quando ci sono
 * tutti i file. Restituisce { ok, version, skipped? } o { ok: false, error }.
 */
async function fetchPsmux({ root, release = PSMUX, download = defaultDownload, extract = defaultExtract, tmp = os.tmpdir(), log = console.log } = {}) {
  const dest = path.join(root, 'vendor', 'psmux');
  if (alreadyThere(dest, release)) {
    log(`psmux ${release.version} è già in ${dest}`);
    return { ok: true, version: release.version, skipped: true };
  }
  const work = fs.mkdtempSync(path.join(tmp, 'ais-psmux-'));
  try {
    log(`Scarico psmux ${release.version}: ${release.url}`);
    const zipBytes = await download(release.url);
    const got = sha256(zipBytes);
    if (got !== release.sha256) {
      return { ok: false, error: `SHA-256 dello zip diverso da quello atteso: ${got} invece di ${release.sha256}` };
    }
    const zip = path.join(work, 'psmux.zip');
    const out = path.join(work, 'out');
    fs.writeFileSync(zip, zipBytes);
    fs.mkdirSync(out);
    await extract(zip, out, release.files);
    const missing = release.files.filter((f) => !fs.existsSync(path.join(out, f)));
    if (missing.length) return { ok: false, error: `Nello zip mancano: ${missing.join(', ')}` };
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const f of release.files) fs.copyFileSync(path.join(out, f), path.join(dest, f));
    fs.writeFileSync(path.join(dest, STAMP), `${release.sha256}\n`);
    log(`psmux ${release.version} pronto in ${dest}`);
    return { ok: true, version: release.version };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { fetchPsmux, defaultExtract, PSMUX, STAMP };

if (require.main === module) {
  fetchPsmux({ root: path.join(__dirname, '..') }).then((r) => {
    if (!r.ok) {
      console.error(`fetch-psmux: ${r.error}`);
      process.exitCode = 1;
    }
  });
}
