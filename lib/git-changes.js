'use strict';
/* Pannello «cosa ha cambiato» (docs/plans/32-pannello-modifiche.md): i file
 * toccati in una cartella di lavoro e il diff di uno di loro.
 *
 * - Nella cartella principale si confronta con `HEAD`: quello che non è
 *   ancora committato (staged, non staged, file nuovi).
 * - In un worktree con una base (`branch.<nome>.pizzaBase`, piano 36) si
 *   confronta con il punto in cui il branch si è staccato dalla base: commit
 *   del branch più il non committato, cioè tutto il lavoro dell'agente.
 * - Solo letture, tutte da lib/git-run.js (niente lock facoltativi).
 * - Il renderer non deve poter far leggere un file qualsiasi: il diff si dà
 *   solo per un percorso che compare nell'elenco attuale delle modifiche, e
 *   i file nuovi si leggono solo se sono file veri (niente collegamenti).
 *
 * `run` è iniettabile: i test provano parsing e scelte senza git. */
const fs = require('fs');
const path = require('path');
const { runGit, nativePath } = require('./git-run');
const { validateBranchName, gitMessage } = require('./git-branches');

const MAX_FILES = 1000;
/* Un file nuovo più grande non si conta riga per riga: costerebbe a ogni giro */
const MAX_COUNT_BYTES = 256 * 1024;
/* Un file nuovo più grande si mostra solo in parte */
const MAX_READ_BYTES = 1024 * 1024;
const MAX_DIFF_LINES = 3000;
const NOT_A_REPO_RE = /not a git repository/i;
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const BINARY_RE = /^(?:Binary files .* differ|GIT binary patch)$/;

/* Opzioni comuni ai diff: niente colori, niente programmi esterni configurati
   dall'utente (diff.external, textconv), nomi con accenti leggibili */
const GIT_GLOBAL = ['-c', 'core.quotepath=off'];
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];

const splitNul = (text) => String(text || '').split('\0');

/** Elenco separato da NUL (`ls-files -z`) */
function parseNulList(text) {
  return splitNul(text).filter(Boolean);
}

/* Lettere di git → quelle del pannello: un cambio di tipo è una modifica, una
   copia è un file nuovo, un conflitto aperto è una modifica */
const STATUS = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'A', T: 'M', U: 'M' };

/** `git diff --name-status -z`: `M\0path\0`, `R087\0vecchio\0nuovo\0` */
function parseNameStatus(text) {
  const parts = splitNul(text);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const letter = parts[i].charAt(0);
    const status = STATUS[letter];
    if (!status) continue;
    if (letter === 'R' || letter === 'C') {
      const [oldPath, newPath] = [parts[i + 1], parts[i + 2]];
      i += 2;
      if (!newPath) continue;
      out.push(letter === 'R' ? { status, path: newPath, oldPath } : { status, path: newPath });
    } else {
      const p = parts[i + 1];
      i += 1;
      if (p) out.push({ status, path: p });
    }
  }
  return out;
}

const toCount = (s) => (s === '-' ? null : Number(s));

/** `git diff --numstat -z`: `12\t3\tpath\0`, binari `-\t-\t`, rinominati `4\t1\t\0vecchio\0nuovo\0` */
function parseNumstat(text) {
  const parts = splitNul(text);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    const binary = m[1] === '-';
    const counts = { added: toCount(m[1]), removed: toCount(m[2]), binary };
    if (m[3]) { out.push({ path: m[3], ...counts }); continue; }
    const [oldPath, newPath] = [parts[i + 1], parts[i + 2]];
    i += 2;
    if (newPath) out.push({ path: newPath, oldPath, ...counts });
  }
  return out;
}

/**
 * Un elenco solo: stato da name-status, righe da numstat, e i file letti dal
 * disco (non tracciati, o tutto in un repository senza commit).
 * @param {Array<{status: string, path: string, oldPath?: string}>} statuses
 * @param {Array<{path: string, added: number|null, removed: number|null, binary: boolean}>} numstats
 * @param {Array<{path: string, status?: string, added: number|null, removed: number, binary: boolean}>} fromDisk
 */
