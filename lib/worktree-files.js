'use strict';
/* I file che git non porta in un worktree (docs/plans/36-sessione-worktree.md).
 *
 * Il worktree nasce con i soli file del commit: niente node_modules, .env,
 * build. Senza node_modules un agente non lancia né i test né l'app, quindi:
 * - node_modules del progetto → symlink (junction su Windows, che non chiede
 *   privilegi di amministratore). Istantaneo e senza spazio; il prezzo noto è
 *   che un `npm install` nel worktree tocca le dipendenze del progetto.
 *   `node_modules/` nel .gitignore vale solo per le cartelle, non per un
 *   symlink: se git non lo ignora, va in info/exclude (locale, mai
 *   committato), altrimenti il worktree sembra sempre «con modifiche» e un
 *   `git add -A` lo committa;
 * - quello che elenca `.worktreeinclude` (sintassi .gitignore, la stessa
 *   convenzione di Claude Code) ed è ignorato da git → copiato, con i
 *   permessi dell'originale: un .env a 0600 resta 0600. Senza il file non si
 *   copia niente, perché l'app non deve decidere da sola di duplicare file
 *   con dei segreti.
 *
 * Quali file corrispondono ai pattern e quali sono ignorati lo dice git
 * (`ls-files --exclude-from`, `check-ignore`): niente reimplementazione delle
 * regole di .gitignore.
 * I percorsi sul disco usano il `path` della macchina; `platform` sceglie
 * solo il tipo di collegamento. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');

const INCLUDE_FILE = '.worktreeinclude';
const NODE_MODULES = 'node_modules';
const SEP_RE = /[\\/]/;
const EXCLUDE_LINE = `/${NODE_MODULES}`;
/* check-ignore esce con 1 quando nessun percorso è ignorato: non è un errore */
const NOTHING_MATCHED = 1;
/* Percorsi per chiamata a check-ignore: la riga di comando ha un limite */
const CHECK_CHUNK = 200;

/**
 * @param {{root: string, dir: string, run?: Function, platform?: string,
 *   symlink?: (target: string, link: string, type: string) => void}} o
 *   `root` cartella principale del progetto, `dir` il worktree appena creato
 * @returns {Promise<string[]>} avvisi per l'utente: quello che non è andato
 *   non annulla il worktree, che resta usabile
 */
async function linkIgnored({ root, dir, run = runGit, platform = process.platform, symlink = fs.symlinkSync } = {}) {
  const linked = await linkNodeModules({ root, dir, run, platform, symlink });
  const copied = await copyIncluded({ root, dir, run });
  return [...linked, ...copied];
}

async function linkNodeModules({ root, dir, run, platform, symlink }) {
  const target = path.join(root, NODE_MODULES);
  const link = path.join(dir, NODE_MODULES);
  // lstat e non exists: un symlink già presente (anche rotto) va lasciato stare
  if (!fs.existsSync(target) || lstatOrNull(link)) return [];
  try {
    symlink(target, link, platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    return [`${NODE_MODULES} non collegato: ${messageOf(e)}`];
  }
  return excludeLinkIfNeeded(run, dir);
}

async function excludeLinkIfNeeded(run, dir) {
  const ignored = await run(['check-ignore', '-q', '--', NODE_MODULES], { cwd: dir }).then(() => true, () => false);
  if (ignored) return [];
  try {
    // info/exclude sta nella directory comune: vale per tutti i worktree del repository
    const file = path.resolve(dir, String(await run(['rev-parse', '--git-path', 'info/exclude'], { cwd: dir })).trim());
    const current = readOrEmpty(file);
    if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${EXCLUDE_LINE}\n`);
    return [];
  } catch (e) {
    return [`${NODE_MODULES} collegato ma git lo vede come file nuovo: non committarlo (${messageOf(e)})`];
  }
}

async function copyIncluded({ root, dir, run }) {
  const include = path.join(root, INCLUDE_FILE);
  if (!fs.existsSync(include)) return [];
  let listed;
  try {
    listed = await run(['ls-files', '--others', '--ignored', `--exclude-from=${include}`, '-z'], { cwd: root });
  } catch (e) {
    return [`${INCLUDE_FILE}: git non ha dato l'elenco dei file da copiare (${messageOf(e)})`];
  }
  const candidates = String(listed || '').split('\0').filter(isCopyable);
  let ignored;
  try {
    // Ignorati nel worktree, dove devono risultare puliti: le regole della
    // cartella principale possono essere diverse (un .gitignore non committato)
    ignored = await ignoredAmong(run, dir, candidates);
  } catch (e) {
    return [`${INCLUDE_FILE}: git non ha detto quali file sono ignorati (${messageOf(e)})`];
  }
  return candidates.filter((rel) => ignored.has(rel)).flatMap((rel) => copyOne(root, dir, rel));
}

/* Come Claude Code: si copia solo quello che git ignora. Un file tracciabile
   copiato nel worktree ci comparirebbe come nuovo, e il worktree non
   risulterebbe mai pulito (Unisci rifiuta, Butta chiede conferma). */
async function ignoredAmong(run, cwd, paths) {
  const chunks = [];
  for (let i = 0; i < paths.length; i += CHECK_CHUNK) chunks.push(paths.slice(i, i + CHECK_CHUNK));
  // -z vale solo con --stdin, che runGit non usa: una riga per percorso, e
  // quotePath=false perché un nome accentato non torni fra virgolette. Un nome
  // con un a capo non corrisponde e non si copia: è il lato sicuro.
  const outputs = await Promise.all(chunks.map((chunk) => run(['-c', 'core.quotePath=false', 'check-ignore', '--', ...chunk], { cwd })
    .catch((e) => (e && e.code === NOTHING_MATCHED ? '' : Promise.reject(e)))));
  return new Set(outputs.flatMap((out) => String(out || '').split('\n').filter(Boolean)));
}

/* Dentro il progetto e fuori da node_modules (già collegato per intero) */
function isCopyable(rel) {
  if (!rel || path.isAbsolute(rel)) return false;
  const parts = rel.split(SEP_RE);
  return !parts.includes('..') && parts[0] !== NODE_MODULES;
}

function copyOne(root, dir, rel) {
  const from = path.join(root, rel);
  const to = path.join(dir, rel);
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    // copyFileSync non garantisce i permessi su ogni piattaforma: si rimettono
    fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    return [];
  } catch (e) {
    return [`${rel}: non copiato nel worktree (${messageOf(e)})`];
  }
}

function readOrEmpty(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

const messageOf = (e) => String((e && e.message) || e);

module.exports = { linkIgnored, INCLUDE_FILE };
