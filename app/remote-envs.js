'use strict';
/* Dove si può aprire una sessione (docs/plans/93-sessioni-remote.md): host di
 * ~/.ssh/config e distro WSL per il «Dove» della nuova sessione, più i
 * server scritti a mano e usati di recente (docs/plans/96). La lettura sta
 * in lib/remote-hosts.js e lib/recent-dirs.js; qui solo i canali IPC. */
const { createRemoteHosts } = require('../lib/remote-hosts');
const { recentSshTargets } = require('../lib/recent-dirs');
const { normalizeSshTarget } = require('../lib/remote-env');

const BAD_TARGET = 'Scrivi il server come host, utente@host o utente@host:porta.';

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ hosts?: { list: (o: { fresh: boolean }) => Promise<{ ssh: string[], wsl: string[] }> },
 *   history?: { load: () => Array<{env?: string}> } }} [deps]
 */
function registerRemoteEnvHandlers(ipcMain, { hosts = createRemoteHosts(), history = { load: () => [] } } = {}) {
  /** Server scritti a mano: un errore della cronologia non toglie gli host di config. */
  function recent(exclude) {
    try {
      return recentSshTargets(history.load(), { exclude });
    } catch (e) {
      console.error('server SSH recenti illeggibili:', e);
      return [];
    }
  }

  ipcMain.handle('list-remote-envs', async (event, { fresh } = {}) => {
    try {
      const envs = await hosts.list({ fresh: fresh === true });
      return { ...envs, recent: recent(envs.ssh) };
    } catch (e) {
      console.error('list-remote-envs fallito:', e);
      return { ssh: [], wsl: [], recent: [] };
    }
  });

  // Il testo di «Altro server…»: la chiave dell'ambiente, o perché no
  ipcMain.handle('check-ssh-target', async (event, { text } = {}) => {
    const target = normalizeSshTarget(text);
    return target ? { ok: true, env: `ssh:${target}` } : { ok: false, error: BAD_TARGET };
  });
}

module.exports = { registerRemoteEnvHandlers };
