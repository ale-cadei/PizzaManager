/* Suggerimenti che si vedono una volta sola (docs/plans/20-onboarding.md).
 *
 * Non un tour: un fumetto nel momento in cui la funzione diventa utile — la
 * seconda chat in un gruppo, il secondo progetto — e mai più. Un suggerimento
 * conta come visto quando appare, non quando si chiude: se sparisce per un
 * render o un click altrove, non deve ripresentarsi.
 *
 * Qui solo la decisione (`nextHint`, pura) e il ricordo di quelli visti
 * (localStorage). Il fumetto è quello di confirm-bubble.js (`tell`), e chi
 * li mette insieme è renderer.js.
 *
 * Wrapper UMD come session-groups.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessHints = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const SEEN_KEY = 'aisess.seenHints';
  const HINTS = { cards: 'reorder-cards', projects: 'reorder-projects' };

  /**
   * Il prossimo suggerimento da mostrare, o null. Prima quello delle card:
   * due chat in un gruppo capitano prima di due progetti.
   * @param {{seen: Set<string>, groups: Array<{key: string, kind: string, items: Array<{id: string}>}>,
   *   mode: 'type'|'project'}} state
   * @returns {{id: string, anchor: {kind: 'card'|'group', key: string}, title: string, text: string}|null}
   */
  function nextHint({ seen, groups, mode }) {
    const list = Array.isArray(groups) ? groups : [];
    const known = seen instanceof Set ? seen : new Set();
    const crowded = list.find((g) => g.items && g.items.length >= 2);
    if (!known.has(HINTS.cards) && crowded) {
      return {
        id: HINTS.cards,
        anchor: { kind: 'card', key: crowded.items[1].id },
        title: 'Trascina le chat per riordinarle',
        text: 'L\'ordine resta anche dopo la chiusura. Doppio click su una chat per rinominarla.',
      };
    }
    // «Senza directory» (chiave vuota) non si sposta: non conta come progetto
    const projects = list.filter((g) => g.kind === 'project' && g.key);
    if (!known.has(HINTS.projects) && mode === 'project' && projects.length >= 2) {
      return {
        id: HINTS.projects,
        anchor: { kind: 'group', key: projects[1].key },
        title: 'Trascina la linguetta per spostare il progetto',
        text: 'Il «+» accanto alla cartella apre una nuova sessione in quel progetto.',
      };
    }
    return null;
  }

  /** @param {Storage} storage */
  function createHintStore(storage) {
    function seen() {
      try {
        const v = JSON.parse(storage.getItem(SEEN_KEY) || '[]');
        return new Set(Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []);
      } catch { return new Set(); }
    }
    function markSeen(id) {
      try { storage.setItem(SEEN_KEY, JSON.stringify([...seen(), id])); } catch {}
    }
    return { seen, markSeen };
  }

  return { nextHint, createHintStore, HINTS };
});
