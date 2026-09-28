'use strict';
/* Mappa dei branch della sessione git (docs/plans/31-mappa-branch.md): il
 * tronco (main) è una linea orizzontale e ogni branch se ne stacca dal commit
 * da cui è nato; un branch nato da un altro si stacca da quello, uno già unito
 * ci rientra nel commit di merge.
 *
 * Due passi, entrambi puri:
 * - branchTopology (lib/git-branch-topology.js): chi nasce da chi, chi è unito e dove;
 * - layoutBranchMap (qui): colonna di ogni commit e corsia di ogni linea.
 * Il renderer (renderer/git-map-view.js) converte colonne e corsie in pixel. */
const { branchTopology } = require('./git-branch-topology');

/* Una colonna è larga circa 2,5 caratteri del nome di un branch: 18px di
   colonna e ~7px a carattere nel renderer. Serve a riservare il posto ai nomi. */
const CHARS_PER_COL = 2.5;
/* Dopo il nome di un branch unito: " ✓ 28/09" */
const MERGED_SUFFIX = 8;
/* Un tratto del tronco senza eventi, da MIN_GAP commit in su, diventa un
   segno "+N" largo GAP_COLS colonne */
const MIN_GAP = 2;
const GAP_COLS = 2;

const EMPTY_LAYOUT = Object.freeze({ lines: [], columns: 0, minLane: 0, maxLane: 0 });

/** Linee da mostrare: le aperte, e i padri di quelle mostrate anche se uniti. */
function visibleBranches(topology, includeMerged) {
  const byId = new Map(topology.branches.map((b) => [b.id, b]));
  const keep = new Set();
  for (const b of topology.branches) {
    if (b.merged && !includeMerged) continue;
    for (let x = b; x && !keep.has(x.id); x = byId.get(x.parent)) keep.add(x.id);
  }
  return topology.branches.filter((b) => keep.has(b.id));
}

/**
 * Colonna di ogni commit mostrato, dal più vecchio. I tratti del tronco senza
 * eventi (nessun branch che ne esce o ci rientra) si comprimono in un segno.
 */
function assignColumns(lines, commits) {
  const [trunk] = lines;
  const age = new Map(commits.map((c, i) => [c.hash, i]));
  const lineOf = new Map();
  for (const line of lines) for (const h of line.commits) lineOf.set(h, line.id);
  const anchors = new Set([trunk.tip, trunk.commits[0]]);
  for (const line of lines.slice(1)) {
    if (line.fork) anchors.add(line.fork);
    if (line.merge) anchors.add(line.merge);
  }
  const col = new Map();
  const gaps = [];
  let next = 0;
  let run = [];
  const flush = () => {
    if (run.length >= MIN_GAP) {
      gaps.push({ col: next + (GAP_COLS - 1) / 2, count: run.length });
      next += GAP_COLS;
    } else {
      for (const h of run) col.set(h, next++);
    }
    run = [];
  };
  for (const h of [...lineOf.keys()].sort((a, b) => age.get(b) - age.get(a))) {
    if (lineOf.get(h) === trunk.id && !anchors.has(h)) { run.push(h); continue; }
    flush();
    col.set(h, next++);
  }
  flush();
  return { col, gaps };
}

/** Colonne occupate dal nome, con " #37" e " ✓ 28/09" se ci sono. */
function labelCols(line) {
  const length = line.name.length + (line.pr ? String(line.pr).length + 2 : 0) + (line.merged ? MERGED_SUFFIX : 0);
  return Math.ceil(length / CHARS_PER_COL) + 1;
}

/**
 * Corsia di ogni linea: 0 è il tronco, negativo sopra, positivo sotto. I figli
 * del tronco vanno sulla corsia libera più vicina (sopra, a pari distanza); un
 * figlio di un branch sta dalla sua stessa parte, più lontano. Una corsia è
 * libera se nessuno la occupa fra il punto di stacco e la fine del nome o il
 * ritorno sul tronco.
 */