function mergeChanges(statuses, numstats, fromDisk = []) {
  const counts = new Map(numstats.map((n) => [n.path, n]));
  const tracked = statuses.map((s) => {
    const n = counts.get(s.path) || { added: null, removed: null, binary: false };
    const file = { path: s.path, status: s.status, added: n.added, removed: n.removed, binary: n.binary };
    return s.oldPath ? { ...file, oldPath: s.oldPath } : file;
  });
  const seen = new Set(tracked.map((f) => f.path));
  const disk = fromDisk.filter((f) => !seen.has(f.path)).map((f) => ({
    path: f.path, status: f.status || '?', added: f.added, removed: f.removed, binary: f.binary, untracked: true,
  }));
  return [...tracked, ...disk].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Righe di un contenuto; un NUL nei primi 8 KB = binario, come fa git */
function countLines(buf) {
  if (buf.subarray(0, 8000).includes(0)) return { lines: 0, binary: true };
  if (!buf.length) return { lines: 0, binary: false };
  let lines = 0;
  for (const byte of buf) if (byte === 0x0a) lines += 1;
  return { lines: buf[buf.length - 1] === 0x0a ? lines : lines + 1, binary: false };
}

/**
 * Diff unificato di un file → blocchi e righe numerate. Le intestazioni
 * (`diff --git`, `---`, `+++`) si saltano: il pannello sa già di che file si
 * tratta.
 * @returns {{binary: boolean, truncated: boolean, hunks: Array<{header: string,
 *   lines: Array<{kind: 'add'|'del'|'ctx'|'note', oldNo: number|null, newNo: number|null, text: string}>}>}}
 */
function parseUnifiedDiff(text, { maxLines = MAX_DIFF_LINES } = {}) {
  const hunks = [];
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  let count = 0;
  let binary = false;
  let truncated = false;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) { hunk = null; continue; }
    const m = HUNK_RE.exec(line);
    if (m) {
      hunk = { header: line, lines: [] };
      hunks.push(hunk);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }
    if (!hunk) { if (BINARY_RE.test(line)) binary = true; continue; }
    if (!line) continue;
    if (count >= maxLines) { truncated = true; break; }
    const sign = line.charAt(0);
    const rest = line.slice(1);
    if (sign === '+') hunk.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: rest });
    else if (sign === '-') hunk.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: rest });
    else if (sign === ' ') hunk.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: rest });
    else if (sign === '\\') hunk.lines.push({ kind: 'note', oldNo: null, newNo: null, text: rest.trim() });
    else continue;
    count += 1;
  }
  return { binary, truncated, hunks: hunks.filter((h) => h.lines.length) };
}

/**
 * Un percorso relativo che resta dentro la radice: niente assoluti, niente
 * `..`, niente NUL. Separatori `/` e `\` su Windows.
 */
function isSafeRelative(rel, { platform = process.platform } = {}) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return false;
  const impl = platform === 'win32' ? path.win32 : path.posix;
  if (impl.isAbsolute(rel) || path.posix.isAbsolute(rel)) return false;
  const segments = rel.split(platform === 'win32' ? /[\\/]/ : /\//);
  return !segments.includes('..');
}

