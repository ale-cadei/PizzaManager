/* Il modale «Nuovo worktree» (docs/plans/36-sessione-worktree.md), la parte
 * senza DOM: dalla risposta di `worktree-start` (lib/worktree.js) le voci del
 * menu «Parte da», l'avviso sui file modificati, cosa impedisce di creare, e
 * l'anteprima della cartella.
 *
 * Wrapper UMD come session-groups.js: globale nella pagina e module.exports
 * sotto Node, per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessWorktreeForm = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const BUSY = {
    merge: 'C\'è un merge in corso nella cartella principale: finiscilo o annullalo (git merge --abort) prima di creare un worktree.',
    rebase: 'C\'è un rebase in corso nella cartella principale: finiscilo o annullalo (git rebase --abort) prima di creare un worktree.',
  };

  function dirtyWarning(n) {
    if (!n) return null;
    const what = n === 1 ? '1 file modificato o nuovo' : `${n} file modificati o nuovi`;
    return `${what} nella cartella principale non saranno nel worktree: parte dall'ultimo commit.`;
  }

  /**
   * @param {{ok: boolean, error?: string, current?: {branch: string|null, commit: string},
   *   dirty?: number, busy?: 'merge'|'rebase'|null, bases?: string[]}} start
   * @returns {{bases: Array<{value: string, label: string, hint: string}>, selected: string|null,
   *   warning: string|null, note: string|null, blocked: string|null}}
   */
  function startModel(start) {
    const empty = { bases: [], selected: null, warning: null, note: null };
    if (!start || !start.ok) return { ...empty, blocked: (start && start.error) || 'Non riesco a leggere il repository.' };
    const current = start.current || { branch: null, commit: '' };
    const list = Array.isArray(start.bases) ? start.bases : [];
    // Come le voci dell'albero git (git-branch-picker.js): nome, e a destra un
    // suggerimento grigio
    const bases = list.map((value, i) => {
      if (i > 0) return { value, label: value, hint: '' };
      return { value, label: value, hint: current.branch ? 'corrente' : 'commit corrente, HEAD staccato' };
    });
    return {
      bases,
      selected: bases.length ? bases[0].value : null,
      warning: dirtyWarning(start.dirty),
      note: current.branch ? null : 'Da un commit staccato il worktree non ha una base: «Unisci» non sarà disponibile, solo «Tieni il branch» o «Butta».',
      blocked: BUSY[start.busy] || (bases.length ? null : 'Nessun punto da cui partire.'),
    };
  }

  /** Le basi che contengono il testo, senza badare alle maiuscole: come il filtro dell'albero git */
  function filterBases(bases, query) {
    const needle = String(query || '').trim().toLowerCase();
    return (Array.isArray(bases) ? bases : []).filter((b) => !needle || b.value.toLowerCase().includes(needle));
  }

  /** `<progetto>.worktrees/<branch con / → ->`, come lib/worktree.js worktreeDirFor */
  function folderPreview(root, branch) {
    const name = String(branch || '').trim();
    if (!name) return '';
    const project = String(root || '').split(/[\\/]+/).filter(Boolean).pop() || '';
    return `${project}.worktrees/${name.replace(/\//g, '-')}`;
  }

  return { startModel, folderPreview, filterBases };
});