function assignLanes(lines) {
  const taken = new Map();
  const free = (lane, [s, e]) => !(taken.get(lane) || []).some(([a, b]) => s <= b && a <= e);
  const lanes = new Map([[lines[0].id, 0]]);
  const order = lines.slice(1).map((line, i) => ({ line, i }))
    .sort((a, b) => (a.line.forkCol ?? 0) - (b.line.forkCol ?? 0) || a.i - b.i);
  for (const { line } of order) {
    const span = [line.forkCol ?? 0, Math.max(line.mergeCol ?? line.endCol, line.startCol + labelCols(line))];
    const parentLane = lanes.get(line.parent);
    let lane;
    if (parentLane === 0) {
      let up = -1;
      while (!free(up, span)) up--;
      let down = 1;
      while (!free(down, span)) down++;
      lane = -up <= down ? up : down;
    } else {
      const step = Math.sign(parentLane);
      lane = parentLane + step;
      while (!free(lane, span)) lane += step;
    }
    lanes.set(line.id, lane);
    taken.set(lane, [...(taken.get(lane) || []), span]);
  }
  return lanes;
}

/**
 * @param {ReturnType<typeof branchTopology>} topology
 * @param {object[]} commits gli stessi passati a branchTopology
 * @param {{includeMerged?: boolean}} [o] anche i branch già uniti al tronco
 * @returns {{lines: object[], columns: number, minLane: number, maxLane: number}}
 */
function layoutBranchMap(topology, commits, { includeMerged = false } = {}) {
  if (!topology || !topology.trunk) return EMPTY_LAYOUT;
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const shown = visibleBranches(topology, includeMerged);
  const { col, gaps } = assignColumns(shown, commits);
  const dot = (h) => {
    const c = byHash.get(h);
    return { hash: h, col: col.get(h), subject: c.subject, date: c.date, merge: c.parents.length > 1 };
  };
  const lines = shown.map(({ commits: own, ...b }) => {
    const dots = own.filter((h) => col.has(h)).map(dot);
    const forkCol = b.fork ? col.get(b.fork) : null;
    const startCol = dots.length ? dots[0].col : (forkCol ?? 0) + 1;
    return {
      ...b, count: own.length,
      forkCol, startCol, endCol: dots.length ? dots[dots.length - 1].col : startCol,
      mergeCol: b.merge ? col.get(b.merge) : null,
      mergeDate: b.merge ? byHash.get(b.merge).date : null,
      dots, gaps: b.parent ? [] : gaps,
    };
  });
  const lanes = assignLanes(lines);
  const placed = lines.map((l) => ({ ...l, lane: lanes.get(l.id), parentLane: l.parent ? lanes.get(l.parent) : null }));
  const reach = placed.map((l) => Math.max(l.mergeCol ?? l.endCol, l.startCol + labelCols(l)));
  return {
    lines: placed,
    columns: Math.max(...reach, placed[0].endCol + labelCols(placed[0])) + 1,
    minLane: Math.min(...placed.map((l) => l.lane)),
    maxLane: Math.max(...placed.map((l) => l.lane)),
  };
}

/**
 * Le due mappe che il renderer alterna: tutti i branch (predefinita) e solo
 * quelli aperti. `hiddenCount`: quante linee compaiono solo nella prima.
 * @param {object[]} commits come parseGitLog, dal più recente
 * @param {{head?: string|null}} [o]
 */
function buildBranchMap(commits, { head = null } = {}) {
  const list = Array.isArray(commits) ? commits : [];
  const topology = branchTopology(list, { head });
  const open = layoutBranchMap(topology, list);
  const all = layoutBranchMap(topology, list, { includeMerged: true });
  return { open, all, hiddenCount: all.lines.length - open.lines.length };
}

module.exports = { branchTopology, layoutBranchMap, buildBranchMap, CHARS_PER_COL };
