/* Modifiche a un notebook Jupyter (.ipynb) dalla vista della scheda editor
 * (docs/plans/78). Lavora sul JSON grezzo, non su quello letto per la vista
 * (notebook-model.js): quello che la vista non conosce (metadati, output che
 * non mostra) deve tornare nel file com'era.
 *
 * Ogni operazione torna un `raw` nuovo, l'originale resta com'è; le celle
 * non toccate si condividono. `serialize` riscrive come Jupyter: rientro e
 * a capo finale presi dal file, ordine delle chiavi conservato, `source` ad
 * array di righe.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessNotebookEdit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const TYPES = ['code', 'markdown', 'raw'];
  const DEFAULT_INDENT = 1; // json.dumps(nb, indent=1) di nbformat

  /**
   * @typedef {{doc: {cells: Array<object|*>, nbformat?: number, nbformat_minor?: number},
   *   indent: number, newline: boolean}} RawNotebook
   */

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** @returns {{ok: true, raw: RawNotebook} | {ok: false, error: string}} */
  function parseRaw(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `JSON non valido: ${e.message}` };
    }
    if (!isObject(doc) || !Array.isArray(doc.cells)) return { ok: false, error: 'Non è un notebook: mancano le celle.' };
    const indented = /\n( +)\S/.exec(text);
    return { ok: true, raw: { doc, indent: indented ? indented[1].length : DEFAULT_INDENT, newline: /\n$/.test(text) } };
  }

  /** @param {RawNotebook} raw */
  const serialize = (raw) => `${JSON.stringify(raw.doc, null, raw.indent)}${raw.newline ? '\n' : ''}`;

  /** Le righe di nbformat: ognuna col suo `\n`, l'ultima senza se non c'era. */
  const linesOf = (text) => (text ? text.split(/(?<=\n)/) : []);

  const withCells = (raw, cells) => ({ ...raw, doc: { ...raw.doc, cells } });

  /* Una cella oggetto a `index` passata da `fn`; altrimenti nulla cambia */
  function updateCell(raw, index, fn) {
    const cell = raw.doc.cells[index];
    if (!isObject(cell)) return raw;
    const next = fn(cell);
    if (next === cell) return raw;
    return withCells(raw, raw.doc.cells.map((c, k) => (k === index ? next : c)));
  }

  /** @param {RawNotebook} raw @param {number} index @param {string} text */
  const setSource = (raw, index, text) => updateCell(raw, index, (c) => ({ ...c, source: linesOf(text) }));

  /* nbformat 4.5 ha introdotto `id` nelle celle, ed è obbligatorio da lì */
  function wantsIds(doc) {
    const major = Number(doc.nbformat) || 4;
    return major > 4 || (major === 4 && Number(doc.nbformat_minor) >= 5);
  }

  /* Chiavi in ordine alfabetico, come json.dumps(sort_keys=True) di Jupyter */
  function newCell(type, id) {
    const base = type === 'code' ? { cell_type: type, execution_count: null } : { cell_type: type };
    const withId = id ? { ...base, id } : base;
    return type === 'code' ? { ...withId, metadata: {}, outputs: [], source: [] } : { ...withId, metadata: {}, source: [] };
  }

  /**
   * @param {RawNotebook} raw
   * @param {number} at posizione della cella nuova (fuori dai limiti va agli estremi)
   * @param {'code'|'markdown'|'raw'} type
   * @param {() => string} newId usato solo da nbformat 4.5
   */
  function insertCell(raw, at, type, newId) {
    const kind = TYPES.includes(type) ? type : 'code';
    const where = Math.max(0, Math.min(at, raw.doc.cells.length));
    const cell = newCell(kind, wantsIds(raw.doc) ? newId() : null);
    const cells = raw.doc.cells;
    return withCells(raw, [...cells.slice(0, where), cell, ...cells.slice(where)]);
  }

  function deleteCell(raw, index) {
    if (index < 0 || index >= raw.doc.cells.length) return raw;
    return withCells(raw, raw.doc.cells.filter((_, k) => k !== index));
  }

  /** @param {number} delta -1 sopra, +1 sotto */
  function moveCell(raw, index, delta) {
    const to = index + delta;
    const { cells } = raw.doc;
    if (index < 0 || index >= cells.length || to < 0 || to >= cells.length) return raw;
    const next = [...cells];
    [next[index], next[to]] = [next[to], next[index]];
    return withCells(raw, next);
  }

  /* Il codice ha output e numero di esecuzione, gli altri tipi no. Le chiavi
     nuove vanno dove le metterebbe Jupyter: execution_count dopo cell_type,
     outputs prima di source. */
  function retype(cell, type) {
    const { outputs, execution_count: count, ...rest } = cell;
    if (type !== 'code') return { ...rest, cell_type: type };
    const insertBefore = (keys, key, before) => {
      const at = keys.indexOf(before);
      return at < 0 ? [...keys, key] : [...keys.slice(0, at), key, ...keys.slice(at)];
    };
    const keys = Object.keys(rest);
    const afterType = keys[keys.indexOf('cell_type') + 1];
    const withCount = afterType ? insertBefore(keys, 'execution_count', afterType) : [...keys, 'execution_count'];
    const ordered = insertBefore(withCount, 'outputs', 'source');
    const filled = { ...rest, cell_type: type, execution_count: null, outputs: [] };
    return Object.fromEntries(ordered.map((k) => [k, filled[k]]));
  }

  function setType(raw, index, type) {
    if (!TYPES.includes(type)) return raw;
    return updateCell(raw, index, (c) => (c.cell_type === type ? c : retype(c, type)));
  }

  const cleared = (c) => (c.cell_type === 'code' ? { ...c, execution_count: null, outputs: [] } : c);

  /** @param {number} [index] senza, tutte le celle */
  function clearOutputs(raw, index) {
    if (index !== undefined) return updateCell(raw, index, cleared);
    return withCells(raw, raw.doc.cells.map((c) => (isObject(c) ? cleared(c) : c)));
  }

  /**
   * Il risultato di un'esecuzione (docs/plans/79): output e numero nella
   * cella di codice `index`. Le chiavi restano dove sono nel file.
   */
  function setOutputs(raw, index, outputs, count) {
    return updateCell(raw, index, (c) => (c.cell_type === 'code' ? { ...c, execution_count: count, outputs } : c));
  }

  const sourceText = (c) => (Array.isArray(c.source) ? c.source.join('') : String(c.source || ''));
  const isCodeWith = (c, source) => isObject(c) && c.cell_type === 'code' && sourceText(c) === source;

  /**
   * Dove sta ora la cella che girava: dal suo `id` (nbformat 4.5), che
   * resta anche se intanto se ne aggiungono o spostano altre. Senza id
   * (nbformat < 4.5) dal sorgente di quando è partita: all'indice di
   * allora se c'è ancora lei, se no l'unica cella di codice con quel
   * sorgente. -1 se non c'è più o non si sa quale: meglio perdere un
   * output che scriverlo nella cella di un altro.
   */
  function cellIndexById(raw, id, fallback, source) {
    const { cells } = raw.doc;
    if (typeof id === 'string' && id) return cells.findIndex((c) => isObject(c) && c.id === id);
    if (typeof source !== 'string') return -1;
    if (Number.isInteger(fallback) && isCodeWith(cells[fallback], source)) return fallback;
    const found = cells.reduce((acc, c, i) => (isCodeWith(c, source) ? [...acc, i] : acc), []);
    return found.length === 1 ? found[0] : -1;
  }

  /* Modo comando di Jupyter: una lettera, senza modificatori */
  const PLAIN = {
    ArrowUp: 'up', k: 'up', ArrowDown: 'down', j: 'down', Enter: 'edit', a: 'above', b: 'below',
    m: 'markdown', y: 'code', r: 'raw', z: 'undo',
  };

  function withCtrl(e) {
    const key = e.key.toLowerCase();
    if (key === 's' && !e.shiftKey) return 'save';
    if (key === 'enter') return 'run';
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !e.shiftKey) return 'redo';
    return null;
  }

  /**
   * Il comando di un tasto nella vista, con nessuna cella in modifica.
   * @param {{key: string, ctrlKey: boolean, metaKey: boolean, altKey: boolean, shiftKey: boolean}} e
   * @param {boolean} armed la D di prima: la seconda elimina
   * @returns {string|null} 'arm-delete' per la prima D
   */
  function commandForKey(e, armed) {
    if (e.altKey) return null;
    if (e.ctrlKey || e.metaKey) return withCtrl(e);
    if (e.key === 'Enter') return e.shiftKey ? 'next' : 'edit';
    if (e.shiftKey) return null;
    if (e.key === 'd') return armed ? 'delete' : 'arm-delete';
    return PLAIN[e.key] || null;
  }

  return {
    commandForKey, parseRaw, serialize, setSource, insertCell, deleteCell, moveCell, setType, clearOutputs,
    setOutputs, cellIndexById,
  };
});
