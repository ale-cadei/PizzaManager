/* Organizza le conversazioni del Resume usando la stessa radice di progetto
 * della sidebar. La risoluzione della directory arriva dal renderer: questo
 * modulo resta puro rispetto a Electron e importabile nei test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessResumeProjects = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const pathOf = (source, item) => source === 'opencode' ? item.directory : item.cwd;
  const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  function pathKey(value) {
    const raw = String(value || '').replace(/\\/g, '/');
    const path = /^[A-Za-z]:\/+$/i.test(raw) ? raw.slice(0, 2) + '/'
      : raw.replace(/\/+$/, '') || (raw.startsWith('/') ? '/' : '');
    return /^[A-Za-z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
  }

  /** `cwd` è `dir` o sta sotto: la cartella di un worktree e le sue sottocartelle. */
  function isInside(dir, cwd) {
    if (!cwd) return false;
    const base = pathKey(dir);
    const key = pathKey(cwd);
    return key === base || key.startsWith(base.endsWith('/') ? base : base + '/');
  }

  /** Il tipo della sessione più recente nata dentro `dir`, fra quelli che hanno
   *  una linguetta. `history` è la cronologia dell'app, dalla voce più nuova. */
  function recentTypeIn(history, dir, types) {
    const hit = (Array.isArray(history) ? history : [])
      .find((entry) => entry && types.includes(entry.type) && isInside(dir, entry.cwd));
    return hit ? hit.type : null;
  }

  /**
   * `filterRoot` tiene le conversazioni di un progetto (radice risolta),
   * `filterDir` quelle nate dentro una cartella (il ⟲ di un worktree).
   * @returns {Promise<Array<{key: string, label: string, title: string, items: object[]}>>}
   */
  async function arrange(items, { source, resolve, filterRoot = null, filterDir = null, grouped = false, query = '', Groups } = {}) {
    const all = Array.isArray(items) ? items : [];
    const sessions = filterDir ? all.filter((item) => isInside(filterDir, pathOf(item.source || source, item))) : all;
    const searched = fold(query).trim();
    if (!grouped && !filterRoot && !searched) return [{ key: '', label: '', title: '', items: sessions }];
    const directories = new Map();
    for (const item of sessions) {
      const cwd = pathOf(item.source || source, item);
      if (cwd && !directories.has(cwd)) directories.set(cwd, Promise.resolve().then(() => resolve(cwd)));
    }
    const entries = await Promise.all(sessions.map(async (item) => {
      const cwd = pathOf(item.source || source, item);
      return { item, projectRoot: cwd ? await directories.get(cwd) : null };
    }));
    const matching = filterRoot ? entries.filter((entry) => pathKey(entry.projectRoot) === pathKey(filterRoot)) : entries;
    const labels = searched ? new Map(Groups.groupSessions(matching, { mode: 'project' }).map((group) => [group.key, group.label])) : null;
    const visible = searched ? matching.filter((entry) =>
      fold(JSON.stringify(entry.item)).includes(searched) || fold(labels.get(entry.projectRoot)).includes(searched)) : matching;
    if (!grouped) return [{ key: '', label: '', title: '', items: visible.map((entry) => entry.item) }];
    return Groups.groupSessions(visible, { mode: 'project' })
      .map((group) => ({ ...group, items: group.items.map((entry) => entry.item) }));
  }

  return { arrange, pathOf, pathKey, isInside, recentTypeIn };
});
