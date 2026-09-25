#!/usr/bin/env node
/* Costruisce PizzaManager per Windows e la installa (`npm run install:win`).
 * È il gemello di scripts/install-mac.sh: l'app installata è una fotografia
 * del codice al momento del build, dopo un merge va rifatta.
 *
 * L'installazione è quella del setup NSIS in modalità silenziosa (/S): per
 * utente, in %LOCALAPPDATA%\Programs\PizzaManager, con il collegamento nel
 * menu Start, come la farebbe chi scarica il setup dalla Release. */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_EXE = 'PizzaManager.exe';
const SETUP = path.join('dist', 'PizzaManager-win-x64-setup.exe');

/* Due istanze (questa e `npm start`, o la copia installata aperta) sarebbero
   due scritture sulla stessa cartella dati; e il setup non può sovrascrivere
   un .exe in uso. */
function isRunning(spawn) {
  const r = spawn('tasklist', ['/FI', `IMAGENAME eq ${APP_EXE}`, '/NH'], { encoding: 'utf8' });
  return String(r.stdout || '').toLowerCase().includes(APP_EXE.toLowerCase());
}

function installWin({
  platform = process.platform,
  spawn = spawnSync,
  exists = fs.existsSync,
  root = path.join(__dirname, '..'),
  env = process.env,
  log = console.log,
  error = console.error,
} = {}) {
  if (platform !== 'win32') {
    error('install:win gira solo su Windows (su macOS: npm run install:mac).');
    return 1;
  }
  if (isRunning(spawn)) {
    error('PizzaManager è aperta: chiudila e rilancia.');
    return 1;
  }
  // Riga unica con shell: npm su Windows è npm.cmd (e Node ≥ 22 depreca argv separati con shell)
  const build = spawn('npm run dist:win', { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    error('Build non riuscita: vedi l\'output di electron-builder qui sopra.');
    return 1;
  }
  const setup = path.join(root, SETUP);
  if (!exists(setup)) {
    error(`Build finita ma non trovo ${SETUP}.`);
    return 1;
  }
  const inst = spawn(setup, ['/S'], { stdio: 'inherit' });
  if (inst.status !== 0) {
    error(`Il setup è uscito con codice ${inst.status}.`);
    return 1;
  }
  const dest = path.win32.join(env.LOCALAPPDATA || '%LOCALAPPDATA%', 'Programs', 'PizzaManager');
  log(`Installata: ${dest} (menu Start → PizzaManager)`);
  return 0;
}

if (require.main === module) process.exitCode = installWin();

module.exports = { installWin, SETUP };
