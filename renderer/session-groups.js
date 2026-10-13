/* Gruppi della sidebar: per tipo di sessione (com'è sempre stato) o per
 * progetto, cioè per radice del repository.
 *
 * Sta in renderer/ e non in lib/ per un vincolo: il renderer gira sandboxed,
 * non ha require e non potrebbe importare un modulo di lib/. Il wrapper UMD
 * espone il globale `AisessGroups` nella pagina e lo stesso oggetto sotto Node,
 * per poterlo testare senza browser — come session-titles.js.
 *
 * Funzioni pure: nessun I/O, nessuna mutazione degli argomenti. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessGroups = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const TYPE_ORDER = ['shell', 'git', 'editor', 'opencode', 'claude', 'codex', 'antigravity'];
  const TYPE_LABELS = {
    shell: 'Terminale', git: 'Git', editor: 'Editor', opencode: 'OpenCode', claude: 'Claude',
    codex: 'Codex', antigravity: 'Antigravity',
  };
  const NO_PROJECT_KEY = '';
  const NO_PROJECT_LABEL = 'Senza directory';

  /**
   * @param {Array<{id: string, type: string, cwd?: string, projectRoot?: string|null}>} sessions
   * @param {{mode?: 'type'|'project', typeOrder?: string[], typeLabels?: Record<string,string>,
   *   projectOrder?: string[], worktrees?: Record<string, Array<{path: string, branch?: string|null, base?: string|null}>>}} [options]
   *   `worktrees`: per radice di progetto, i suoi worktree (docs/plans/36)
   * @returns {Array<{key: string, kind: 'type'|'project', label: string, title: string, items: object[],
   *   worktrees?: Array<{path: string, branch: string|null, base: string|null, items: object[]}>}>}
   *   in modalità progetto le sessioni di un worktree stanno nella sua
   *   sotto-sezione e non in `items`
   */
  function groupSessions(sessions, options = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    return options.mode === 'project' ? groupByProject(list, options.projectOrder, options.worktrees) : groupByType(list, options);
  }

  function groupByType(sessions, { typeOrder = TYPE_ORDER, typeLabels = TYPE_LABELS } = {}) {
    // I tipi noti entrano per primi nella Map, che conserva l'ordine di
    // inserimento: i tipi sconosciuti finiscono in coda, come oggi.
    const byKey = new Map(typeOrder.map((t) => [t, []]));
    for (const s of sessions) {
      const key = s && s.type ? s.type : 'shell';
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(s);
    }
    const out = [];
    for (const [key, items] of byKey) {
      if (!items.length) continue;
      const label = typeLabels[key] || key;
      out.push({ key, kind: 'type', label, title: label, items });
    }
    return out;
  }

  /**
   * @param {object[]} sessions
   * @param {string[]} [projectOrder] radici nell'ordine scelto dall'utente
   *   (trascinando le linguette). Chi non c'è va in coda, in ordine alfabetico.
   */
  function groupByProject(sessions, projectOrder, worktrees) {
    const byKey = new Map();
    for (const s of sessions) {
      const key = s && typeof s.projectRoot === 'string' && s.projectRoot ? s.projectRoot : NO_PROJECT_KEY;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(s);
    }
    const roots = [...byKey.keys()].filter((k) => k !== NO_PROJECT_KEY);
    const labels = projectLabels(roots);
    const rank = new Map((Array.isArray(projectOrder) ? projectOrder : []).map((k, i) => [k, i]));
    const byRank = (a, b) => (rank.has(a.key) ? rank.get(a.key) : Infinity) - (rank.has(b.key) ? rank.get(b.key) : Infinity);
    // A parità di etichetta si ordina sulla chiave: così l'ordine è totale e
    // due render successivi non invertono mai due gruppi.
    const out = roots
      .map((key) => ({ key, kind: 'project', label: labels.get(key), title: key, ...splitByWorktree(byKey.get(key), worktreesOf(worktrees, key)) }))
      .sort((a, b) => byRank(a, b) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    if (byKey.has(NO_PROJECT_KEY)) {
      out.push({ key: NO_PROJECT_KEY, kind: 'project', label: NO_PROJECT_LABEL, title: NO_PROJECT_LABEL, items: byKey.get(NO_PROJECT_KEY), worktrees: [] });
    }
    return out;
  }

  /* L'elenco dei worktree di una radice; quello che non ha un percorso si scarta */
  function worktreesOf(worktrees, root) {
    if (!worktrees || typeof worktrees !== 'object' || !Object.prototype.hasOwnProperty.call(worktrees, root)) return [];
    const list = worktrees[root];
    return Array.isArray(list) ? list.filter((w) => w && typeof w.path === 'string' && w.path) : [];
  }

  /* Una sessione sta in un worktree se la sua cwd è il worktree o ci sta
     dentro; tutte le altre restano fra quelle della cartella principale.
     Un worktree senza sessioni c'è lo stesso: è il posto da cui si butta. */
  function splitByWorktree(items, list) {
    const sections = list.map((w) => ({
      path: w.path, branch: w.branch || null, base: w.base || null,
      items: items.filter((s) => isInside(s && s.cwd, w.path)),
    }));
    const placed = new Set(sections.flatMap((w) => w.items));
    return { items: items.filter((s) => !placed.has(s)), worktrees: sections };
  }

  /**
   * Il worktree in cui sta una sessione, fra quelli del suo progetto; null se
   * sta nella cartella principale o fuori da tutto.
   * @param {{cwd?: string, projectRoot?: string|null}} session
   * @param {Record<string, Array<{path: string, branch?: string|null, base?: string|null}>>} worktrees
   */
  function worktreeOf(session, worktrees) {
    if (!session || typeof session.projectRoot !== 'string') return null;
    return worktreesOf(worktrees, session.projectRoot).find((w) => isInside(session.cwd, w.path)) || null;
  }

  function isInside(cwd, dir) {
    const c = String(cwd || '').replace(TRAILING_SEP_RE, '');
    const d = String(dir || '').replace(TRAILING_SEP_RE, '');
    if (!c || !d) return false;
    // Il separatore dopo la base evita che feat-x2 passi per una sottocartella di feat-x
    return c === d || (c.startsWith(d) && /[\\/]/.test(c[d.length]));
  }

  /* Etichette dei progetti: il nome della cartella, che è quello che l'utente
     riconosce. Se due radici diverse hanno lo stesso nome, ENTRAMBE passano a
     "genitore/nome": disambiguarne una sola renderebbe il confronto illeggibile. */
  function projectLabels(roots) {
    const base = new Map(roots.map((r) => [r, lastSegments(r, 1)]));
    const count = new Map();
    for (const name of base.values()) count.set(name, (count.get(name) || 0) + 1);
    const out = new Map();
    for (const [rootPath, name] of base) out.set(rootPath, count.get(name) > 1 ? lastSegments(rootPath, 2) : name);
    return out;
  }

  /* I percorsi arrivano dal main con il separatore della macchina: `/` su
     Unix, `\` su Windows. Qui si spezza su entrambi e si mostra sempre `/`,
     che nelle etichette è più leggibile e non cambia significato. */
  const SEP_RE = /[\\/]+/;
  const TRAILING_SEP_RE = /[\\/]+$/;

  function lastSegments(p, n) {
    const parts = String(p || '').split(SEP_RE).filter(Boolean);
    if (!parts.length) return '/';
    return parts.slice(-n).join('/');
  }

  /** Path della sessione relativo alla radice del progetto; vuoto se coincidono. */
  function relativeSubpath(cwd, projectRoot) {
    const dir = String(cwd || '').replace(TRAILING_SEP_RE, '');
    const base = String(projectRoot || '').replace(TRAILING_SEP_RE, '');
    if (!dir || !base || dir === base) return '';
    // Il separatore dopo la base evita che /repo-bis passi per una sottocartella di /repo
    if (!dir.startsWith(base) || !/[\\/]/.test(dir[base.length])) return '';
    return dir.slice(base.length + 1).split(SEP_RE).join('/');
  }

  /* Mostra solo parent + current (es. "progetto/backend" invece del full path) */
  function shortPath(cwd) {
    if (!cwd) return '';
    return lastSegments(cwd, 2);
  }

  return { groupSessions, worktreeOf, relativeSubpath, shortPath, TYPE_ORDER, TYPE_LABELS, NO_PROJECT_LABEL };
});
