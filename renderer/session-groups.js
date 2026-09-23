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
  const TYPE_ORDER = ['shell', 'opencode', 'claude', 'codex', 'antigravity'];
  const TYPE_LABELS = {
    shell: 'Terminale', opencode: 'OpenCode', claude: 'Claude',
    codex: 'Codex', antigravity: 'Antigravity',
  };
  const NO_PROJECT_KEY = '';
  const NO_PROJECT_LABEL = 'Senza directory';

  /**
   * @param {Array<{id: string, type: string, projectRoot?: string|null}>} sessions
   * @param {{mode?: 'type'|'project', typeOrder?: string[], typeLabels?: Record<string,string>}} [options]
   * @returns {Array<{key: string, kind: 'type'|'project', label: string, title: string, items: object[]}>}
   */
  function groupSessions(sessions, options = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    return options.mode === 'project' ? groupByProject(list, options.projectOrder) : groupByType(list, options);
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
  function groupByProject(sessions, projectOrder) {
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
      .map((key) => ({ key, kind: 'project', label: labels.get(key), title: key, items: byKey.get(key) }))
      .sort((a, b) => byRank(a, b) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    if (byKey.has(NO_PROJECT_KEY)) {
      out.push({ key: NO_PROJECT_KEY, kind: 'project', label: NO_PROJECT_LABEL, title: NO_PROJECT_LABEL, items: byKey.get(NO_PROJECT_KEY) });
    }
    return out;
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

  return { groupSessions, relativeSubpath, shortPath, TYPE_ORDER, TYPE_LABELS, NO_PROJECT_LABEL };
});
