/* Commenti sulle righe del diff, inviati all'agente come un prompt solo
 * (docs/plans/44-review-commenti.md). Qui solo il modello: ancore, elenco
 * delle note, testo da incollare. Disegno in changes-view.js, invio in
 * changes-panel.js.
 *
 * Una nota sta su una riga finché a quel numero c'è ancora quel testo:
 * l'agente intanto lavora, e se la riga cambia la nota diventa «orfana» ma
 * non si perde. Il testo citato basta all'agente a ritrovarla.
 *
 * Righe e note finiscono nel pty: se ne tolgono i caratteri di controllo,
 * o un `\x1b[201~` dentro un file chiuderebbe l'incolla e il resto
 * arriverebbe come tasti premuti.
 *
 * Gli elenchi non si modificano mai: ogni operazione ne restituisce uno nuovo.
 *
 * Wrapper UMD come changes-model.js: globale nella pagina e module.exports
 * sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessReviewNotes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const MAX_BODY = 2000;
  const MAX_NOTES = 50;
  const HEADER = 'Review delle modifiche, correggi questi punti:';
  // C0 tranne tab e a capo, DEL, C1 (0x9b da solo è un CSI per alcuni terminali)
  const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

  /** Testo che può andare nel pty: a capo `\n`, niente controlli */
  function sanitize(text) {
    return String(text === null || text === undefined ? '' : text).replace(/\r\n/g, '\n').replace(CONTROL, '');
  }

  /**
   * Dove si attacca una nota: le righe tolte col numero vecchio, le altre col nuovo.
   * @param {string} path
   * @param {{kind: string, oldNo: number|null, newNo: number|null, text: string}} line
   * @returns {{path: string, side: 'new'|'old', no: number, text: string}|null}
   */
  function anchorOf(path, line) {
    if (!path || !line) return null;
    const side = line.kind === 'del' ? 'old' : 'new';
    const no = side === 'old' ? line.oldNo : line.newNo;
    if (line.kind === 'note' || !Number.isInteger(no)) return null;
    return { path, side, no, text: String(line.text || '') };
  }

  const noteId = (anchor) => `${anchor.side}:${anchor.no}:${anchor.path}`;

  /**
   * Aggiunge una nota, o riscrive quella che c'è già sulla stessa riga.
   * @returns {{ok: true, notes: object[]}|{ok: false, notes: object[], error: string}}
   */
  function addNote(notes, anchor, body) {
    const list = notes || [];
    const text = String(body || '').trim();
    if (!anchor) return { ok: false, notes: list, error: 'Riga non commentabile.' };
    if (!text) return { ok: false, notes: list, error: 'Il commento è vuoto.' };
    if (text.length > MAX_BODY) return { ok: false, notes: list, error: `Commento troppo lungo (al massimo ${MAX_BODY} caratteri).` };
    const id = noteId(anchor);
    const exists = list.some((n) => n.id === id);
    if (!exists && list.length >= MAX_NOTES) return { ok: false, notes: list, error: `Al massimo ${MAX_NOTES} commenti: invia questi, poi continua.` };
    const note = { ...anchor, id, body: text };
    return { ok: true, notes: exists ? list.map((n) => (n.id === id ? note : n)) : [...list, note] };
  }

  function removeNote(notes, id) {
    return (notes || []).filter((n) => n.id !== id);
  }

  /** Le note che stanno su questa riga del diff (stesso numero e stesso testo) */
  function notesAt(notes, path, line) {
    const anchor = anchorOf(path, line);
    if (!anchor) return [];
    const id = noteId(anchor);
    return (notes || []).filter((n) => n.id === id && n.text === anchor.text);
  }

  /** Le note di un file che nel diff caricato non trovano più la loro riga */
  function orphansOf(notes, path, diff) {
    if (!diff || diff.loading || diff.ok === false || !Array.isArray(diff.hunks)) return [];
    const lines = diff.hunks.flatMap((h) => h.lines);
    return (notes || []).filter((n) => n.path === path && !lines.some((l) => notesAt([n], path, l).length));
  }

  function countFor(notes, path) {
    return (notes || []).filter((n) => n.path === path).length;
  }

  const byPlace = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.no - b.no || (a.side === 'new' ? -1 : 1));

  function where(n) {
    const path = sanitize(n.path).replace(/\n/g, ' ');
    return n.side === 'old' ? `${path} (riga ${n.no} tolta)` : `${path}:${n.no}`;
  }

  /** Il prompt per l'agente; vuoto se non ci sono note */
  function formatPrompt(notes) {
    const list = [...(notes || [])].sort(byPlace);
    if (!list.length) return '';
    const items = list.map((n, i) => {
      const quote = sanitize(n.text).replace(/\n/g, ' ').trim();
      const body = sanitize(n.body).split('\n').map((l) => `   ${l}`.trimEnd());
      return [`${i + 1}. ${where(n)}`, `   > ${quote}`, ...body].join('\n');
    });
    return [HEADER, '', items.join('\n\n')].join('\n');
  }

  /**
   * Il testo da incollare nel terminale (term.paste), o perché no. Senza
   * bracketed paste ogni a capo arriverebbe all'agente come un Invio: meglio
   * non mandare niente che mandare mezzo prompt.
   * @param {object[]} notes
   * @param {{bracketed: boolean}} o se l'agente ha acceso il bracketed paste
   */
  function pasteFor(notes, { bracketed }) {
    const text = formatPrompt(notes);
    if (!text) return { ok: false, error: 'Nessun commento da inviare.' };
    if (!bracketed) {
      return { ok: false, error: 'L\'agente ora non accetta un incolla su più righe: ogni a capo diventerebbe un Invio. '
        + 'Aspetta che torni al prompt e riprova.' };
    }
    return { ok: true, text };
  }

  return {
    MAX_BODY, MAX_NOTES, sanitize, anchorOf, noteId, addNote, removeNote, notesAt, orphansOf, countFor, formatPrompt, pasteFor,
  };
});
