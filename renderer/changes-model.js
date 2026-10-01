/* Pannello «cosa ha cambiato» (docs/plans/32-pannello-modifiche.md): le
 * scelte che non toccano il DOM. Di quale cartella si parla, cosa dicono la
 * linguetta e l'intestazione, quando un diff aperto va riletto.
 *
 * I dati arrivano da lib/git-changes.js (canali `git-changes` e
 * `git-file-diff`). Wrapper UMD come session-groups.js: globale nella pagina
 * e module.exports sotto Node, per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessChangesModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const SINCE_COMMIT = 'rispetto all\'ultimo commit';

  /**
   * La cartella di cui mostrare le modifiche. Con un worktree che ricorda la
   * sua base il confronto è con la base, altrimenti con HEAD.
   * @param {{type: string, cwd?: string}|null} tab
   * @param {{path: string, branch: string|null, base: string|null}|null} worktree
   * `path` è la cartella del worktree (null nella cartella principale): la
   * lettura vale anche per il contatore sulla sua riga in sidebar.
   * @returns {{cwd: string, base: string|null, branch: string|null, path: string|null, key: string}|null}
   */
  function targetFor(tab, worktree) {
    if (!tab || tab.type === 'git' || typeof tab.cwd !== 'string' || !tab.cwd) return null;
    const base = (worktree && worktree.base) || null;
    const branch = (worktree && worktree.branch) || null;
    const path = (worktree && worktree.path) || null;
    return { cwd: tab.cwd, base, branch, path, key: `${tab.cwd}\0${base || ''}` };
  }

  const isRepo = (result) => Boolean(result && result.ok);

  /** Testo della linguetta: `3 · +121 −30`, `±0` se è tutto pulito. Fuori da un repository non c'è. */
  function tabLabel(result) {
    if (!isRepo(result)) return { visible: false, clean: true, text: '' };
    const { files, added, removed } = result.totals;
    if (!files) return { visible: true, clean: true, text: '±0' };
    return { visible: true, clean: false, text: `${files} · +${added} −${removed}` };
  }

  /** Di cosa parla il pannello, sotto la parola «Modifiche» */
  function headerTitle(target, result) {
    if (result && result.ok && result.against === null) return 'nessun commit ancora';
    const branch = target && target.branch;
    if (result && result.ok && result.base) return `${branch || 'branch'} da ${result.base}`;
    return branch ? `${branch} · ${SINCE_COMMIT}` : SINCE_COMMIT;
  }

  function summary(result) {
    if (!isRepo(result)) return '';
    const { files, added, removed } = result.totals;
    if (!files) return 'Nessuna modifica';
    const text = `${files} file · +${added} −${removed}`;
    return result.truncated ? `${text} · mostrati i primi ${result.files.length}` : text;
  }

  /** I contatori di una riga: solo quelli diversi da zero; binari e file troppo grandi lo dicono */
  function fileCounts(f) {
    if (f.binary) return { added: null, removed: null, note: 'binario' };
    if (f.added === null || f.added === undefined) return { added: null, removed: null, note: 'grande' };
    return {
      added: f.added > 0 ? `+${f.added}` : null,
      removed: f.removed > 0 ? `−${f.removed}` : null,
      note: null,
    };
  }

  const fileKey = (f) => [f.path, f.oldPath || '', f.status, f.added, f.removed, f.binary ? 1 : 0].join('\x1f');

  /** Uguale finché non cambia niente di visibile: si ridisegna solo allora */
  function signature(result) {
    if (!result) return 'none';
    if (!result.ok) return `ko:${result.reason || result.error || ''}`;
    return [result.against, result.base || '', result.truncated ? 1 : 0, result.totals.files, ...result.files.map(fileKey)].join('\x1e');
  }

  /**
   * Quali diff aperti rileggere (il file è cambiato) e quali chiudere (non è
   * più fra le modifiche). Se è cambiato il punto di confronto, tutti.
   */
  function diffsToReload(prevFiles, nextFiles, openPaths, { againstChanged = false } = {}) {
    const before = new Map((prevFiles || []).map((f) => [f.path, fileKey(f)]));
    const after = new Map((nextFiles || []).map((f) => [f.path, fileKey(f)]));
    const drop = openPaths.filter((p) => !after.has(p));
    const reload = openPaths.filter((p) => after.has(p) && (againstChanged || before.get(p) !== after.get(p)));
    return { reload, drop };
  }

  /** `lib/sub/x.js` → cartella e nome: il nome si evidenzia, la cartella no */
  function splitPath(p) {
    const s = String(p || '');
    const i = s.lastIndexOf('/');
    return { dir: i >= 0 ? s.slice(0, i + 1) : '', name: i >= 0 ? s.slice(i + 1) : s };
  }

  function displayPath(f) {
    return f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
  }

  return { targetFor, tabLabel, headerTitle, summary, fileCounts, signature, diffsToReload, splitPath, displayPath };
});
