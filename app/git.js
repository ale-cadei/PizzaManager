'use strict';
const { readGitGraph } = require('../lib/git-graph');

/**
 * Canali IPC della sessione di tipo git (docs/plans/25). La logica sta in
 * lib/; qui solo il collegamento, per non far crescere main.js.
 *
 * @param {Electron.IpcMain} ipcMain
 */
function registerGitHandlers(ipcMain) {
  const guard = (fn) => async (event, payload = {}) => {
    try {
      return await fn(payload || {});
    } catch (e) {
      console.error('[git]', e);
      return { ok: false, error: 'git: ' + String((e && e.message) || e) };
    }
  };
  ipcMain.handle('git-graph', guard(({ cwd, limit }) => readGitGraph({ cwd, limit })));
}

module.exports = { registerGitHandlers };
