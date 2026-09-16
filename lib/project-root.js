/* Radice del "progetto" di una sessione: la directory che contiene .git,
 * risalendo dalla directory di lavoro. Modulo puro, nessuna dipendenza da
 * Electron: gira nel main process (l'unico con accesso al filesystem) ed è
 * importabile dai test. */

const fs = require('fs');
const path = require('path');
const { normalizeDir } = require('./recent-dirs');

/**
 * @param {string} dir directory di lavoro della sessione
 * @param {{ exists?: (p: string) => boolean, pathImpl?: typeof path }} [options] `exists` e
 *   `pathImpl` (`path.win32` per provare i percorsi Windows da Unix) iniettabili per i test
 * @returns {string|null} radice del progetto; la `dir` stessa se non è in un
 *   repository; `null` se `dir` non è un percorso assoluto utilizzabile
 */
function findProjectRoot(dir, options = {}) {
  const exists = typeof options.exists === 'function' ? options.exists : fs.existsSync;
  const p = options.pathImpl || path;
  const start = normalizeDir(dir);
  if (!start) return null;

  let current = start;
  for (;;) {
    try {
      // .git è una directory nei repository normali e un file nei worktree
      // e nei submodule: entrambi i casi valgono come radice.
      if (exists(p.join(current, '.git'))) return current;
    } catch {
      // Filesystem inaccessibile (permessi): meglio la directory di partenza
      // che nessun gruppo.
      return start;
    }
    const parent = p.dirname(current);
    if (parent === current) return start; // arrivati a '/' o a 'C:\\'
    current = parent;
  }
}

module.exports = { findProjectRoot };
