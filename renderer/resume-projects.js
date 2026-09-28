/* Organizza le conversazioni del Resume usando la stessa radice di progetto
 * della sidebar. La risoluzione della directory arriva dal renderer: questo
 * modulo resta puro rispetto a Electron e importabile nei test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessResumeProjects = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const pathOf = (source, item) => source === 'opencode' ? item.directory : item.cwd;

  function pathKey(value) {
    const raw = String(value || '').replace(/\\/g, '/');
    const path = /^[A-Za-z]:\/+$/i.test(raw) ? raw.slice(0, 2) + '/'
      : raw.replace(/\/+$/, '') || (raw.startsWith('/') ? '/' : '');
    return /^[A-Za-z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
  }

  /** @returns {Promise<Array<{key: string, label: string, title: string, items: object[]}>>} */
  async function arrange(items, { source, resolve, filterRoot = null, grouped = false, Groups } = {}) {
    const sessions = Array.isArray(items) ? items : [];
    if (!grouped && !filterRoot) return [{ key: '', label: '', title: '', items: sessions }];
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
    if (!grouped) return [{ key: '', label: '', title: '', items: matching.map((entry) => entry.item) }];
    return Groups.groupSessions(matching, { mode: 'project' })
      .map((group) => ({ ...group, items: group.items.map((entry) => entry.item) }));
  }

  return { arrange, pathOf, pathKey };
});
