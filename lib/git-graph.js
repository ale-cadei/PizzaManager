'use strict';
/* Timeline di un repository git per la sessione di tipo `git`: i branch
 * locali, i loro commit e le corsie su cui disegnarli.
 *
 * Si legge `git log` (lib/git-run.js) e si calcola qui il layout, cioè la
 * colonna di ogni commit e le linee fra una riga e la successiva. Il
 * renderer riceve righe già pronte e si limita a disegnarle.
 *
 * `run` è iniettabile: i test provano parsing e layout senza git installato. */
const { runGit } = require('./git-run');

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
/* hash, genitori, autore, data ISO, decorazioni, oggetto */
const LOG_FORMAT = ['%H', '%P', '%an', '%aI', '%D', '%s'].join('%x1f') + '%x1e';
/* Remoti riconosciuti a colpo d'occhio se `git remote` non risponde */
const COMMON_REMOTES = ['origin', 'upstream'];

/** @param {{limit?: number}} [o] */
function gitLogArgs({ limit = DEFAULT_LIMIT } = {}) {
  const n = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT));
  // --branches: solo i branch locali. HEAD in più per una HEAD staccata.
  return ['log', '--branches', 'HEAD', '--date-order', `--max-count=${n}`, '--no-color', `--format=${LOG_FORMAT}`];
}

/**
 * Decorazioni di `%D` ("HEAD -> main, origin/main, tag: v1").
 * @param {string} text
 * @param {{remotes?: string[]}} [o] nomi dei remoti, per distinguere origin/x da feat/x
 */
function parseRefs(text, { remotes = COMMON_REMOTES } = {}) {
  const out = [];
  for (const raw of String(text || '').split(',')) {
    const part = raw.trim();
    if (!part) continue;
    if (part === 'HEAD') { out.push({ name: 'HEAD', kind: 'head', head: true }); continue; }
    if (part.startsWith('HEAD -> ')) { out.push({ name: part.slice(8), kind: 'branch', head: true }); continue; }
    if (part.startsWith('tag: ')) { out.push({ name: part.slice(5), kind: 'tag', head: false }); continue; }
    const remote = remotes.some((r) => part.startsWith(r + '/'));
    out.push({ name: part, kind: remote ? 'remote' : 'branch', head: false });
  }
  return out;
}

/**
 * @param {string} text output di `git log` con LOG_FORMAT
 * @param {{remotes?: string[]}} [o]
 * @returns {Array<{hash: string, parents: string[], author: string, date: string, refs: object[], subject: string}>}
 */
function parseGitLog(text, options = {}) {
  const out = [];
  for (const record of String(text || '').split(RECORD_SEP)) {
    const fields = record.replace(/^\s+/, '').split(FIELD_SEP);
    if (fields.length < 6 || !fields[0]) continue;
    const [hash, parents, author, date, refs, ...subject] = fields;
    out.push({
      hash,
      parents: parents.split(' ').filter(Boolean),
      author,
      date,
      refs: parseRefs(refs, options),
      subject: subject.join(FIELD_SEP),
    });
  }
  return out;
}

const firstFree = (lanes, skip) => {
  const i = lanes.findIndex((l, j) => l === null && j !== skip);
  return i < 0 ? lanes.length : i;
};

const trimLanes = (lanes) => {
  let end = lanes.length;
  while (end > 0 && lanes[end - 1] === null) end--;
  return lanes.slice(0, end);
};

/**
 * Stato delle corsie dopo un commit: chi prosegue verso il basso, con che
 * colore e da quale colonna parte la sua linea in questa riga.
 */
function advanceLanes(lanes, commit, nextColor) {
  let col = lanes.findIndex((l) => l && l.hash === commit.hash);
  let color;
  let next = nextColor;
  if (col < 0) {
    col = firstFree(lanes, -1);
    color = next++;
  } else {
    color = lanes[col].color;
  }
  // Le corsie in arrivo sullo stesso commit si fermano qui: ci confluiscono
  const after = lanes.map((l, j) => (l && l.hash === commit.hash && j !== col ? null : l && { ...l, origin: j }));
  while (after.length <= col) after.push(null);
  const [first, ...others] = commit.parents;
  after[col] = first ? { hash: first, color, origin: col } : null;
  const joins = [];
  for (const p of others) {
    const existing = after.findIndex((l) => l && l.hash === p);
    if (existing >= 0) { joins.push(existing); continue; }
    const k = firstFree(after, col);
    while (after.length <= k) after.push(null);
    after[k] = { hash: p, color: next++, origin: col };
  }
  return { col, color, after: trimLanes(after), joins, nextColor: next };
}

