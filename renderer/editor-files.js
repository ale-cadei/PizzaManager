/* Stato dei file aperti in una scheda editor (docs/plans/60): ordine delle
 * sotto-schede, quella attiva e, per ogni file, quello che serve a salvarlo
 * (mtime e BOM letti all'apertura) e a dire com'è messo (sporco, eliminato,
 * in conflitto col disco, errore). Il testo sta in Monaco (editor-monaco.js).
 * Funzioni pure: ogni passo restituisce uno stato nuovo.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorFiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const BLANK = { path: null, mtime: null, bom: false, dirty: false, deleted: false, conflict: null, diskMtime: null, error: null };

  const empty = () => ({ order: [], active: null, files: {} });

  function open(state, rel, info = {}) {
    const file = { ...BLANK, ...(state.files[rel] || {}), ...info, rel };
    const order = state.order.includes(rel) ? state.order : [...state.order, rel];
    return { order, active: rel, files: { ...state.files, [rel]: file } };
  }

  const activate = (state, rel) => (state.files[rel] ? { ...state, active: rel } : state);

  function close(state, rel) {
    const i = state.order.indexOf(rel);
    if (i < 0) return state;
    const order = state.order.filter((r) => r !== rel);
    const files = { ...state.files };
    delete files[rel];
    const active = state.active !== rel ? state.active : (order[i] || order[i - 1] || null);
    return { order, active, files };
  }

  function update(state, rel, patch) {
    if (!state.files[rel]) return state;
    return { ...state, files: { ...state.files, [rel]: { ...state.files[rel], ...patch } } };
  }

  /** Dove finisce `rel` se `from` (file o cartella) diventa `to`; null se non c'entra. */
  function movedPath(rel, from, to) {
    if (rel === from) return to;
    if (rel.startsWith(from + '/')) return to + rel.slice(from.length);
    return null;
  }

  const affectedBy = (state, from) => state.order.filter((r) => movedPath(r, from, from) !== null);

  function renamePath(state, from, to) {
    const map = (r) => movedPath(r, from, to) || r;
    const files = {};
    for (const r of state.order) files[map(r)] = { ...state.files[r], rel: map(r) };
    return { order: state.order.map(map), active: state.active && map(state.active), files };
  }

  /* Eliminato dal disco: il contenuto resta in Monaco, salvare lo ricrea
     (mtime null = «il file non deve esistere» per lib/editor-fs.js) */
  const markDeleted = (state, rel) => update(state, rel, { deleted: true, mtime: null, conflict: null, diskMtime: null });

  const dirtyFiles = (state) => state.order.filter((r) => state.files[r].dirty);
  const toSaved = (state) => ({ files: [...state.order], active: state.active });
  const findByPath = (state, abs) => state.order.find((r) => state.files[r].path === abs) || null;
  const joinRel = (dir, name) => (dir ? `${dir}/${name}` : name);
  const parentRel = (rel) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };
  const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

  return { empty, open, activate, close, update, movedPath, affectedBy, renamePath, markDeleted, dirtyFiles, toSaved, findByPath, joinRel, parentRel, baseName };
});