/* Un file letto dal disco, solo se è un file vero dentro la radice */
function lstatRegular(root, rel, fsImpl) {
  try {
    const st = fsImpl.lstatSync(path.join(root, rel));
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

function readHead(file, bytes, fsImpl) {
  const fd = fsImpl.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fsImpl.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    fsImpl.closeSync(fd);
  }
}

function countFromDisk(root, rel, { status, maxCountBytes, fsImpl }) {
  const base = { path: rel, status, added: null, removed: 0, binary: false };
  const st = lstatRegular(root, rel, fsImpl);
  if (!st || st.size > maxCountBytes) return base;
  try {
    const { lines, binary } = countLines(readHead(path.join(root, rel), st.size, fsImpl));
    return { ...base, added: binary ? null : lines, binary };
  } catch {
    return base;
  }
}

const sum = (files, key) => files.reduce((n, f) => n + (typeof f[key] === 'number' ? f[key] : 0), 0);

function invalidBase(base) {
  if (base === undefined || base === null || base === '') return null;
  if (typeof base !== 'string') return 'Base non valida.';
  return validateBranchName(base) ? `Base non valida: ${base}` : null;
}

async function verify(run, root, ref) {
  return run(['rev-parse', '--verify', '--quiet', ref], { cwd: root }).then((t) => t.trim() || null, () => null);
}

/* Il commit con cui confrontare: il punto di partenza dalla base se c'è,
   altrimenti HEAD; null in un repository senza commit */
async function resolveAgainst(run, root, base) {
  if (base && await verify(run, root, `refs/heads/${base}`)) {
    const sha = await run(['merge-base', `refs/heads/${base}`, 'HEAD'], { cwd: root }).then((t) => t.trim(), () => '');
    if (sha) return { against: sha, base };
  }
  return { against: await verify(run, root, 'HEAD^{commit}'), base: null };
}

async function listTracked(run, root, against) {
  const diff = (mode) => run([...GIT_GLOBAL, 'diff', ...DIFF_FLAGS, '-z', mode, against], { cwd: root });
  const [statuses, numstats] = await Promise.all([diff('--name-status'), diff('--numstat')]);
  return { statuses: parseNameStatus(statuses), numstats: parseNumstat(numstats) };
}

/* Con una base l'elenco mescola commit del branch e lavoro in corso: quanti
   file non sono ancora in un commit lo dice il confronto con HEAD. Serve a
   «Unisci», che con lavoro non committato viene rifiutato (lib/worktree.js).
   Se la lettura non riesce il numero manca (null): l'elenco resta valido. */
async function countUncommitted(run, root, target, total, untracked) {
  if (!target.base) return total;
  try {
    const tracked = parseNulList(await run([...GIT_GLOBAL, 'diff', '--name-only', '-z', 'HEAD'], { cwd: root }));
    return tracked.length + untracked;
  } catch {
    return null;
  }
}

async function listOnDisk(run, root, { cached }) {
  const args = cached ? ['ls-files', '--cached', '-z'] : ['ls-files', '--others', '--exclude-standard', '-z'];
  return parseNulList(await run([...GIT_GLOBAL, ...args], { cwd: root }));
}

/**
 * I file toccati in `cwd`, rispetto a HEAD o, con `base`, al punto in cui il
 * branch si è staccato dalla base.
 * @param {{cwd: string, base?: string|null, run?: Function, fsImpl?: object,
 *   platform?: string, maxFiles?: number, maxCountBytes?: number}} o
 * @returns {Promise<{ok: true, root: string, against: string|null, base: string|null,
 *   files: object[], totals: {files: number, added: number, removed: number}, truncated: boolean,
 *   uncommitted: number|null}
 *   | {ok: false, reason?: 'not-a-repo', error?: string}>}
 */
async function readChanges({
  cwd, base = null, run = runGit, fsImpl = fs, platform = process.platform,
  maxFiles = MAX_FILES, maxCountBytes = MAX_COUNT_BYTES,
} = {}) {
  if (typeof cwd !== 'string' || !cwd) return { ok: false, error: 'Directory di lavoro mancante.' };
  const baseError = invalidBase(base);
  if (baseError) return { ok: false, error: baseError };
  let root;
  try {
    root = nativePath((await run(['rev-parse', '--show-toplevel'], { cwd })).trim(), platform);
  } catch (e) {
    const error = gitMessage(e);
    return NOT_A_REPO_RE.test(error) ? { ok: false, reason: 'not-a-repo' } : { ok: false, error };
  }
  try {
    const target = await resolveAgainst(run, root, base || null);
    const { statuses, numstats } = target.against
      ? await listTracked(run, root, target.against)
      : { statuses: [], numstats: [] };
    const staged = target.against ? [] : await listOnDisk(run, root, { cached: true });
    const others = await listOnDisk(run, root, { cached: false });
    // Si leggono dal disco solo i file che finiranno nell'elenco mostrato
    const room = Math.max(0, maxFiles - statuses.length);
    const fromDisk = [
      ...staged.map((p) => ({ p, status: 'A' })),
      ...others.map((p) => ({ p, status: '?' })),
    ].slice(0, room).map(({ p, status }) => countFromDisk(root, p, { status, maxCountBytes, fsImpl }));
    const all = mergeChanges(statuses, numstats, fromDisk);
    const total = statuses.length + staged.length + others.length;
    const files = all.slice(0, maxFiles);
    return {
      ok: true, root, against: target.against, base: target.base, files,
      totals: { files: total, added: sum(all, 'added'), removed: sum(all, 'removed') },
      truncated: total > files.length,
      uncommitted: await countUncommitted(run, root, target, total, others.length),
    };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

/* Un file nuovo letto dal disco, mostrato come tutto aggiunto */
function diffFromDisk(root, rel, { maxLines, fsImpl }) {
  const st = lstatRegular(root, rel, fsImpl);
  if (!st) return { ok: false, error: 'Non è un file normale: non lo apro.' };
  const buf = readHead(path.join(root, rel), Math.min(st.size, MAX_READ_BYTES), fsImpl);
  if (countLines(buf).binary) return { binary: true, truncated: false, hunks: [] };
  const text = buf.toString('utf8');
  const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  const shown = text ? lines.slice(0, maxLines) : [];
  const hunks = shown.length ? [{
    header: `@@ -0,0 +1,${lines.length} @@`,
    lines: shown.map((t, i) => ({ kind: 'add', oldNo: null, newNo: i + 1, text: t })),
  }] : [];
  return { binary: false, truncated: lines.length > shown.length || st.size > buf.length, hunks };
}

/**
 * Il diff di un file dell'elenco attuale. Un percorso che non c'è (o che
 * esce dalla radice) si rifiuta prima di chiedere qualcosa a git o al disco.
 * @param {{cwd: string, path: string, base?: string|null, run?: Function,
 *   fsImpl?: object, platform?: string, maxLines?: number}} o
 */
async function readFileDiff({
  cwd, path: rel, base = null, run = runGit, fsImpl = fs, platform = process.platform, maxLines = MAX_DIFF_LINES,
} = {}) {
  if (!isSafeRelative(rel, { platform })) return { ok: false, error: 'Percorso non valido.' };
  const changes = await readChanges({ cwd, base, run, fsImpl, platform, maxFiles: Number.MAX_SAFE_INTEGER, maxCountBytes: 0 });
  if (!changes.ok) return changes;
  const file = changes.files.find((f) => f.path === rel);
  if (!file) return { ok: false, error: 'Il file non è più fra le modifiche.' };
  try {
    const diff = file.untracked || !changes.against
      ? diffFromDisk(changes.root, rel, { maxLines, fsImpl })
      : parseUnifiedDiff(await run([
        ...GIT_GLOBAL, '--literal-pathspecs', 'diff', ...DIFF_FLAGS, changes.against,
        '--', ...(file.oldPath ? [file.oldPath] : []), rel,
      ], { cwd: changes.root }), { maxLines });
    if (diff.ok === false) return diff;
    return { ok: true, path: rel, status: file.status, ...diff };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

module.exports = {
  parseNameStatus, parseNumstat, parseNulList, mergeChanges, parseUnifiedDiff,
  countLines, isSafeRelative, readChanges, readFileDiff,
  MAX_FILES, MAX_DIFF_LINES,
};
