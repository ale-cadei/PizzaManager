/* Schermo diviso: due sessioni affiancate o impilate
 * (docs/plans/75-schermo-diviso.md).
 *
 * Qui solo le regole: lo stato è `null` (una sessione sola) oppure
 * `{ orientation, first, second, ratio }`, dove `row` affianca (first a
 * sinistra) e `column` impila (first sopra), e `ratio` è la parte di first.
 * Il DOM lo tocca renderer/split-view.js.
 *
 * Wrapper UMD come session-order.js: globale nella pagina e module.exports
 * sotto Node, per i test. Funzioni pure: nessuna mutazione degli argomenti. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessSplit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const MIN_RATIO = 0.2;
  const MAX_RATIO = 0.8;
  const DEFAULT_RATIO = 0.5;
  const ORIENTATIONS = ['row', 'column'];
  const ZONE_ORIENTATION = { left: 'row', right: 'row', top: 'column', bottom: 'column' };
  // La sessione trascinata va in first se rilasciata a sinistra o in alto
  const FIRST_ZONES = ['left', 'top'];

  function clampRatio(r) {
    if (typeof r !== 'number' || !Number.isFinite(r)) return DEFAULT_RATIO;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
  }

  /**
   * Bordo più vicino al cursore, in proporzione all'area: decide dove va la
   * sessione trascinata.
   * @param {{width: number, height: number}} size area dei terminali
   * @param {number} x @param {number} y cursore relativo all'area
   * @returns {'left'|'right'|'top'|'bottom'}
   */
  function dropZone(size, x, y) {
    const fx = size.width > 0 ? x / size.width : 0.5;
    const fy = size.height > 0 ? y / size.height : 0.5;
    const dist = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
    return Object.keys(dist).reduce((best, z) => (dist[z] < dist[best] ? z : best), 'left');
  }

  const has = (state, id) => Boolean(state) && (state.first === id || state.second === id);

  function partnerOf(state, id) {
    if (!has(state, id)) return null;
    return state.first === id ? state.second : state.first;
  }

  /** La sessione che resta accanto a quella trascinata. */
  function partnerForDrop(state, { focusedId, droppedId }) {
    if (has(state, droppedId)) return partnerOf(state, droppedId);
    return focusedId || null;
  }

  function canPlace(state, opts) {
    const partner = partnerForDrop(state, opts);
    return Boolean(opts.droppedId && partner && partner !== opts.droppedId);
  }

  /**
   * Rilascio di una card sull'area dei terminali.
   * @param {object|null} state
   * @param {{focusedId: string|null, droppedId: string, zone: string}} opts
   * @returns {object|null} nuovo stato; quello di prima se il rilascio non divide
   */
  function place(state, { focusedId, droppedId, zone }) {
    const orientation = ZONE_ORIENTATION[zone];
    if (!orientation || !canPlace(state, { focusedId, droppedId })) return state;
    const partner = partnerForDrop(state, { focusedId, droppedId });
    const droppedFirst = FIRST_ZONES.includes(zone);
    return {
      orientation,
      first: droppedFirst ? droppedId : partner,
      second: droppedFirst ? partner : droppedId,
      ratio: state && state.orientation === orientation ? state.ratio : DEFAULT_RATIO,
    };
  }

  /**
   * Click su una card: dentro la divisione la porta in primo piano, fuori
   * prende il posto della metà in primo piano.
   * @returns {{state: object|null, focus: string}}
   */
  function select(state, focusedId, id) {
    if (!state || has(state, id)) return { state, focus: id };
    if (state.first === focusedId) return { state: { ...state, first: id }, focus: id };
    if (state.second === focusedId) return { state: { ...state, second: id }, focus: id };
    return { state: null, focus: id };
  }

  function swap(state) {
    return state ? { ...state, first: state.second, second: state.first } : null;
  }

  /** Stato dopo la chiusura di una sessione: se era una delle due, niente più divisione. */
  function without(state, id) {
    return has(state, id) ? null : state;
  }

  function visibleIds(state, activeId) {
    if (state) return [state.first, state.second];
    return activeId ? [activeId] : [];
  }

  /** Proporzione dal punto del puntatore mentre si trascina la linea. */
  function ratioAt(rect, orientation, x, y) {
    const r = orientation === 'column' ? (y - rect.top) / rect.height : (x - rect.left) / rect.width;
    return clampRatio(r);
  }

  /**
   * Cosa salvare: le chiavi stabili delle due sessioni, perché gli id delle
   * schede cambiano a ogni avvio. Senza chiavi per una metà non si salva.
   * @param {(id: string) => string[]} keysOf
   */
  function toSaved(state, keysOf) {
    if (!state) return null;
    const first = keysOf(state.first) || [];
    const second = keysOf(state.second) || [];
    if (!first.length || !second.length) return null;
    return { orientation: state.orientation, ratio: state.ratio, first: [...first], second: [...second] };
  }

  const isKeyList = (v) => Array.isArray(v) && v.length > 0 && v.every((k) => typeof k === 'string');

  /** Dati letti dallo storage: oggetto valido o null. */
  function parseSaved(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    let v;
    try { v = JSON.parse(raw); } catch { return null; }
    if (!v || typeof v !== 'object') return null;
    if (!ORIENTATIONS.includes(v.orientation) || typeof v.ratio !== 'number') return null;
    if (!isKeyList(v.first) || !isKeyList(v.second)) return null;
    return { orientation: v.orientation, ratio: clampRatio(v.ratio), first: v.first, second: v.second };
  }

  /**
   * Ricompone la divisione salvata sulle schede aperte.
   * @param {object|null} saved da parseSaved
   * @param {Array<{id: string, keys: string[]}>} open
   * @returns {object|null}
   */
  function fromSaved(saved, open) {
    if (!saved) return null;
    const find = (keys) => (open.find((t) => t.keys.some((k) => keys.includes(k))) || {}).id;
    const first = find(saved.first);
    const second = find(saved.second);
    if (!first || !second || first === second) return null;
    return { orientation: saved.orientation, first, second, ratio: saved.ratio };
  }

  return {
    MIN_RATIO, MAX_RATIO, clampRatio, dropZone, canPlace, place, select, swap,
    without, partnerOf, visibleIds, ratioAt, toSaved, parseSaved, fromSaved,
  };
});
