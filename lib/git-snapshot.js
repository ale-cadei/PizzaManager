'use strict';
/* Fotografia dei file di una cartella di lavoro, per l'«ultimo giro» del
 * pannello delle modifiche (docs/plans/32-pannello-modifiche.md, decisione 7).
 *
 * La fotografia è un tree git: lo stato dei file tracciati e di quelli nuovi
 * (non gli ignorati) in quel momento. Confrontarne due con `git diff` dice
 * cosa è cambiato in mezzo, file nuovi compresi.
 *
 * - Si fa con un indice dell'app (`GIT_INDEX_FILE`), uno per repository,
 *   nato come copia di quello vero e poi tenuto aggiornato: indice
 *   dell'utente, HEAD, branch e stash non si toccano, e un file già
 *   fotografato e non cambiato non si rilegge (git confronta dimensione e
 *   data). Senza questo ogni fotografia rileggeva tutti i file nuovi.
 * - Si scrivono solo oggetti nel database di git, che `git gc` ripulisce da
 *   solo quando nessuno li usa più. Per non riempirlo, i file nuovi oltre
 *   MAX_NEW_FILE_BYTES restano fuori; e se i file nuovi da aggiungere sono
 *   più di MAX_NEW_FILES o pesano più di MAX_NEW_TOTAL_BYTES (una cartella
 *   generata non ignorata) non se ne aggiunge nessuno, e lo si dice
 *   (`partial`): aggiungerne un po' a ogni giro farebbe crescere il costo.
 * - I file nuovi si aggiungono con `update-index --add --remove`: uno che
 *   sparisce nel frattempo si toglie invece di far fallire tutto, e i
 *   percorsi non sono pattern. Gli hook dell'utente non partono.
 * - Una fotografia alla volta per repository: l'indice dell'app ha un lock.
 *
 * `run` è iniettabile: i test verificano cosa si chiede a git senza git. */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGit, nativePath } = require('./git-run');
const { gitMessage } = require('./git-branches');

const MAX_NEW_FILE_BYTES = 1024 * 1024;
const MAX_NEW_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_NEW_FILES = 1000;
/* I file nuovi si aggiungono a gruppi: una riga di comando ha un limite */
const ADD_BATCH = 100;
const NOT_A_REPO_RE = /not a git repository/i;
const LOCK_RE = /index\.lock/i;
/* sha1 o sha256: l'unica cosa che il renderer può mandare indietro come «since» */
const TREE_ID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const isTreeId = (s) => typeof s === 'string' && TREE_ID_RE.test(s);

function chunks(list, size) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
}

/* Una fotografia alla volta per indice: la seconda aspetta la prima */
const queues = new Map();
function serialize(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

/* I file nuovi da aggiungere: tutti quelli piccoli, o nessuno se sono troppi */
async function newFilesWithinBudget(listed, root, fsp) {
  if (listed.length > MAX_NEW_FILES) return { picked: [], partial: true };
  const sizes = await Promise.all(listed.map((rel) => fsp.lstat(path.join(root, rel)).then(
    (st) => (st.isFile() || st.isSymbolicLink() ? st.size : Infinity),
    () => Infinity,
  )));
  const small = listed.map((rel, i) => ({ rel, size: sizes[i] })).filter((f) => f.size <= MAX_NEW_FILE_BYTES);
  const total = small.reduce((n, f) => n + f.size, 0);
  return total > MAX_NEW_TOTAL_BYTES ? { picked: [], partial: true } : { picked: small.map((f) => f.rel), partial: false };
}

/* L'indice dell'app per questo repository: nasce come copia di quello vero.
   Solo un indice che non c'è (repository appena nato) vale come vuoto: un
   altro errore farebbe sembrare nuovi tutti i file tracciati. */
async function ensureIndex(realIndex, ownIndex, fsp) {
  try {
    await fsp.access(ownIndex);
    return;
  } catch { /* da creare */ }
  try {
    await fsp.copyFile(realIndex, ownIndex);
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
  }
}

async function takeSnapshot({ root, run, env, ownIndex, realIndex, fsp }) {
  await ensureIndex(realIndex, ownIndex, fsp);
  // Tracciati per l'indice dell'app: cambiati e spariti
  await run(['add', '--update'], { cwd: root, env });
  // Nuovi per l'indice dell'app: dopo la prima volta, solo quelli davvero nuovi
  const listed = String(await run(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, env }))
    .split('\0').filter(Boolean);
  const { picked, partial } = await newFilesWithinBudget(listed, root, fsp);
  for (const batch of chunks(picked, ADD_BATCH)) {
    await run(['update-index', '--add', '--remove', '--', ...batch], { cwd: root, env });
  }
  const tree = (await run(['write-tree'], { cwd: root, env })).trim();
  if (!isTreeId(tree)) throw new Error('git non ha restituito una fotografia valida.');
  return { tree, partial };
}

/**
 * @param {{cwd: string, run?: Function, fsp?: object, tmpdir?: string,
 *   platform?: string, now?: () => number}} o
 * @returns {Promise<{ok: true, root: string, tree: string, at: number, partial: boolean}
 *   | {ok: false, reason?: 'not-a-repo', error?: string}>}
 *   `partial`: troppi file nuovi, una parte è rimasta fuori
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
  try {
    // In un worktree l'indice sta altrove: lo dice git, relativo alla radice o assoluto
    const realIndex = path.resolve(root, (await run(['rev-parse', '--git-path', 'index'], { cwd: root })).trim());
    const dir = path.join(tmpdir, 'ais-snapshots', crypto.createHash('sha1').update(realIndex).digest('hex'));
    await fsp.mkdir(path.join(dir, 'no-hooks'), { recursive: true });
    const ownIndex = path.join(dir, 'index');
    // Gli hook dell'utente (post-index-change…) non c'entrano con la fotografia
    const env = {
      GIT_INDEX_FILE: ownIndex,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: path.join(dir, 'no-hooks'),
    };
    const snap = () => takeSnapshot({ root, run, env, ownIndex, realIndex, fsp });
    const { tree, partial } = await serialize(ownIndex, async () => {
      try {
        return await snap();
      } catch (e) {
        // Un lock rimasto da un'app chiusa male: l'indice è nostro, si rifà
        if (!LOCK_RE.test(gitMessage(e))) throw e;
        await fsp.rm(dir, { recursive: true, force: true });
        await fsp.mkdir(path.join(dir, 'no-hooks'), { recursive: true });
        return snap();
      }
    });
    return { ok: true, root, tree, at: now(), partial };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

module.exports = { snapshotTree, isTreeId, MAX_NEW_FILE_BYTES, MAX_NEW_TOTAL_BYTES, MAX_NEW_FILES };
