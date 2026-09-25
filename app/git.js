'use strict';
const { readGitGraph } = require('../lib/git-graph');
const { listBranches, switchBranch, createBranch } = require('../lib/git-branches');
const { createGitSessionsStore } = require('../lib/git-sessions');

/**
 * Canali IPC della sessione di tipo git (docs/plans/25). La logica sta in
 * lib/; qui solo il collegamento, per non far crescere main.js.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{userDataDir: () => string}} opts cartella dei dati, chiesta solo
 *   alla prima richiesta (come gli altri store di main.js)
 */
function registerGitHandlers(ipcMain, { userDataDir } = {}) {
  let store = null;
  const sessions = () => (store = store || createGitSessionsStore({ dir: userDataDir() }));
  const guard = (fn) => async (event, payload = {}) => {
    try {
      return await fn(payload || {});
    } catch (e) {
      console.error('[git]', e);
      return { ok: false, error: 'git: ' + String((e && e.message) || e) };
    }
  };
  ipcMain.handle('git-graph', guard(({ cwd, limit }) => readGitGraph({ cwd, limit })));
  ipcMain.handle('git-branches', guard(({ cwd }) => listBranches({ cwd })));
  ipcMain.handle('git-switch', guard(({ cwd, name, kind }) => switchBranch({ cwd, name, kind })));
  ipcMain.handle('git-create-branch', guard(({ cwd, name }) => createBranch({ cwd, name })));
  // Schede git aperte, da riaprire al prossimo avvio (lib/git-sessions.js)
  ipcMain.handle('git-sessions', guard(() => ({ ok: true, sessions: sessions().read() })));
  ipcMain.handle('git-sessions-save', guard(({ sessions: list }) => ({ ok: true, sessions: sessions().write(list) })));
}

module.exports = { registerGitHandlers };
