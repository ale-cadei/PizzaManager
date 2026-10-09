/* Il segnale esatto degli agenti (docs/plans/46): «lavora», «ha finito»,
 * «chiede un permesso», detto dall'agente stesso tramite hook (o OSC 9 per
 * Codex). Decide barra e lampeggio; l'euristica di attention.js resta per le
 * sessioni che non hanno mai mandato un segnale.
 *
 * «Ha finito» solo se c'è stato un «lavora» dall'ultima visita: all'avvio e
 * con --resume l'agente si ferma senza aver lavorato, e non deve accendersi.
 * Il permesso si accende sempre: è una domanda, non un lavoro finito.
 *
 * Wrapper UMD come attention.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessAgentState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function createAgentState() {
    /** @type {Map<string, {ran: boolean, running: boolean|null, attention: null|'done'|'permission'}>} */
    const state = new Map();

    function get(id) {
      if (!state.has(id)) state.set(id, { ran: false, running: null, attention: null });
      return state.get(id);
    }

    function next(s, signal, watched, codex) {
      const ran = codex || s.ran;
      const quiet = (a) => (watched ? null : a);
      switch (signal) {
        case 'running': return { ran: true, running: codex ? null : true, attention: null };
        case 'waiting': return { ran: s.ran, running: codex ? null : false, attention: quiet(ran ? 'done' : s.attention) };
        case 'permission': return { ran: s.ran, running: codex ? null : false, attention: quiet('permission') };
        default: return { ran: s.ran, running: codex ? null : false, attention: s.attention };
      }
    }

    /**
     * @param {string} id
     * @param {'ready'|'running'|'waiting'|'permission'} signal
     * @param {{watched?: boolean, codex?: boolean}} [o]
     */
    function signal(id, sig, { watched = false, codex = false } = {}) {
      const s = get(id);
      const n = next(s, sig, watched, codex);
      const changed = n.running !== s.running || n.attention !== s.attention;
      state.set(id, n);
      return { running: n.running, attention: n.attention, changed };
    }

    function isExact(id) { return state.has(id); }
    function seen(id) { if (state.has(id)) state.set(id, { ...state.get(id), ran: false, attention: null }); }
    function forget(id) { state.delete(id); }

    return { signal, isExact, seen, forget };
  }


  /* Testi di Codex 0.143 per le richieste all'utente (tui/src/chatwidget):
     tutto il resto è la fine del turno (l'ultimo messaggio dell'assistente). */
  const CODEX_ASKS = ['Approval requested', 'Codex wants to edit', 'Plan mode prompt'];

  function codexOscState(text) {
    const s = String(text || '');
    return CODEX_ASKS.some((p) => s.startsWith(p)) ? 'permission' : 'waiting';
  }

  return { createAgentState, codexOscState };
});
