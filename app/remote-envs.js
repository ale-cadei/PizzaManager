'use strict';
/* Dove si può aprire una sessione (docs/plans/93-sessioni-remote.md): host di
 * ~/.ssh/config e distro WSL per il «Dove» della nuova sessione, più i
 * server scritti a mano e usati di recente (docs/plans/96). La lettura sta
 * in lib/remote-hosts.js e lib/recent-dirs.js; qui solo i canali IPC. */
const { createRemoteHosts } = require('../lib/remote-hosts');
const { recentSshTargets } = require('../lib/recent-dirs');
const { normalizeSshTarget, parseSshTarget, isConfigAlias } = require('../lib/remote-env');
const { createSshConfigSaver } = require('../lib/ssh-config-save');

const BAD_TARGET = 'Scrivi il server come host, utente@host o utente@host:porta.';
const BAD_ALIAS = 'Il nome può avere lettere, numeri, «.», «_» e «-», non un «-» in testa.';

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ hosts?: { list: (o: { fresh: boolean }) => Promise<{ ssh: string[], wsl: string[] }> },
 *   history?: { load: () => Array<{env?: string}> },
 *   saver?: { save: (o: { alias: string, target: string }) => void } }} [deps]
 */
function registerRemoteEnvHandlers(ipcMain, {
  hosts = createRemoteHosts(), history = { load: () => [] }, saver = createSshConfigSaver(),
} = {}) {
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

  // «Salva» (docs/plans/96): il server in ~/.ssh/config col nome scritto, di default l'host
  ipcMain.handle('save-ssh-host', async (event, { text, alias } = {}) => {
    const target = normalizeSshTarget(text);
    if (!target) return { ok: false, error: BAD_TARGET };
    const name = (typeof alias === 'string' && alias.trim()) || parseSshTarget(target).host;
    if (!isConfigAlias(name)) return { ok: false, error: BAD_ALIAS };
    try {
      // Anche quelli degli Include: il file da solo non li vede
      const { ssh } = await hosts.list({ fresh: true });
      if (ssh.includes(name)) return { ok: false, error: `«${name}» c'è già in ~/.ssh/config.` };
      saver.save({ alias: name, target });
      await hosts.list({ fresh: true }); // il prossimo list-remote-envs lo vede subito
      return { ok: true, env: `ssh:${name}` };
    } catch (e) {
      console.error('save-ssh-host fallito:', e);
      return { ok: false, error: `Non si scrive ~/.ssh/config: ${e.message}` };
    }
  });
}

module.exports = { registerRemoteEnvHandlers };
