/* L'elenco dei worktree dei progetti mostrati in sidebar
 * (docs/plans/36-sessione-worktree.md).
 *
 * L'elenco lo dà git (lib/worktree.js, canale `worktree-list`): qui si tiene
 * l'ultima risposta per radice, così la sidebar non chiede al main a ogni
 * render. Si chiede una radice la prima volta che compare, e di nuovo dopo
 * un'azione su un suo worktree o quando la finestra torna in primo piano (un
 * worktree creato o tolto fuori dall'app si vede al rientro). `onChange`
 * scatta solo se l'elenco è davvero cambiato: è un ridisegno della sidebar.
 *
 * Wrapper UMD come session-groups.js: globale nella pagina e module.exports
 * sotto Node, per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessWorktreeCache = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Solo quello che serve alla sidebar: il resto cambierebbe a ogni commit (head) */
  const slim = (w) => ({ path: w.path, branch: w.branch || null, base: w.base || null });

  /**
   * @param {{list: (root: string) => Promise<{ok: boolean, worktrees?: object[], error?: string}>,
   *   onChange: () => void, warn?: (...args: any[]) => void}} deps
   */
  function createWorktreeCache({ list, onChange, warn = (...args) => console.warn(...args) }) {
    /** radice → worktree; un oggetto nuovo a ogni cambio, mai mutato */
    let byRoot = {};
    /* L'ultima richiesta per radice: una risposta più vecchia che arriva dopo
       non deve sovrascrivere quella nuova */
    const latest = new Map();

    async function fetchRoot(root) {
      const token = (latest.get(root) || 0) + 1;
      latest.set(root, token);
      let next = [];
      try {
        const r = await list(root);
        if (r && r.ok && Array.isArray(r.worktrees)) next = r.worktrees.filter((w) => w && w.path).map(slim);
        else warn('[worktree] elenco non letto per', root, (r && r.error) || 'risposta vuota');
      } catch (e) {
        warn('[worktree] elenco non letto per', root, String((e && e.message) || e));
      }
      if (latest.get(root) !== token) return;
      const known = Object.prototype.hasOwnProperty.call(byRoot, root);
      if (known && JSON.stringify(byRoot[root]) === JSON.stringify(next)) return;
      byRoot = { ...byRoot, [root]: next };
      // La prima risposta senza worktree non cambia niente di visibile
      if (known || next.length) onChange();
    }

    /** Chiede le radici mai chieste (non quelle già note o in corso). */
    function sync(roots) {
      const fresh = [...new Set((Array.isArray(roots) ? roots : []).filter((r) => typeof r === 'string' && r))]
        .filter((r) => !latest.has(r));
      return Promise.all(fresh.map(fetchRoot));
    }

    return {
      snapshot: () => byRoot,
      sync,
      refresh: (root) => fetchRoot(root),
      refreshAll: () => Promise.all([...latest.keys()].map(fetchRoot)),
    };
  }

  return { createWorktreeCache };
});