/**
 * Colonna e linee di ogni commit. Le colonne non si compattano: una corsia
 * resta dov'è finché il suo branch non rientra, così le linee sono dritte.
 * `color` è un indice: la tavolozza la sceglie chi disegna.
 *
 * @param {Array<{hash: string, parents: string[]}>} commits dal più recente
 * @returns {{rows: Array<{commit: object, col: number, color: number, edges: Array<{from: number, to: number, color: number}>}>, width: number}}
 */
function layoutGraph(commits) {
  const list = Array.isArray(commits) ? commits : [];
  const steps = [];
  let lanes = [];
  let nextColor = 0;
  for (const commit of list) {
    const step = advanceLanes(lanes, commit, nextColor);
    steps.push(step);
    lanes = step.after.map((l) => l && { hash: l.hash, color: l.color });
    nextColor = step.nextColor;
  }
  let width = 0;
  const rows = steps.map((step, i) => {
    const nextCommit = list[i + 1];
    const nextCol = nextCommit ? steps[i + 1].col : -1;
    const target = (l, j) => (nextCommit && l.hash === nextCommit.hash ? nextCol : j);
    const edges = [];
    const add = (e) => { if (!edges.some((x) => x.from === e.from && x.to === e.to)) edges.push(e); };
    step.after.forEach((l, j) => { if (l) add({ from: l.origin, to: target(l, j), color: l.color }); });
    for (const j of step.joins) add({ from: step.col, to: target(step.after[j], j), color: step.after[j].color });
    width = Math.max(width, step.col + 1, ...edges.map((e) => Math.max(e.from, e.to) + 1));
    return { commit: list[i], col: step.col, color: step.color, edges };
  });
  return { rows, width };
}

const NO_COMMITS = /does not have any commits|unknown revision|bad default revision/i;

/**
 * @param {{cwd: string, limit?: number, run?: (args: string[], o: {cwd: string}) => Promise<string>}} o
 * @returns {Promise<{ok: boolean, root?: string, head?: string|null, rows?: object[], width?: number, truncated?: boolean, error?: string, notRepo?: boolean}>}
 */
async function readGitGraph({ cwd, limit = DEFAULT_LIMIT, run = runGit } = {}) {
  if (!cwd || typeof cwd !== 'string') return { ok: false, error: 'Directory di lavoro mancante.' };
  const git = (args) => run(args, { cwd });
  let root;
  try {
    root = (await git(['rev-parse', '--show-toplevel'])).trim();
  } catch (e) {
    if (e && e.missing) return { ok: false, error: 'git non è installato o non è nel PATH.' };
    // git c'è (lo dice resolveBinary): ENOENT qui vuol dire cwd inesistente
    if (e && e.code === 'ENOENT') return { ok: false, error: `La directory ${cwd} non esiste.` };
    return { ok: false, notRepo: true, error: `${cwd} non è dentro un repository git.` };
  }
  const remotes = await git(['remote']).then((t) => t.split('\n').map((s) => s.trim()).filter(Boolean), () => COMMON_REMOTES);
  // Un commit in più del limite: se arriva, la storia è davvero troncata
  const max = Number(gitLogArgs({ limit }).find((a) => a.startsWith('--max-count=')).split('=')[1]);
  const args = gitLogArgs({ limit: max + 1 });
  let text;
  try {
    text = await git(args);
  } catch (e) {
    const msg = String((e && (e.stderr || e.message)) || e);
    if (NO_COMMITS.test(msg)) return { ok: true, root, head: null, rows: [], width: 0, truncated: false };
    return { ok: false, error: 'git log fallito: ' + msg.trim().slice(0, 300) };
  }
  const all = parseGitLog(text, { remotes });
  const commits = all.slice(0, max);
  const headRef = commits.flatMap((c) => c.refs).find((r) => r.head);
  const { rows, width } = layoutGraph(commits);
  return { ok: true, root, head: headRef && headRef.kind === 'branch' ? headRef.name : null, rows, width, truncated: all.length > max };
}

module.exports = { parseGitLog, parseRefs, layoutGraph, gitLogArgs, readGitGraph, FIELD_SEP, RECORD_SEP, DEFAULT_LIMIT };
