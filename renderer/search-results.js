/* Linguetta «Cerca» del Resume: la parte che si può verificare senza Electron.
 *
 * - `createSearchRunner`: ritardo dall'ultimo tasto e numero di sequenza. Una
 *   risposta arrivata dopo che l'utente ha scritto altro si butta: il worker
 *   annulla la ricerca vecchia, ma la sua risposta può essere già in viaggio.
 * - `snippetElement`: il frammento con la parola evidenziata. Il testo viene
 *   dalle conversazioni, quindi può contenere HTML: solo textContent, mai
 *   innerHTML (CLAUDE.md, Sicurezza).
 * - `statusText`: cosa dire quando non ci sono risultati da mostrare.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina e module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Come lib/conversation-search.js: sotto non vale la pena chiedere. */
  const MIN_QUERY = 2;
  /** Dall'ultimo tasto alla ricerca: una ricerca costa un secondo, non si fa a ogni lettera. */
  const DELAY_MS = 300;
  const ROLE_LABEL = { user: 'tu', assistant: 'agente' };

  const errorText = (e) => String((e && e.message) || e || 'errore sconosciuto');

  /** Stato da mostrare per una risposta del main, o null se va ignorata. */
  function stateFor(res, query) {
    if (!res) return { phase: 'error', error: 'nessuna risposta' };
    if (res.cancelled) return null; // la sostituisce la ricerca che l'ha annullata
    if (!res.ok) return { phase: 'error', error: res.error };
    if (!res.results || !res.results.length) return { phase: 'empty', query };
    return { phase: 'results', query, results: res.results, truncated: !!res.truncated, skipped: res.skipped || 0 };
  }

  /**
   * @param {{ search: (q: string) => Promise<object>, render: (state: object) => void,
   *   delay?: number, timers?: { setTimeout: Function, clearTimeout: Function } }} o
   * @returns {{ run: (q: string) => Promise<void>, schedule: (q: string) => void, cancel: () => void }}
   */
  function createSearchRunner({ search, render, delay = DELAY_MS, timers = { setTimeout, clearTimeout } }) {
    let seq = 0;
    let timer = null;

    function stopTimer() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    }

    /** Subito: cambio di linguetta, «Ricarica». */
    function run(raw) {
      stopTimer();
      const mine = ++seq;
      const query = String(raw == null ? '' : raw).trim();
      if (query.length < MIN_QUERY) {
        render({ phase: 'short' });
        return Promise.resolve();
      }
      render({ phase: 'loading', query });
      const current = () => mine === seq;
      return Promise.resolve()
        .then(() => search(query))
        .then((res) => {
          const state = current() ? stateFor(res, query) : null;
          if (state) render(state);
        }, (e) => {
          if (current()) render({ phase: 'error', error: errorText(e) });
        });
    }

    /** Dopo DELAY_MS dall'ultimo tasto. Una risposta ancora in viaggio non conta più. */
    function schedule(raw) {
      stopTimer();
      seq++;
      timer = timers.setTimeout(() => { timer = null; run(raw); }, delay);
    }

    /** Si è lasciata la linguetta: niente più render da questa ricerca. */
    function cancel() {
      stopTimer();
      seq++;
    }

    return { run, schedule, cancel };
  }

  function statusText(state) {
    switch (state.phase) {
      case 'short': return `Scrivi almeno ${MIN_QUERY} caratteri: si cerca nei messaggi di Claude Code e Codex. OpenCode e Antigravity si cercano per titolo nelle loro linguette.`;
      case 'loading': return 'Cerco…';
      case 'empty': return `Nessun messaggio contiene «${state.query}».`;
      case 'error': return `⚠ Ricerca non riuscita: ${state.error}`;
      default: return '';
    }
  }

  function hitsText(n) {
    return n === 1 ? '1 occorrenza' : `${n} occorrenze`;
  }

  function span(doc, tag, className, text) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    return el;
  }

  /** `{ role, before, match, after }` → riga con `match` dentro un <mark>. */
  function snippetElement(doc, snip) {
    const el = doc.createElement('div');
    el.className = 'search-snippet';
    el.appendChild(span(doc, 'span', 'search-role', (ROLE_LABEL[snip.role] || snip.role) + ':'));
    el.appendChild(span(doc, 'span', null, snip.before));
    el.appendChild(span(doc, 'mark', null, snip.match));
    el.appendChild(span(doc, 'span', null, snip.after));
    return el;
  }

  return { createSearchRunner, snippetElement, statusText, hitsText, MIN_QUERY, DELAY_MS };
});
