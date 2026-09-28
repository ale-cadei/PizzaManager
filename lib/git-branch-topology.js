'use strict';
/* Chi nasce da chi, per la mappa dei branch (docs/plans/31-mappa-branch.md).
 *
 * Git non registra da quale branch ne nasce un altro: lo si ricostruisce dai
 * commit già letti (lib/git-graph.js). Ogni linea segue il primo genitore
 * finché incontra un commit di una linea già presa, e lì si stacca.
 *
 * Le linee si prendono in quest'ordine:
 * 1. il tronco (main), lungo il primo genitore;
 * 2. ogni merge sul tronco, dal più vecchio: il secondo genitore è la punta di
 *    un branch unito. Se un branch (locale o remoto) punta ancora lì prende il
 *    suo nome, altrimenti il nome viene dal messaggio del merge ("Merge pull
 *    request #37 from ale/feat/x"): così si vedono anche i branch cancellati;
 * 3. i branch rimasti, locali e remoti insieme (x e origin/x sono lo stesso
 *    branch). I commit in comune li prende la linea più lunga. */

const TRUNK_NAMES = ['main', 'master', 'trunk'];
const HASH_LEN = 7;

/**
 * Nome del branch e numero della PR dal messaggio di un merge.
 * @param {string} subject
 * @returns {{name: string, pr: number|null}|null} null se il messaggio non è riconoscibile
 */
