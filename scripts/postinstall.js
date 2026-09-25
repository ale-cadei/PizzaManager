#!/usr/bin/env node
/* Dopo `npm install`: node-pty va ricompilato per l'ABI di Electron.
 *
 * Su Windows no. node-pty include già i binari per win32 x64 e arm64
 * (`prebuilds/`), e sono N-API: girano in Electron senza ricompilare. La
 * ricompilazione lì chiederebbe Visual Studio Build Tools **con** le librerie
 * Spectre, che il carico di lavoro C++ standard non installa (MSB8040), e
 * fallirebbe su quasi tutte le macchine.
 *
 * Altrove un rebuild fallito non deve far fallire l'install (era il senso di
 * `|| true`, che però cmd.exe non conosce): si avvisa e si va avanti, l'app
 * dirà "node-pty non installato" se il modulo non si carica. */
'use strict';
const { spawnSync } = require('child_process');

function postinstall({ platform = process.platform, spawn = spawnSync, log = console.log } = {}) {
  if (platform === 'win32') {
    log('[postinstall] Windows: node-pty usa i binari precompilati, niente rebuild.');
    return { rebuilt: false };
  }
  // Riga unica con shell: Node ≥ 22 depreca argv separati con shell: true
  const r = spawn('electron-rebuild -f -w node-pty', { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    log('[postinstall] electron-rebuild di node-pty non riuscito: vedi il README, «Cosa serve».');
    return { rebuilt: false, failed: true };
  }
  return { rebuilt: true };
}

if (require.main === module) postinstall();

module.exports = { postinstall };
