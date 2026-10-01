'use strict';
/* Dove stanno i worktree dell'app (docs/plans/36-sessione-worktree.md):
 * accanto al progetto, in `<progetto>.worktrees/<nome>`. Solo stringhe, niente
 * filesystem: lo usano sia chi crea i worktree (lib/worktree.js) sia chi deve
 * ritrovare il progetto di un worktree che non c'è più (lib/workdir.js,
 * lib/project-root.js). */
const path = require('path');

const CONTAINER_SUFFIX = '.worktrees';

/**
 * Il progetto di una cartella che sta dentro `<progetto>.worktrees/`, anche in
 * una sua sottocartella; null se non ci sta.
 * @param {string} dir percorso assoluto
 * @param {{pathImpl?: typeof path}} [o] `path.win32` per i percorsi Windows da Unix
 * @returns {string|null}
 */
function worktreeProjectDir(dir, { pathImpl = path } = {}) {
  if (typeof dir !== 'string' || !dir) return null;
  for (let current = dir; ; current = pathImpl.dirname(current)) {
    const parent = pathImpl.dirname(current);
    if (parent === current) return null;
    const name = pathImpl.basename(parent);
    if (name.length > CONTAINER_SUFFIX.length && name.endsWith(CONTAINER_SUFFIX)) {
      return pathImpl.join(pathImpl.dirname(parent), name.slice(0, -CONTAINER_SUFFIX.length));
    }
  }
}

module.exports = { CONTAINER_SUFFIX, worktreeProjectDir };