function parseMergeSubject(subject) {
  const s = String(subject || '');
  const pr = s.match(/^Merge pull request #(\d+) from [^/\s]+\/(\S+)/);
  if (pr) return { name: pr[2], pr: Number(pr[1]) };
  const remote = s.match(/^Merge remote-tracking branch '[^'/]+\/([^']+)'/);
  if (remote) return { name: remote[1], pr: null };
  const local = s.match(/^Merge branch '([^']+)'/);
  if (local) return { name: local[1], pr: null };
  return null;
}

/**
 * Nome di un branch cancellato, dal messaggio del suo merge. "Merge branch
 * 'main' of github.com:…" lo scrive `git pull` quando il main locale e quello
 * remoto si sono separati: porta i commit del remoto, non un branch.
 */
function mergeLabel(parsed, merge, trunk) {
  if (!parsed) return `merge ${merge.slice(0, HASH_LEN)}`;
  return parsed.name === trunk ? `${trunk} (pull)` : parsed.name;
}

/**
 * Branch per nome, locali e remoti insieme. `origin/HEAD` non è un branch.
 * Con più remoti (origin, old-origin, upstream) vale origin, se ha quel branch.
 */
function branchRefs(commits) {
  const local = new Map();
  const remote = new Map();
  const fromOrigin = new Set();
  const heads = new Set();
  for (const c of commits) {
    for (const ref of c.refs || []) {
      if (ref.kind === 'branch') {
        local.set(ref.name, c.hash);
        if (ref.head) heads.add(ref.name);
      } else if (ref.kind === 'remote') {
        const name = ref.name.slice(ref.name.indexOf('/') + 1);
        const isOrigin = ref.name.startsWith('origin/');
        if (name === 'HEAD' || (remote.has(name) && (fromOrigin.has(name) || !isOrigin))) continue;
        remote.set(name, c.hash);
        if (isOrigin) fromOrigin.add(name);
      }
    }
  }
  const names = new Set([...local.keys(), ...remote.keys()]);
  return new Map([...names].map((n) => [n, { local: local.get(n) || null, remote: remote.get(n) || null, head: heads.has(n) }]));
}

/** `a` è raggiungibile da `b` seguendo tutti i genitori (nei commit letti). */
function isAncestor(a, b, byHash) {
  const seen = new Set();
  const stack = [b];
  while (stack.length) {
    const h = stack.pop();
    if (h === a) return true;
    if (seen.has(h) || !byHash.has(h)) continue;
    seen.add(h);
    stack.push(...byHash.get(h).parents);
  }
  return false;
}

/**
 * Il commit che rappresenta il branch, e come stanno locale e remoto:
 * 'same', 'behind' (il remoto è avanti: un pull senza conflitti), 'ahead' (da
 * pushare), 'diverged'; null se il branch è da una parte sola. Con il locale
 * indietro vale il remoto: un main locale non aggiornato nasconderebbe i merge
 * già fatti su GitHub. Negli altri casi vale il locale, quello su cui si lavora.
 */
function resolveRef(ref, byHash) {
  if (!ref.local || !ref.remote) return { ...ref, tip: ref.local || ref.remote, sync: null };
  if (ref.local === ref.remote) return { ...ref, tip: ref.local, sync: 'same' };
  if (isAncestor(ref.local, ref.remote, byHash)) return { ...ref, tip: ref.remote, sync: 'behind' };
  return { ...ref, tip: ref.local, sync: isAncestor(ref.remote, ref.local, byHash) ? 'ahead' : 'diverged' };
}

function pickTrunk(names, head) {
  return TRUNK_NAMES.find((n) => names.includes(n))
    || (head && names.includes(head) ? head : names.slice().sort()[0]);
}

/** Commit lungo il primo genitore, dal più recente; si ferma dove la storia letta finisce. */
function firstParentChain(tip, byHash) {
  const out = [];
  for (let h = tip; byHash.has(h) && !out.includes(h); h = byHash.get(h).parents[0]) out.push(h);
  return out;
}

/**
 * Tutto ciò che il tronco contiene e, per i commit arrivati con un merge, il
 * commit di merge che li ha portati. Si scorre il tronco dal più vecchio: i
 * commit già raggiunti fermano la visita, così ogni commit ha il merge più vecchio.
 */
function trunkReach(trunkOldestFirst, byHash) {
  const reached = new Set();
  const mergedAt = new Map();
  for (const hash of trunkOldestFirst) {
    reached.add(hash);
    const stack = byHash.get(hash).parents.slice(1);
    while (stack.length) {
      const h = stack.pop();
      if (reached.has(h) || !byHash.has(h)) continue;
      reached.add(h);
      mergedAt.set(h, hash);
      stack.push(...byHash.get(h).parents);
    }
  }
  return { reached, mergedAt };
}

/** Dove esiste il branch: 'local', 'remote', 'both', o null se non esiste più. */
function whereOf(ref) {
  if (!ref) return null;
  if (ref.local && ref.remote) return 'both';
  return ref.local ? 'local' : 'remote';
}

function makeLine(id, name, ref, fields) {
  return {
    id, name, head: Boolean(ref && ref.head), where: whereOf(ref),
    sync: ref ? ref.sync : null,
    pr: null, ...fields,
  };
}

/**
 * @param {Array<{hash: string, parents: string[], subject: string, refs: object[]}>} commits come parseGitLog, dal più recente
 * @param {{head?: string|null}} [o] branch corrente
 * @returns {{trunk: string|null, branches: Array<{id: string, name: string, tip: string, head: boolean,
 *   where: string|null, sync: string|null, parent: string|null, fork: string|null, commits: string[],
 *   merged: boolean, merge: string|null, pr: number|null, incomplete: boolean}>}}
 *   `branches` comincia dal tronco e ogni padre viene prima dei suoi figli; `parent` è un id;
 *   `commits` dal più vecchio.
 */
function branchTopology(commits, { head = null } = {}) {
  const list = Array.isArray(commits) ? commits : [];
  const byHash = new Map(list.map((c) => [c.hash, c]));
  const age = new Map(list.map((c, i) => [c.hash, i]));
  const refs = new Map([...branchRefs(list)].map(([n, ref]) => [n, resolveRef(ref, byHash)]));
  if (!refs.size) return { trunk: null, branches: [] };

  const trunk = pickTrunk([...refs.keys()], head);
  const trunkTip = refs.get(trunk).tip;
  const trunkChain = firstParentChain(trunkTip, byHash).reverse();
  const owner = new Map(trunkChain.map((h) => [h, trunk]));
  const { reached, mergedAt } = trunkReach(trunkChain, byHash);
  const branches = [makeLine(trunk, trunk, refs.get(trunk), {
    tip: trunkTip, parent: null, fork: null, commits: trunkChain, merged: false, merge: null, incomplete: false,
  })];

  /** Prende i commit ancora liberi dalla punta in giù: fino al punto di stacco. */
  const claim = (id, tip) => {
    const path = firstParentChain(tip, byHash);
    const at = path.findIndex((h) => owner.has(h));
    const own = at < 0 ? path : path.slice(0, at);
    for (const h of own) owner.set(h, id);
    return { tip, parent: at < 0 ? trunk : owner.get(path[at]), fork: at < 0 ? null : path[at], commits: [...own].reverse(), incomplete: at < 0 };
  };

  const used = new Set([trunk]);
  const refAt = new Map();
  for (const [name, ref] of refs) if (name !== trunk && !refAt.has(ref.tip)) refAt.set(ref.tip, name);
  for (const m of trunkChain) {
    for (const p of byHash.get(m).parents.slice(1)) {
      if (!byHash.has(p) || owner.has(p)) continue;
      const parsed = parseMergeSubject(byHash.get(m).subject);
      const name = refAt.get(p);
      if (name) used.add(name);
      const id = name || `merge:${m}:${p}`;
      const label = name || mergeLabel(parsed, m, trunk);
      branches.push(makeLine(id, label, name ? refs.get(name) : null,
        { ...claim(id, p), merged: true, merge: m, pr: parsed ? parsed.pr : null }));
    }
  }

  // La linea più lunga fuori dal tronco prende i commit in comune; a pari
  // lunghezza il branch fermo da più tempo, poi il nome (per stabilità)
  const offTrunk = (tip) => firstParentChain(tip, byHash).filter((h) => !owner.has(h)).length;
  const rest = [...refs].filter(([name]) => !used.has(name))
    .map(([name, ref]) => ({ name, ref, length: offTrunk(ref.tip) }))
    .sort((a, b) => b.length - a.length || age.get(b.ref.tip) - age.get(a.ref.tip) || a.name.localeCompare(b.name));
  for (const { name, ref } of rest) {
    const merged = ref.tip !== trunkTip && reached.has(ref.tip);
    branches.push(makeLine(name, name, ref,
      { ...claim(name, ref.tip), merged, merge: merged ? mergedAt.get(ref.tip) || null : null }));
  }
  return { trunk, branches };
}

module.exports = { branchTopology, parseMergeSubject };
