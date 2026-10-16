'use strict';
/* I worktree nella timeline git (docs/plans/66-grafo-worktree.md): quali
 * branch vivono in un worktree e quali linee del grafo sono di un worktree,
 * vivo o già unito. Il renderer le tratteggia.
 *
 * Una linea è di un worktree se la apre (il suo commit più recente):
 * - la punta del branch di un worktree vivo (`git worktree list`);
 * - il secondo genitore di un merge firmato da «Unisci» (lib/worktree-path.js),
 *   anche se il branch è stato cancellato.
 * Le linee fisse (main, develop) non lo sono mai: un worktree senza commit
 * suoi sta sulla linea della base, e lì resta solo l'etichetta. */
const { parseWorktreeList } = require('./worktree');
const { isWorktreeMerge } = require('./worktree-path');

/**
 * Branch dei worktree, tolto il principale (il primo dell'elenco).
 * Se git non risponde, nessun worktree: la timeline si disegna lo stesso.
 * @param {(args: string[]) => Promise<string>} git
 * @returns {Promise<Set<string>>}
 */
async function readWorktreeBranches(git, { platform = process.platform } = {}) {
  try {
    const list = parseWorktreeList(await git(['worktree', 'list', '--porcelain']), { platform });
    return new Set(list.slice(1).filter((w) => w.branch && !w.prunable).map((w) => w.branch));
  } catch {
    return new Set();
  }
}

/** Copie dei commit con `worktree: true` sui ref dei branch dei worktree. */
function markWorktreeRefs(commits, branches) {
  if (!branches || !branches.size) return commits;
  return commits.map((c) => ({
    ...c,
    refs: (c.refs || []).map((r) => (r.kind === 'branch' && branches.has(r.name) ? { ...r, worktree: true } : r)),
  }));
}

/**
 * @param {Array<{commit: object, color: number}>} rows come layoutGraph, dal più recente
 * @param {{branches?: Set<string>, reserved?: number}} [o] reserved: quante sono le linee fisse
 * @returns {number[]} indici di colore delle linee dei worktree, in ordine
 */
function worktreeLanes(rows, { branches = new Set(), reserved = 0 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const opener = new Map(); // colore → hash del commit che apre la linea
  for (const r of list) if (!opener.has(r.color)) opener.set(r.color, r.commit.hash);
  const rowOf = new Map(list.map((r) => [r.commit.hash, r]));
  const opens = (hash) => {
    const row = rowOf.get(hash);
    return row && row.color >= reserved && opener.get(row.color) === hash ? row.color : -1;
  };
  const out = new Set();
  for (const r of list) {
    const live = (r.commit.refs || []).some((ref) => ref.kind === 'branch' && branches.has(ref.name));
    if (live) out.add(opens(r.commit.hash));
    if (r.commit.parents.length > 1 && isWorktreeMerge(r.commit.subject)) out.add(opens(r.commit.parents[1]));
  }
  out.delete(-1);
  return [...out].sort((a, b) => a - b);
}

module.exports = { readWorktreeBranches, markWorktreeRefs, worktreeLanes };
