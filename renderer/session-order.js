/* Ordine manuale delle sessioni nella sidebar.
 *
 * Una sola lista di id per tutta la sidebar, non una per gruppo: i gruppi sono
 * una vista (per tipo o per progetto) sulla stessa lista, e cambiare modalità
 * non deve buttare via l'ordine scelto. Spostare una card accanto a un'altra
 * dentro il suo gruppo equivale a spostarne l'id accanto all'altro nella lista
 * globale, perché ogni gruppo conserva l'ordine relativo che ha qui.
 *
 * Gli id delle schede sono generati a runtime, quindi l'ordine in memoria
 * vive solo finché l'app è aperta. Per ritrovarlo al prossimo avvio si salva a
 * parte una lista di chiavi STABILI (`tabKeys`): l'id della conversazione, che
 * regge anche il riavvio della macchina, e il nome della sessione tmux, che
 * regge la chiusura dell'app. Una scheda che riappare con una di quelle chiavi
 * torna al suo posto (`syncOrder` con `rankOf`); una senza (shell senza tmux)
 * entra in coda come sempre.
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

  /**
   * Toglie gli id spariti e aggiunge quelli nuovi. Un id nuovo con un posto
   * salvato (`rankOf`) entra prima della prima scheda che nell'ordine salvato
   * gli sta dopo; senza posto salvato va in coda.
   * @param {string[]} order
   * @param {string[]} ids schede aperte adesso
   * @param {{rankOf?: (id: string) => number|undefined}} [options]
   * @returns {string[]}
   */
  function syncOrder(order, ids, options = {}) {
    const rankOf = typeof options.rankOf === 'function' ? options.rankOf : () => undefined;
    const present = new Set(Array.isArray(ids) ? ids : []);
    const kept = (Array.isArray(order) ? order : []).filter((id) => present.has(id));
    const seen = new Set(kept);
    return [...present].filter((id) => !seen.has(id)).reduce((acc, id) => {
      const r = rankOf(id);
      if (r === undefined) return [...acc, id];
      const at = acc.findIndex((other) => {
        const o = rankOf(other);
        return o !== undefined && o > r;
      });
      return at < 0 ? [...acc, id] : [...acc.slice(0, at), id, ...acc.slice(at)];
    }, kept);
  }

  /** Chiavi salvate al massimo: quelle delle schede chiuse da tempo si perdono. */
  const MAX_SAVED_KEYS = 200;

  /**
   * Chiavi stabili di una scheda, dalla più duratura: l'id della conversazione
   * (sopravvive al riavvio della macchina) e la sessione tmux (sopravvive alla
   * chiusura dell'app). In coda il nome tmux che la sessione aveva prima di un
   * riavvio, se è stata ricreata dal ripristino: per una shell è l'unico
   * aggancio al posto di prima. Vuoto se non ne ha nessuna.
   * @param {{type?: string, resumeId?: string|null, session?: string|null, previousSession?: string|null}|null} tab
   * @returns {string[]}
   */
  function tabKeys(tab) {
    if (!tab) return [];
    return [
      tab.resumeId ? `${tab.type || 'shell'}:${tab.resumeId}` : null,
      tab.session ? `tmux:${tab.session}` : null,
      tab.previousSession ? `tmux:${tab.previousSession}` : null,
    ].filter(Boolean);
  }

  /**
   * Nuova lista da salvare: le schede aperte nell'ordine in cui si vedono, e
   * in mezzo — accanto a chi le precedeva — le chiavi salvate di quelle non
   * aperte, così una sessione che si riaggancia dopo ritrova il suo posto.
   * Una chiave salvata che ora è l'alias di una scheda aperta (aveva solo tmux,
   * poi è arrivato l'id della conversazione) non si ripete.
   * @param {string[][]} keyLists `tabKeys` delle schede, nell'ordine visibile
   * @param {string[]} saved lista salvata finora
   * @returns {string[]}
   */
  function mergeSaved(keyLists, saved) {
    const lists = (Array.isArray(keyLists) ? keyLists : []).filter((l) => Array.isArray(l) && l.length);
    const primaryOf = new Map(lists.flatMap((l) => l.map((k) => [k, l[0]])));
    let result = lists.map((l) => l[0]);
    const absent = [];
    let insertAt = 0;
    for (const k of Array.isArray(saved) ? saved : []) {
      if (primaryOf.has(k)) {
        insertAt = result.indexOf(primaryOf.get(k)) + 1;
      } else if (!result.includes(k)) {
        result = [...result.slice(0, insertAt), k, ...result.slice(insertAt)];
        absent.push(k);
        insertAt += 1;
      }
    }
    // Oltre il tetto si tagliano le chiavi assenti più in fondo, mai quelle aperte
    const drop = new Set(absent.slice(Math.max(0, absent.length - (result.length - MAX_SAVED_KEYS))));
    return result.length > MAX_SAVED_KEYS ? result.filter((k) => !drop.has(k)) : result;
  }

  return { moveAdjacent, applyOrder, syncOrder, tabKeys, mergeSaved };
});
