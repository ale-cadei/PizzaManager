'use strict';
/* Timeline di un repository git per la sessione di tipo `git`: i branch
 * locali, i loro commit e le corsie su cui disegnarli.
 *
 * Si legge `git log` (lib/git-run.js) e si calcola qui il layout, cioè la
 * colonna di ogni commit e le linee fra una riga e la successiva. Il
 * renderer riceve righe già pronte e si limita a disegnarle.
 *
 * `run` è iniettabile: i test provano parsing e layout senza git installato. */
const path = require('path');
const { runGit } = require('./git-run');
const { buildBranchMap } = require('./git-branch-map');
const { mainWorktreeRoot } = require('./project-root');

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
/* hash, genitori, autore, data ISO, decorazioni, oggetto */
const LOG_FORMAT = ['%H', '%P', '%an', '%aI', '%D', '%s'].join('%x1f') + '%x1e';
/* Remoti riconosciuti a colpo d'occhio se `git remote` non risponde */
const COMMON_REMOTES = ['origin', 'upstream'];

/** @param {{limit?: number, remotes?: boolean}} [o] remotes: anche i branch remoti (per la mappa) */
function gitLogArgs({ limit = DEFAULT_LIMIT, remotes = false } = {}) {
  const n = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT));
  // --branches: solo i branch locali. HEAD in più per una HEAD staccata.
  const refs = remotes ? ['--branches', '--remotes'] : ['--branches'];
  return ['log', ...refs, 'HEAD', '--date-order', `--max-count=${n}`, '--no-color', `--format=${LOG_FORMAT}`];
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

/* Linee fisse a sinistra (docs/plans/34): main, o master se main non c'è,
 * poi develop. Solo branch locali: sono loro ad aprire le corsie. */
const PINNED = [['main', 'master'], ['develop']];

/** @param {string[]} locals nomi dei branch locali @returns {string[]} quelli da fissare, nell'ordine delle colonne */
function pickPinned(locals) {
  const set = new Set(locals);
  return PINNED.map((names) => names.find((n) => set.has(n))).filter(Boolean);
}

/** @returns {string[]} i branch da fissare a sinistra presenti fra i commit, nell'ordine delle colonne */
function pinnedBranches(commits) {
  return pickPinned((Array.isArray(commits) ? commits : [])
    .flatMap((c) => c.refs || []).filter((r) => r.kind === 'branch').map((r) => r.name));
}

/**
 * Colonna fissa di ogni commit sulla catena dei primi genitori di un branch
 * fisso. Un commit comune a due catene resta alla prima (main prima di develop):
 * se develop punta allo stesso commit di main, la sua colonna resta vuota ma riservata.
 * @returns {Map<string, number>} hash → colonna
 */
function pinnedColumns(commits, names) {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const out = new Map();
  names.forEach((name, col) => {
    let c = commits.find((x) => (x.refs || []).some((r) => r.kind === 'branch' && r.name === name));
    while (c && !out.has(c.hash)) {
      out.set(c.hash, col);
      c = byHash.get(c.parents[0]);
    }
  });
  return out;
}

/* Le colonne sotto `reserved` sono delle linee fisse: nessun altro le prende */
const firstFree = (lanes, skip, reserved) => {
  const i = lanes.findIndex((l, j) => l === null && j !== skip && j >= reserved);
  return i < 0 ? Math.max(lanes.length, reserved) : i;
};

const trimLanes = (lanes) => {
  let end = lanes.length;
  while (end > 0 && lanes[end - 1] === null) end--;
  return lanes.slice(0, end);
};

const pinOf = (pins, hash) => (pins.has(hash) ? pins.get(hash) : -1);

/**
 * Stato delle corsie dopo un commit: chi prosegue verso il basso, con che
 * colore e da quale colonna parte la sua linea in questa riga.
 * `pins`: colonne fisse (pinnedColumns); una linea fissa ha colore = colonna.
 */
function advanceLanes(lanes, commit, nextColor, pins, reserved) {
  const pinned = pinOf(pins, commit.hash);
  let col = pinned >= 0 ? pinned : lanes.findIndex((l) => l && l.hash === commit.hash);
  let color;
  let next = nextColor;
  if (pinned >= 0) {
    color = pinned;
  } else if (col < 0) {
    col = firstFree(lanes, -1, reserved);
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
    // Un genitore su una linea fissa va dritto nella sua colonna, se è libera
    const home = pinOf(pins, p);
    const k = home >= 0 && !after[home] ? home : firstFree(after, col, reserved);
    while (after.length <= k) after.push(null);
    after[k] = { hash: p, color: home >= 0 ? home : next++, origin: col };
  }
  return { col, color, after: trimLanes(after), joins, nextColor: next };
}

