'use strict';
const { readGitGraph } = require('../lib/git-graph');
const { listBranches, switchBranch, createBranch, deleteBranch } = require('../lib/git-branches');
const { createGitSessionsStore, savedBeforeBoot } = require('../lib/git-sessions');

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
  ipcMain.handle('git-delete-branch', guard(({ cwd, name, force }) => deleteBranch({ cwd, name, force: force === true })));
  // Schede git aperte, da riaprire al prossimo avvio (lib/git-sessions.js).
  // Dopo un riavvio della macchina `ask`: si propongono, non si riaprono da sole.
  ipcMain.handle('git-sessions', guard(() => {
    const { sessions: list, savedAt } = sessions().readState();
    return { ok: true, sessions: list, ask: savedBeforeBoot(savedAt) };
  }));
  ipcMain.handle('git-sessions-save', guard(({ sessions: list }) => ({ ok: true, sessions: sessions().write(list) })));
}

module.exports = { registerGitHandlers };
