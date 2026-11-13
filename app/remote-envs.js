'use strict';
/* Dove si può aprire una sessione (docs/plans/93-sessioni-remote.md): host di
 * ~/.ssh/config e distro WSL per il «Dove» della nuova sessione. La lettura
 * sta in lib/remote-hosts.js; qui solo il canale IPC. */
const { createRemoteHosts } = require('../lib/remote-hosts');

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ hosts?: { list: (o: { fresh: boolean }) => Promise<{ ssh: string[], wsl: string[] }> } }} [deps]
 */
function registerRemoteEnvHandlers(ipcMain, { hosts = createRemoteHosts() } = {}) {
  ipcMain.handle('list-remote-envs', async (event, { fresh } = {}) => {
    try {
      return await hosts.list({ fresh: fresh === true });
    } catch (e) {
      console.error('list-remote-envs fallito:', e);
      return { ssh: [], wsl: [] };
    }
  });
}

module.exports = { registerRemoteEnvHandlers };
