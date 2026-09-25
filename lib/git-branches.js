'use strict';
/* Cambiare branch dalla sessione git (docs/plans/26): elenco dei branch
 * locali e remoti, passaggio a uno di loro, creazione di uno nuovo.
 *
 * Si usa `git switch`, mai con --force o --discard-changes: se le modifiche
 * non committate andrebbero perse git rifiuta, e il suo messaggio arriva
 * all'utente così com'è. Un nome che comincia con `-` non arriva mai a git:
 * lo leggerebbe come un'opzione.
 *
 * `run` è iniettabile: i test verificano cosa si chiede a git senza git. */
const { runGit } = require('./git-run');

const FIELD_SEP = '\x1f';
const MAX_ERROR = 600;
/* for-each-ref scrive un byte come %xx (git log invece vuole %x1f) */
const FORMAT = ['%(refname)', '%(HEAD)', '%(upstream:short)'].join('%1f');

/* Le regole di `git check-ref-format --branch`, per rispondere subito nella
   UI; createBranch chiede comunque conferma a git prima di creare. */
const FORBIDDEN = [
  /^-/, /\s/, /\.\./, /[~^:?*[\\]/, /@\{/, /\/\//, /(^|\/)\./, /\/$/, /^\//, /\.lock$/, /\.$/,
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1f\x7f]/,
];

/** @returns {string|null} il problema del nome, o null se va bene */
function validateBranchName(name) {
  const n = String(name || '').trim();
  if (!n) return 'Scrivi un nome per il branch.';
  if (n === '@' || FORBIDDEN.some((re) => re.test(n))) {
    return `"${n}" non è un nome valido per un branch git (niente spazi, .., ~ ^ : ? * [ \\, né - all'inizio).`;
  }
  return null;
}

/**
 * Output di `git for-each-ref` con FORMAT.
 * @returns {{local: Array<{name: string, current: boolean, upstream: string}>, remote: Array<{name: string, remote: string, short: string, hasLocal: boolean}>}}
 */
function parseBranches(text) {
  const local = [];
  const remote = [];
  for (const row of String(text || '').split('\n')) {
    const [ref, head, upstream = ''] = row.split(FIELD_SEP);
    if (!ref) continue;
    if (ref.startsWith('refs/heads/')) {
      local.push({ name: ref.slice('refs/heads/'.length), current: head === '*', upstream });
      continue;
    }
    if (!ref.startsWith('refs/remotes/')) continue;
    const name = ref.slice('refs/remotes/'.length);
    const slash = name.indexOf('/');
    if (slash <= 0) continue;
    const short = name.slice(slash + 1);
    // origin/HEAD è un puntatore al branch di default, non un branch
    if (short === 'HEAD') continue;
    remote.push({ name, remote: name.slice(0, slash), short, hasLocal: false });
  }
  const names = new Set(local.map((b) => b.name));
  return { local, remote: remote.map((r) => ({ ...r, hasLocal: names.has(r.short) })) };
}

/* Il messaggio di git, senza la riga "Command failed" di execFile */
function gitMessage(e) {
  const text = String((e && (e.stderr || e.message)) || e).trim();
  return (text || 'git ha rifiutato l\'operazione.').slice(0, MAX_ERROR);
}

const noCwd = () => ({ ok: false, error: 'Directory di lavoro mancante.' });
const validCwd = (cwd) => Boolean(cwd) && typeof cwd === 'string';

/** @param {{cwd: string, run?: Function}} o */
async function listBranches({ cwd, run = runGit } = {}) {
  if (!validCwd(cwd)) return noCwd();
  try {
    const text = await run(['for-each-ref', `--format=${FORMAT}`, 'refs/heads', 'refs/remotes'], { cwd });
    return { ok: true, ...parseBranches(text) };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

/* Un remoto "origin/fix/y" diventa il locale "fix/y": se c'è già si passa a
   quello, altrimenti lo si crea che segue il remoto. */
async function switchArgs({ cwd, name, kind, run }) {
  if (kind === 'local') return { args: ['switch', name], branch: name };
  const slash = name.indexOf('/');
  const short = slash > 0 ? name.slice(slash + 1) : '';
  if (!short || validateBranchName(short)) return { error: `"${name}" non è un branch remoto valido.` };
  const hasLocal = await run(['rev-parse', '--verify', '--quiet', `refs/heads/${short}`], { cwd }).then(() => true, () => false);
  return hasLocal ? { args: ['switch', short], branch: short } : { args: ['switch', '--track', name], branch: short };
}

/** @param {{cwd: string, name: string, kind: 'local'|'remote', run?: Function}} o */
async function switchBranch({ cwd, name, kind, run = runGit } = {}) {
  if (!validCwd(cwd)) return noCwd();
  if (kind !== 'local' && kind !== 'remote') return { ok: false, error: 'Tipo di branch sconosciuto.' };
  if (typeof name !== 'string' || !name || validateBranchName(name)) return { ok: false, error: `"${name || ''}" non è un nome di branch valido.` };
  try {
    const plan = await switchArgs({ cwd, name, kind, run });
    if (plan.error) return { ok: false, error: plan.error };
    await run(plan.args, { cwd });
    return { ok: true, branch: plan.branch };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

/** Nuovo branch dal commit corrente, e ci si passa. */
async function createBranch({ cwd, name, run = runGit } = {}) {
  if (!validCwd(cwd)) return noCwd();
  const branch = String(name || '').trim();
  const problem = validateBranchName(branch);
  if (problem) return { ok: false, error: problem };
  try {
    await run(['check-ref-format', '--branch', branch], { cwd });
  } catch {
    return { ok: false, error: `"${branch}" non è un nome valido per un branch git.` };
  }
  try {
    await run(['switch', '-c', branch], { cwd });
    return { ok: true, branch };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

module.exports = { parseBranches, validateBranchName, listBranches, switchBranch, createBranch, FIELD_SEP };
