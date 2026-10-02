'use strict';
/* Fotografia dei file di una cartella di lavoro, per l'«ultimo giro» del
 * pannello delle modifiche (docs/plans/32-pannello-modifiche.md, decisione 7).
 *
 * La fotografia è un tree git: lo stato dei file tracciati e di quelli nuovi
 * (non gli ignorati) in quel momento. Confrontarne due con `git diff` dice
 * cosa è cambiato in mezzo, file nuovi compresi.
 *
 * Si fa con un indice temporaneo (`GIT_INDEX_FILE`), copiato da quello vero
 * così git non rilegge i file che non sono cambiati: indice dell'utente,
 * HEAD, branch e stash non si toccano. Si scrivono solo oggetti nel database
 * di git, che `git gc` ripulisce da solo quando nessuno li usa più. Per non
 * riempirlo, i file nuovi oltre MAX_NEW_FILE_BYTES restano fuori.
 *
 * `run` è iniettabile: i test verificano cosa si chiede a git senza git. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGit, nativePath } = require('./git-run');
const { gitMessage } = require('./git-branches');

const MAX_NEW_FILE_BYTES = 1024 * 1024;
const MAX_NEW_FILES = 2000;
/* I file nuovi si aggiungono a gruppi: una riga di comando ha un limite */
const ADD_BATCH = 100;
const NOT_A_REPO_RE = /not a git repository/i;
/* sha1 o sha256: l'unica cosa che il renderer può mandare indietro come «since» */
const TREE_ID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const isTreeId = (s) => typeof s === 'string' && TREE_ID_RE.test(s);

function chunks(list, size) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
}

/* I file nuovi abbastanza piccoli da entrare nella fotografia */
async function smallNewFiles(run, root, env, fsp) {
  const listed = String(await run(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, env }))
    .split('\0').filter(Boolean).slice(0, MAX_NEW_FILES);
  const sizes = await Promise.all(listed.map((rel) => fsp.lstat(path.join(root, rel)).then(
    (st) => (st.isFile() || st.isSymbolicLink() ? st.size : Infinity),
    () => Infinity,
  )));
  return listed.filter((_, i) => sizes[i] <= MAX_NEW_FILE_BYTES);
}

/**
 * @param {{cwd: string, run?: Function, fsp?: object, tmpdir?: string,
 *   platform?: string, now?: () => number}} o
 * @returns {Promise<{ok: true, root: string, tree: string, at: number}
 *   | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function snapshotTree({
  cwd, run = runGit, fsp = fs.promises, tmpdir = os.tmpdir(), platform = process.platform, now = Date.now,
} = {}) {
  if (typeof cwd !== 'string' || !cwd) return { ok: false, error: 'Directory di lavoro mancante.' };
  let root;
  try {
    root = nativePath((await run(['rev-parse', '--show-toplevel'], { cwd })).trim(), platform);
  } catch (e) {
    const error = gitMessage(e);
    return NOT_A_REPO_RE.test(error) ? { ok: false, reason: 'not-a-repo' } : { ok: false, error };
  }
  let dir = null;
  try {
    // In un worktree l'indice sta altrove: lo dice git, relativo alla radice o assoluto
    const indexPath = path.resolve(root, (await run(['rev-parse', '--git-path', 'index'], { cwd: root })).trim());
    dir = await fsp.mkdtemp(path.join(tmpdir, 'ais-snap-'));
    const tmpIndex = path.join(dir, 'index');
    // Un repository appena nato non ha ancora un indice: si parte vuoti
    await fsp.copyFile(indexPath, tmpIndex).catch(() => {});
    const env = { GIT_INDEX_FILE: tmpIndex };
    await run(['add', '--update'], { cwd: root, env });
    for (const batch of chunks(await smallNewFiles(run, root, env, fsp), ADD_BATCH)) {
      await run(['--literal-pathspecs', 'add', '--', ...batch], { cwd: root, env });
    }
    const tree = (await run(['write-tree'], { cwd: root, env })).trim();
    if (!isTreeId(tree)) return { ok: false, error: 'git non ha restituito una fotografia valida.' };
    return { ok: true, root, tree, at: now() };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { snapshotTree, isTreeId, MAX_NEW_FILE_BYTES };
