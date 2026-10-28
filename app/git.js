'use strict';
const { readGitGraph } = require('../lib/git-graph');
const { listBranches, switchBranch, createBranch, deleteBranch } = require('../lib/git-branches');
const { createGitSessionsStore, savedBeforeBoot } = require('../lib/git-sessions');
const { listWorktrees, worktreeStart, createWorktree, mergeWorktree, removeWorktree } = require('../lib/worktree');
const { readChanges, readFileDiff } = require('../lib/git-changes');
const { snapshotTree } = require('../lib/git-snapshot');
const { readStaging, readStagingDiff } = require('../lib/git-staging');
const { stagePaths, unstagePaths, stageAll, unstageAll, commitStaged } = require('../lib/git-commit');
const { mergeBranch } = require('../lib/git-merge');
const { pushBranch } = require('../lib/git-push');
const { discardFile, undoDiscard } = require('../lib/git-discard');
const { readConflicts, resolveFile, continueOp, abortOp } = require('../lib/git-conflicts');

/**
 * Canali IPC della sessione di tipo git (docs/plans/25), dei worktree
 * (docs/plans/36) e del pannello delle modifiche (docs/plans/32). La logica
 * sta in lib/; qui solo il collegamento, per non far crescere main.js.
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
  // Worktree (docs/plans/36). Le sessioni aperte in un worktree le chiude il
  // renderer, che le conosce, prima di unire o buttare. Si passano solo i
  // campi attesi: `force` vale solo se è proprio true.
  ipcMain.handle('worktree-list', guard(({ root }) => listWorktrees({ root })));
  ipcMain.handle('worktree-start', guard(({ root }) => worktreeStart({ root })));
  ipcMain.handle('worktree-create', guard(({ root, branch, base }) => createWorktree({ root, branch, base })));
  ipcMain.handle('worktree-merge', guard(({ root, path }) => mergeWorktree({ root, path })));
  ipcMain.handle('worktree-remove', guard(({ root, path, branch, force }) => removeWorktree({ root, path, branch, force: force === true })));
  // Pannello delle modifiche (docs/plans/32): base, fotografia e percorso li
  // ricontrolla lib/git-changes.js, il renderer non può far leggere un file
  // qualsiasi né passare opzioni a git.
  ipcMain.handle('git-changes', guard(({ cwd, base, since, incoming }) => readChanges({ cwd, base, since, incoming })));
  ipcMain.handle('git-file-diff', guard(({ cwd, base, path, since, incoming }) => readFileDiff({ cwd, base, path, since, incoming })));
  // «Ultimo giro»: la fotografia dei file all'invio di un prompt
  ipcMain.handle('git-snapshot', guard(({ cwd }) => snapshotTree({ cwd })));
  // «Da committare» (docs/plans/43): sezione e percorso li ricontrolla lib/git-staging.js
  ipcMain.handle('git-staging', guard(({ cwd }) => readStaging({ cwd })));
  ipcMain.handle('git-staging-diff', guard(({ cwd, path, side }) => readStagingDiff({ cwd, path, side })));
  // Stage, unstage e commit (docs/plans/53): i percorsi devono essere adesso
  // nella sezione giusta, lo ricontrolla lib/git-commit.js. `all` vale solo se è true.
  ipcMain.handle('git-stage', guard(({ cwd, paths, all }) => (all === true ? stageAll({ cwd }) : stagePaths({ cwd, paths }))));
  ipcMain.handle('git-unstage', guard(({ cwd, paths, all }) => (all === true ? unstageAll({ cwd }) : unstagePaths({ cwd, paths }))));
  ipcMain.handle('git-commit', guard(({ cwd, message }) => commitStaged({ cwd, message })));
  // Unire un branch nel corrente (docs/plans/54): nome, tipo e controlli li
  // rifà lib/git-merge.js; `expect` è la punta che la conferma ha mostrato.
  ipcMain.handle('git-merge', guard(({ cwd, name, kind, expect }) => mergeBranch({ cwd, name, kind, expect: typeof expect === 'string' ? expect : null })));
  // Push di un branch locale (docs/plans/55): upstream o `-u`, mai forzato
  ipcMain.handle('git-push', guard(({ cwd, name }) => pushBranch({ cwd, name })));
  // Scartare il non staged di un file, e annullare (docs/plans/56): percorso
  // e gettone li ricontrolla lib/git-discard.js
  ipcMain.handle('git-discard', guard(({ cwd, path }) => discardFile({ cwd, path })));
  ipcMain.handle('git-discard-undo', guard(({ cwd, token }) => undoDiscard({ cwd, token })));
  // Conflitti di un'operazione a metà (docs/plans/69): percorso, scelta e
  // operazione li ricontrolla lib/git-conflicts.js
  ipcMain.handle('git-conflicts', guard(({ cwd }) => readConflicts({ cwd })));
  ipcMain.handle('git-conflict-resolve', guard(({ cwd, path, how }) => resolveFile({ cwd, path, how })));
  ipcMain.handle('git-op-continue', guard(({ cwd, op }) => continueOp({ cwd, op })));
  ipcMain.handle('git-op-abort', guard(({ cwd, op }) => abortOp({ cwd, op })));
}

module.exports = { registerGitHandlers };
