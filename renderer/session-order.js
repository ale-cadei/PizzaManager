/* Ordine manuale delle sessioni nella sidebar.
 *
 * Una sola lista di id per tutta la sidebar, non una per gruppo: i gruppi sono
 * una vista (per tipo o per progetto) sulla stessa lista, e cambiare modalità
 * non deve buttare via l'ordine scelto. Spostare una card accanto a un'altra
 * dentro il suo gruppo equivale a spostarne l'id accanto all'altro nella lista
 * globale, perché ogni gruppo conserva l'ordine relativo che ha qui.
 *
 * Gli id delle schede sono generati a runtime: l'ordine vive in memoria e non
 * si persiste: dopo un riavvio non ci sarebbe niente a cui riagganciarlo.
 *
 * Wrapper UMD come session-groups.js: globale nella pagina (il renderer non ha
 * require) e module.exports sotto Node, per poterlo leggere dai test.
 * Funzioni pure: nessuna mutazione degli argomenti. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessOrder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /**
   * Sposta `movedId` immediatamente prima o dopo `targetId`.
   * @param {string[]} order lista di id, dal primo all'ultimo
   * @param {string} movedId id trascinato
   * @param {string} targetId id su cui è stato rilasciato
   * @param {{before?: boolean}} [options] rilascio sopra (true) o sotto la card
   * @returns {string[]} nuova lista; la stessa (non mutata) se la mossa è nulla
   */
  function moveAdjacent(order, movedId, targetId, options = {}) {
    const list = Array.isArray(order) ? order : [];
    if (!movedId || !targetId || movedId === targetId) return list;
    if (!list.includes(movedId) || !list.includes(targetId)) return list;
    const before = options.before !== false;
    // Si toglie prima e si cerca il bersaglio dopo: così l'indice non va
    // corretto a seconda che la card venisse da sopra o da sotto.
    const without = list.filter((id) => id !== movedId);
    const at = without.indexOf(targetId);
    const insertAt = before ? at : at + 1;
    return [...without.slice(0, insertAt), movedId, ...without.slice(insertAt)];
  }

  /**
   * Ordina le sessioni secondo la lista di id. Le sessioni che non compaiono
   * nella lista (appena aperte, o mai ordinate) restano in coda nell'ordine in
   * cui arrivano: nessuna sparisce mai dalla sidebar per colpa dell'ordine.
   * @param {Array<{id: string}>} sessions
   * @param {string[]} order
   * @returns {Array<{id: string}>} nuovo array
   */
  function applyOrder(sessions, order) {
    const list = Array.isArray(sessions) ? sessions : [];
    const rank = new Map((Array.isArray(order) ? order : []).map((id, i) => [id, i]));
    const known = list.filter((s) => s && rank.has(s.id));
    const unknown = list.filter((s) => !s || !rank.has(s.id));
    return [...known.sort((a, b) => rank.get(a.id) - rank.get(b.id)), ...unknown];
  }

  /** Aggiunge in coda gli id nuovi e toglie quelli spariti. */
  function syncOrder(order, ids) {
    const present = new Set(Array.isArray(ids) ? ids : []);
    const kept = (Array.isArray(order) ? order : []).filter((id) => present.has(id));
    const seen = new Set(kept);
    return [...kept, ...[...present].filter((id) => !seen.has(id))];
  }

  return { moveAdjacent, applyOrder, syncOrder };
});
