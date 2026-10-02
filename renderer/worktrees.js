/* Worktree nella sidebar (docs/plans/36-sessione-worktree.md): l'elenco per
   progetto e il menu ⋯. La logica sta in worktree-cache.js e
   worktree-actions.js; qui il collegamento con le schede (`tabs`), il main
   (`window.aisess`) e il fumetto della sidebar (`closeConfirm`). */

const worktreeCache = window.AisessWorktreeCache.createWorktreeCache({
  list: (root) => window.aisess.worktreeList(root),
  onChange: () => renderSidebar(),
});

/** Le schede aperte dentro il worktree `path` */
function sessionsInWorktree(path) {
  const snapshot = worktreeCache.snapshot();
  return [...tabs.values()].filter((t) => {
    const w = Groups.worktreeOf(t, snapshot);
    return Boolean(w) && w.path === path;
  });
}

const worktreeActions = window.AisessWorktreeActions.createWorktreeActions({
  api: {
    merge: (root, path) => window.aisess.worktreeMerge(root, path),
    remove: (root, path, branch, force) => window.aisess.worktreeRemove(root, path, branch, force),
  },
  bubble: closeConfirm,
  sessionsIn: sessionsInWorktree,
  // Una alla volta: terminateTab ridisegna la sidebar a ogni chiusura
  closeSessions: async (list) => { for (const t of list) await terminateTab(t.id); },
  refresh: (root) => worktreeCache.refresh(root),
  // Unisci si conferma guardando il diff nel pannello delle modifiche (changes-panel.js)
  review: (w, conf) => reviewMerge(w, conf),
});

/** Un worktree creato o tolto fuori dall'app (un terminale, un agente) si vede al rientro. */
function watchWorktrees() {
  window.addEventListener('focus', () => { worktreeCache.refreshAll().catch(() => {}); });
}
