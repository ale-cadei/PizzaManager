/* Commenti sulle righe del diff, inviati all'agente come un prompt solo
 * (docs/plans/44-review-commenti.md). Qui solo il modello: ancore, elenco
 * delle note, testo da incollare. Disegno in changes-view.js, invio in
 * changes-panel.js.
 *
 * Una nota sta su una riga, o su un gruppo di righe consecutive dello
 * stesso hunk (docs/plans/57), finché a quei numeri c'è ancora quel testo:
 * l'agente intanto lavora, e se una riga cambia la nota diventa «orfana» ma
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
  const MAX_LINES = 200;
  const MAX_QUOTED = 20;
  const SIGN = { add: '+', del: '-', ctx: ' ' };
  const HEADER = 'Review delle modifiche, correggi questi punti:';
  // C0 tranne tab e a capo, DEL, C1 (0x9b da solo è un CSI per alcuni terminali)
  const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

  /** Testo che può andare nel pty: a capo `\n`, niente controlli */
  function sanitize(text) {
    return String(text === null || text === undefined ? '' : text).replace(/\r\n/g, '\n').replace(CONTROL, '');
  }

  /* Una riga del diff come la ricorda una nota: le tolte col numero vecchio,
     le altre col nuovo; `kind` serve solo al segno nel prompt */
  function lineRef(line) {
    if (!line || line.kind === 'note') return null;
    const side = line.kind === 'del' ? 'old' : 'new';
    const no = side === 'old' ? line.oldNo : line.newNo;
    if (!Number.isInteger(no)) return null;
    return { side, no, kind: line.kind, text: String(line.text || '') };
  }

  const sameRef = (a, b) => Boolean(a && b) && a.side === b.side && a.no === b.no && a.text === b.text;

  /**
   * L'ancora di una riga sola.
   * @param {string} path
   * @param {{kind: string, oldNo: number|null, newNo: number|null, text: string}} line
   * @returns {{path: string, lines: Array<{side: 'new'|'old', no: number, kind: string, text: string}>}|null}
   */
  function anchorOf(path, line) {
    const ref = path ? lineRef(line) : null;
    return ref ? { path, lines: [ref] } : null;
  }

  /* Le righe commentabili di un hunk, con la riga del diff da cui vengono */
  const refsOf = (hunk) => hunk.lines.map((line) => ({ line, ref: lineRef(line) })).filter((r) => r.ref);

  /**
   * L'ancora delle righe di un hunk fra `from` e `to`, estremi compresi, in
   * qualunque ordine (docs/plans/57). Fra due hunk ci sono righe che il diff
   * non mostra: un gruppo sta in un hunk solo.
   * @returns {{ok: true, anchor: object}|{ok: false, error: string}}
   */
  function rangeAnchor(path, hunk, from, to) {
    const refs = hunk && Array.isArray(hunk.lines) ? refsOf(hunk) : [];
    const a = refs.findIndex((r) => sameRef(r.ref, from));
    const b = refs.findIndex((r) => sameRef(r.ref, to));
    if (!path || a < 0 || b < 0) return { ok: false, error: 'Solo righe dello stesso blocco: fra due blocchi ci sono righe che il diff non mostra.' };
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo + 1 > MAX_LINES) return { ok: false, error: `Al massimo ${MAX_LINES} righe per commento: commentale a pezzi.` };
    return { ok: true, anchor: { path, lines: refs.slice(lo, hi + 1).map((r) => r.ref) } };
  }

  const refKey = (r) => `${r.side}:${r.no}`;

  /** `new:12:path` per una riga, `new:12-new:14:path` per un gruppo */
  function noteId(anchor) {
    const first = anchor.lines[0];
    const last = anchor.lines[anchor.lines.length - 1];
    const span = anchor.lines.length === 1 ? refKey(first) : `${refKey(first)}-${refKey(last)}`;
    return `${span}:${anchor.path}`;
  }

  const validAnchor = (a) => Boolean(a && a.path && Array.isArray(a.lines) && a.lines.length && a.lines.length <= MAX_LINES);

  /**
   * Aggiunge una nota, o riscrive quella che c'è già sulle stesse righe.
   * `replaces`: la nota di cui si è cambiato il gruppo, che sparisce.
   * @returns {{ok: true, notes: object[]}|{ok: false, notes: object[], error: string}}
   */
  function addNote(notes, anchor, body, { replaces = null } = {}) {
    const list = notes || [];
    const text = String(body || '').trim();
    if (!validAnchor(anchor)) return { ok: false, notes: list, error: 'Righe non commentabili.' };
    if (!text) return { ok: false, notes: list, error: 'Il commento è vuoto.' };
    if (text.length > MAX_BODY) return { ok: false, notes: list, error: `Commento troppo lungo (al massimo ${MAX_BODY} caratteri).` };
    const id = noteId(anchor);
    if (takenBy(list, id, replaces)) return { ok: false, notes: list, error: TAKEN };
    const rest = replaces && replaces !== id ? list.filter((n) => n.id !== replaces) : list;
    const exists = rest.some((n) => n.id === id);
    if (!exists && rest.length >= MAX_NOTES) return { ok: false, notes: list, error: `Al massimo ${MAX_NOTES} commenti: invia questi, poi continua.` };
    const note = { path: anchor.path, lines: anchor.lines, id, body: text };
    return { ok: true, notes: exists ? rest.map((n) => (n.id === id ? note : n)) : [...rest, note] };
  }

  const TAKEN = 'Su queste righe c\'è già un altro commento: modifica quello.';

  /* Cambiando il gruppo di una nota si può finire sulle righe esatte di
     un'altra: salvare la cancellerebbe senza dirlo */
  function takenBy(notes, id, replaces) {
    return Boolean(replaces) && replaces !== id && (notes || []).some((n) => n.id === id);
  }

  function removeNote(notes, id) {
    return (notes || []).filter((n) => n.id !== id);
  }

  const loaded = (diff) => Boolean(diff && !diff.loading && diff.ok !== false && Array.isArray(diff.hunks));

  /* Dove comincia ogni riga commentabile del diff: hunk e posizione */
  function indexOf(diff) {
    const hunks = diff.hunks.map(refsOf);
    const starts = new Map();
    hunks.forEach((refs, h) => refs.forEach((r, i) => {
      const key = refKey(r.ref);
      if (!starts.has(key)) starts.set(key, []);
      starts.get(key).push({ h, i });
    }));
    return { hunks, starts };
  }

  /* Le righe del diff di un'ancora, se ci sono tutte, uguali e di fila in un hunk */
  function locate(anchor, index) {
    for (const { h, i } of index.starts.get(refKey(anchor.lines[0])) || []) {
      const refs = index.hunks[h].slice(i, i + anchor.lines.length);
      if (refs.length === anchor.lines.length && refs.every((r, k) => sameRef(r.ref, anchor.lines[k]))) return refs.map((r) => r.line);
    }
    return null;
  }

  /**
   * Dove sta un'ancora nel diff caricato (la textarea va sotto `last`).
   * @returns {{last: object, lines: Set<object>}|null}
   */
  function placeOf(anchor, diff) {
    if (!validAnchor(anchor) || !loaded(diff)) return null;
    const lines = locate(anchor, indexOf(diff));
    return lines ? { last: lines[lines.length - 1], lines: new Set(lines) } : null;
  }

  /**
   * Le note di un file nel diff caricato, in un passaggio solo: sotto quale
   * riga va ognuna (`endsAt`), quali righe stanno in un gruppo (`covered`, il
   * segno a sinistra), e le orfane. Senza diff non si sa ancora: nessuna orfana.
   * @returns {{endsAt: Map<object, object[]>, covered: Set<object>, orphans: object[]}}
   */
  function placeNotes(notes, path, diff) {
    const placed = { endsAt: new Map(), covered: new Set(), orphans: [] };
    if (!loaded(diff)) return placed;
    const index = indexOf(diff);
    for (const n of (notes || []).filter((x) => x.path === path)) {
      const lines = validAnchor(n) ? locate(n, index) : null;
      if (!lines) { placed.orphans.push(n); continue; }
      const last = lines[lines.length - 1];
      placed.endsAt.set(last, [...(placed.endsAt.get(last) || []), n]);
      if (lines.length > 1) lines.forEach((l) => placed.covered.add(l));
    }
    return placed;
  }

  function countFor(notes, path) {
    return (notes || []).filter((n) => n.path === path).length;
  }

  /* Numeri nuovi e quante righe tolte; per l'etichetta e per il prompt */
  function spanOf(lines) {
    const fresh = lines.filter((l) => l.side === 'new').map((l) => l.no);
    const gone = lines.filter((l) => l.side === 'old').map((l) => l.no);
    const bounds = (nos) => [Math.min(...nos), Math.max(...nos)];
    return { fresh: fresh.length ? bounds(fresh) : null, gone: gone.length ? bounds(gone) : null, goneCount: gone.length };
  }

  const firstNo = (n) => {
    const { fresh, gone } = spanOf(n.lines);
    return fresh ? fresh[0] : gone[0];
  };
  const onlyGone = (n) => !spanOf(n.lines).fresh;
  const byPlace = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : firstNo(a) - firstNo(b) || onlyGone(a) - onlyGone(b));

  /** «Riga 12», «Righe 12–14», «Righe 5–8 tolte», «Righe 12–14 e 2 tolte» */
  function linesLabel(lines) {
    const { fresh, gone, goneCount } = spanOf(lines);
    const span = ([a, b]) => (a === b ? `${a}` : `${a}–${b}`);
    if (!fresh) return lines.length === 1 ? `Riga ${gone[0]} tolta` : `Righe ${span(gone)} tolte`;
    const head = fresh[0] === fresh[1] ? `Riga ${fresh[0]}` : `Righe ${span(fresh)}`;
    return goneCount ? `${head} e ${goneCount} ${goneCount === 1 ? 'tolta' : 'tolte'}` : head;
  }

  function where(n) {
    const path = sanitize(n.path).replace(/\n/g, ' ');
    const { fresh, gone, goneCount } = spanOf(n.lines);
    const span = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);
    if (!fresh) return n.lines.length === 1 ? `${path} (riga ${gone[0]} tolta)` : `${path} (righe ${span(gone)} tolte)`;
    if (!goneCount) return `${path}:${span(fresh)}`;
    return `${path}:${span(fresh)} (e ${goneCount} ${goneCount === 1 ? 'riga tolta' : 'righe tolte'})`;
  }

  const oneLine = (text) => sanitize(text).replace(/\n/g, ' ');

  /* Una riga sola citata com'è (`> testo`), un gruppo col segno del diff */
  function quoteOf(n) {
    if (n.lines.length === 1) return [`   > ${oneLine(n.lines[0].text).trim()}`];
    const shown = n.lines.slice(0, MAX_QUOTED).map((l) => `   ${SIGN[l.kind] || ' '} ${oneLine(l.text)}`.trimEnd());
    const more = n.lines.length - shown.length;
    return more > 0 ? [...shown, `   … (altre ${more} righe)`] : shown;
  }

  /** Il prompt per l'agente; vuoto se non ci sono note. `header`: la prima riga (la scheda editor ha la sua, docs/plans/65) */
  function formatPrompt(notes, { header = HEADER } = {}) {
    const list = [...(notes || [])].filter(validAnchor).sort(byPlace);
    if (!list.length) return '';
    const items = list.map((n, i) => {
      const body = sanitize(n.body).split('\n').map((l) => `   ${l}`.trimEnd());
      return [`${i + 1}. ${where(n)}`, ...quoteOf(n), ...body].join('\n');
    });
    return [header, '', items.join('\n\n')].join('\n');
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
    MAX_BODY, MAX_NOTES, MAX_LINES, TAKEN, sanitize, anchorOf, rangeAnchor, noteId, addNote, removeNote, placeOf, placeNotes,
    countFor, linesLabel, formatPrompt, pasteFor,
  };
});
