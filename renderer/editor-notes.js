/* Commenti sul codice nella scheda editor (docs/plans/65): su una riga o su
 * un gruppo di righe di un file aperto, copiati negli appunti come un prompt
 * solo. Qui solo il modello: lo stato è della scheda, in memoria, e ogni
 * operazione ne restituisce uno nuovo. Disegno e cablaggio in
 * editor-notes-ui.js. Dove sono le righe adesso lo sa l'host di Monaco
 * (trackLines): qui si tiene l'ultimo numero visto (`move`).
 *
 * Il testo del prompt lo fa review-notes.js (formatPrompt) con
 * un'intestazione sua: i commenti diventano note di review su righe di
 * contesto, e il formato resta quello del pannello modifiche.
 *
 * Wrapper UMD come review-notes.js: globale nella pagina e module.exports
 * sotto Node. */
(function (root, factory) {
  const api = factory(root && root.AisessReviewNotes);
  if (root) root.AisessEditorNotes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Review) {
  const R = Review || require('./review-notes');
  const HEADER = 'Correggi questi punti del codice:';

  const empty = () => ({ notes: [], seq: 0 });
  const fail = (state, error) => ({ ok: false, state, error });
  const goodLines = (from, to) => Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from;

  function bodyError(text) {
    if (!text) return 'Il commento è vuoto.';
    if (text.length > R.MAX_BODY) return `Commento troppo lungo (al massimo ${R.MAX_BODY} caratteri).`;
    return null;
  }

  function rangeError(from, to) {
    if (!goodLines(from, to)) return 'Righe non commentabili.';
    if (to - from + 1 > R.MAX_LINES) return `Un commento copre al massimo ${R.MAX_LINES} righe.`;
    return null;
  }

  /** @returns {{ok: true, state: object, note: object} | {ok: false, state: object, error: string}} */
  function add(state, { rel, from, to, body, track = null }) {
    const text = String(body || '').trim();
    if (typeof rel !== 'string' || !rel) return fail(state, 'File non valido.');
    const error = rangeError(from, to) || bodyError(text);
    if (error) return fail(state, error);
    if (state.notes.length >= R.MAX_NOTES) return fail(state, `Al massimo ${R.MAX_NOTES} commenti: copiali, poi continua.`);
    const note = { id: `n${state.seq + 1}`, rel, from, to, body: text, track };
    return { ok: true, state: { notes: [...state.notes, note], seq: state.seq + 1 }, note };
  }

  function update(state, id, body) {
    const text = String(body || '').trim();
    const old = state.notes.find((n) => n.id === id);
    if (!old) return fail(state, 'Il commento non c\'è più.');
    const error = bodyError(text);
    if (error) return fail(state, error);
    const note = { ...old, body: text };
    return { ok: true, state: { ...state, notes: state.notes.map((n) => (n.id === id ? note : n)) }, note };
  }

  /* Stesso stato se non si toglie niente: chi chiama può confrontare */
  function keep(state, test) {
    const notes = state.notes.filter(test);
    return notes.length === state.notes.length ? state : { ...state, notes };
  }

  const remove = (state, id) => keep(state, (n) => n.id !== id);
  // `seq` resta: un id già dato non torna, anche dopo Svuota
  const clear = (state) => (state.notes.length ? { ...state, notes: [] } : state);
  const dropFile = (state, rel) => keep(state, (n) => n.rel !== rel);

  function renameFile(state, from, to) {
    if (!state.notes.some((n) => n.rel === from)) return state;
    return { ...state, notes: state.notes.map((n) => (n.rel === from ? { ...n, rel: to } : n)) };
  }

  const find = (state, id) => state.notes.find((n) => n.id === id) || null;

  /** Le righe sono andate altrove (si è scritto sopra). Niente tetto di
      righe: scrivendo in mezzo un commento può allungarsi */
  function move(state, id, { from, to }) {
    const old = find(state, id);
    if (!old || !goodLines(from, to) || (old.from === from && old.to === to)) return state;
    return { ...state, notes: state.notes.map((n) => (n.id === id ? { ...n, from, to } : n)) };
  }

  const byLine = (a, b) => a.from - b.from || a.to - b.to;
  const forFile = (state, rel) => state.notes.filter((n) => n.rel === rel).sort(byLine);
  const count = (state, rel) => (rel === undefined ? state.notes.length : state.notes.filter((n) => n.rel === rel).length);

  const countLabel = (n) => (n === 1 ? '1 commento' : `${n} commenti`);
  const labelOf = ({ from, to }) => R.linesLabel([{ side: 'new', no: from }, { side: 'new', no: to }]);

  /* formatPrompt scarta una nota con più di MAX_LINES righe: oltre si
     citano le prime, e l'ultima resta `to` perché l'intervallo sia giusto */
  function linesFor(n) {
    const total = n.to - n.from + 1;
    const nos = Array.from({ length: Math.min(total, R.MAX_LINES) }, (_, i) => n.from + i);
    return total > R.MAX_LINES ? [...nos.slice(0, -1), n.to] : nos;
  }

  /** Note di review (review-notes.js) su righe di contesto. `textOf(rel, line)`: il testo di adesso */
  function toReviewNotes(notes, textOf) {
    return notes.map((n) => ({
      id: n.id, path: n.rel, body: n.body,
      lines: linesFor(n).map((no) => ({ side: 'new', no, kind: 'ctx', text: String(textOf(n.rel, no) || '') })),
    }));
  }

  /** Il prompt di tutti i commenti della scheda, in ordine di file e riga; vuoto senza commenti */
  const promptFor = (state, textOf) => R.formatPrompt(toReviewNotes(state.notes, textOf), { header: HEADER });

  return {
    HEADER, empty, add, update, remove, clear, dropFile, renameFile, move,
    forFile, count, find, countLabel, labelOf, toReviewNotes, promptFor,
  };
});