/**
 * Colonna e linee di ogni commit. Le colonne non si compattano: una corsia
 * resta dov'è finché il suo branch non rientra, così le linee sono dritte.
 * main e develop (pinnedBranches) hanno le prime colonne e i primi colori,
 * sempre; gli altri branch stanno alla loro destra.
 * `color` è un indice: la tavolozza la sceglie chi disegna.
 *
 * @param {Array<{hash: string, parents: string[], refs?: object[]}>} commits dal più recente
 * @param {{pinned?: string[]}} [o] branch da fissare a sinistra, nell'ordine
 * @returns {{rows: Array<{commit: object, col: number, color: number, edges: Array<{from: number, to: number, color: number}>}>, width: number}}
 */
function layoutGraph(commits, { pinned } = {}) {
  const list = Array.isArray(commits) ? commits : [];
  const names = Array.isArray(pinned) ? pinned : pinnedBranches(list);
  const pins = pinnedColumns(list, names);
  const reserved = names.length;
  const steps = [];
  let lanes = [];
  let nextColor = reserved;
  for (const commit of list) {
    const step = advanceLanes(lanes, commit, nextColor, pins, reserved);
    steps.push(step);
    lanes = step.after.map((l) => l && { hash: l.hash, color: l.color });
    nextColor = step.nextColor;
  }
  let width = list.length ? reserved : 0;
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

/* git su Windows scrive la radice con gli slash (`C:/Users/...`), il resto
 * dell'app coi backslash (findProjectRoot): la sidebar raggruppa confrontando
 * la stringa, quindi senza questa passata la scheda git finirebbe in un gruppo
 * suo, lontano dalle altre sessioni dello stesso repository. */
function nativeRoot(root, platform) {
  return platform === 'win32' ? path.win32.normalize(root) : root;
}

const NO_COMMITS = /does not have any commits|unknown revision|bad default revision/i;

/**
 * @param {{cwd: string, limit?: number, run?: (args: string[], o: {cwd: string}) => Promise<string>, platform?: string}} o
 * @returns {Promise<{ok: boolean, root?: string, head?: string|null, rows?: object[], width?: number, truncated?: boolean,
 *   map?: ReturnType<typeof buildBranchMap>, error?: string, notRepo?: boolean}>}
 *   `map`: la mappa dei branch (lib/git-branch-map.js), dagli stessi commit
 */
async function readGitGraph({ cwd, limit = DEFAULT_LIMIT, run = runGit, platform = process.platform } = {}) {
  if (!cwd || typeof cwd !== 'string') return { ok: false, error: 'Directory di lavoro mancante.' };
  const git = (args) => run(args, { cwd });
  let root;
  try {
    // In un worktree git risponde con il worktree: il progetto è quello
    // principale, come per le altre schede (lib/project-root.js)
    const pathImpl = platform === 'win32' ? path.win32 : path;
    root = mainWorktreeRoot(nativeRoot((await git(['rev-parse', '--show-toplevel'])).trim(), platform), { pathImpl });
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
    if (NO_COMMITS.test(msg)) return { ok: true, root, head: null, rows: [], width: 0, truncated: false, map: buildBranchMap([]) };
    return { ok: false, error: 'git log fallito: ' + msg.trim().slice(0, 300) };
  }
  const all = parseGitLog(text, { remotes });
  const commits = all.slice(0, max);
  const headRef = commits.flatMap((c) => c.refs).find((r) => r.head);
  const head = headRef && headRef.kind === 'branch' ? headRef.name : null;
  // I branch fissi dall'elenco dei locali, non dai commit letti: con la storia
  // troncata la punta di main può restare fuori, e la sua colonna va tenuta lo stesso
  const pinned = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .then((t) => pickPinned(t.split('\n').map((x) => x.trim()).filter(Boolean)))
    .catch(() => pinnedBranches(commits));
  const { rows, width } = layoutGraph(commits, { pinned });
  // La mappa unisce locali e remoti (x e origin/x sono un branch solo): una
  // seconda lettura, con --remotes. Se fallisce, la mappa usa i soli locali.
  const mapCommits = await git(gitLogArgs({ limit: max, remotes: true }))
    .then((t) => parseGitLog(t, { remotes }), () => commits);
  return { ok: true, root, head, rows, width, truncated: all.length > max, map: buildBranchMap(mapCommits, { head }) };
}

module.exports = { parseGitLog, parseRefs, layoutGraph, pinnedBranches, gitLogArgs, readGitGraph, FIELD_SEP, RECORD_SEP, DEFAULT_LIMIT };
