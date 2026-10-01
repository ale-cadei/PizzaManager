/* Radice del "progetto" di una sessione: la directory che contiene .git,
 * risalendo dalla directory di lavoro. Modulo puro, nessuna dipendenza da
 * Electron: gira nel main process (l'unico con accesso al filesystem) ed è
 * importabile dai test. */

const fs = require('fs');
const path = require('path');
const { normalizeDir } = require('./recent-dirs');
const { worktreeProjectDir } = require('./worktree-path');

/**
 * @param {string} dir directory di lavoro della sessione
 * @param {{ exists?: (p: string) => boolean, readFile?: (p: string) => string, pathImpl?: typeof path }} [options]
 *   `exists`, `readFile` e `pathImpl` (`path.win32` per provare i percorsi
 *   Windows da Unix) iniettabili per i test
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
      // e nei submodule: entrambi valgono come radice, ma un worktree
      // appartiene al progetto principale (mainWorktreeRoot).
      if (exists(p.join(current, '.git'))) return mainWorktreeRoot(current, options);
    } catch {
      // Filesystem inaccessibile (permessi): meglio la directory di partenza
      // che nessun gruppo.
      return start;
    }
    const parent = p.dirname(current);
    if (parent === current) return removedWorktreeRoot(start, exists, p); // arrivati a '/' o a 'C:\\'
    current = parent;
  }
}

/* Un worktree già tolto (unito o buttato) non ha più il suo .git: le sue
   conversazioni appartengono ancora al progetto, se quello è un repository.
   Altrimenti vale la cartella com'è. */
function removedWorktreeRoot(start, exists, p) {
  const project = worktreeProjectDir(start, { pathImpl: p });
  try {
    return project && exists(p.join(project, '.git')) ? project : start;
  } catch {
    return start;
  }
}

const GITDIR_RE = /^gitdir:[ \t]*(.+?)[ \t]*$/m;

/**
 * La radice del repository principale per un worktree; `dir` stessa in ogni
 * altro caso (repository normale, submodule, qualsiasi cosa non si legga).
 *
 * Nel worktree `.git` è un file `gitdir: <principale>/.git/worktrees/<nome>`,
 * e lì `commondir` rimanda alla directory comune, `<principale>/.git`. Un
 * submodule punta a `.git/modules/<x>`, che `commondir` non ce l'ha: resta un
 * progetto a sé. Si legge il filesystem invece di chiedere a git: è la stessa
 * risposta di `git rev-parse --git-common-dir` senza lanciare un processo per
 * ogni scheda (docs/plans/36-sessione-worktree.md).
 *
 * @param {string} dir directory che contiene `.git`
 * @param {{ exists?: (p: string) => boolean, readFile?: (p: string) => string, pathImpl?: typeof path }} [options]
 * @returns {string}
 */
function mainWorktreeRoot(dir, options = {}) {
  const exists = typeof options.exists === 'function' ? options.exists : fs.existsSync;
  const readFile = typeof options.readFile === 'function' ? options.readFile : (f) => fs.readFileSync(f, 'utf8');
  const p = options.pathImpl || path;
  try {
    // Un repository normale ha .git directory: leggerla fallisce (EISDIR) e si resta qui
    const match = GITDIR_RE.exec(String(readFile(p.join(dir, '.git'))));
    if (!match) return dir;
    // Relativo con worktree.useRelativePaths; con gli slash su Windows (`C:/...`)
    const gitdir = p.resolve(dir, match[1]);
    const common = p.resolve(gitdir, String(readFile(p.join(gitdir, 'commondir'))).trim());
    // Un repository bare o con la directory git altrove non ha una cartella
    // di lavoro principale da indicare come progetto
    if (p.basename(common) !== '.git') return dir;
    const root = p.dirname(common);
    return exists(p.join(root, '.git')) ? root : dir;
  } catch {
    return dir;
  }
}

module.exports = { findProjectRoot, mainWorktreeRoot };
