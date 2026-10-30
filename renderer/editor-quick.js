/* «Vai al file» della scheda editor (Ctrl+P, docs/plans/70). L'ordine dei
 * risultati è puro (rankFiles): prima i file aperti, poi chi ha il testo in
 * testa al nome, dentro il nome, nel percorso, e il fuzzy sul nome. La vista
 * è un riquadro sopra il codice con un campo, i gruppi «Aperti» e «Nel
 * progetto», e i tasti ↑↓ Invio Esc. I nomi arrivano dal disco: sempre
 * textContent.
 *
 * Wrapper UMD come editor-tree.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory(root ? root.AisessEditorIcons : require('./editor-icons'));
  if (root) root.AisessEditorQuick = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Icons) {
  const LIMIT = 50;
  const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
  const dirName = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
  const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);

  /** Le lettere di `q` in ordine dentro `text`: gli indici, o null. */
  function fuzzyHits(text, q) {
    const hits = [];
    let from = 0;
    for (const ch of q) {
      const at = text.indexOf(ch, from);
      if (at < 0) return null;
      hits.push(at);
      from = at + 1;
    }
    return hits;
  }

  /** Livello (più basso = meglio) e lettere da evidenziare nel nome; null se non corrisponde. */
  function matchOf(rel, q) {
    const name = baseName(rel).toLowerCase();
    const at = name.indexOf(q);
    if (at === 0) return { tier: 0, hits: range(0, q.length) };
    if (at > 0) return { tier: 1, hits: range(at, q.length) };
    if (rel.toLowerCase().includes(q)) return { tier: 2, hits: [] }; // il percorso pesa meno del nome
    const fuzzy = fuzzyHits(name, q);
    return fuzzy ? { tier: 3, hits: fuzzy } : null;
  }

  const item = (rel, hits = []) => ({ rel, name: baseName(rel), dir: dirName(rel), hits });

  /**
   * @param {{files: string[]|null, open: string[], recent?: string[], query: string, limit?: number}} o
   * @returns {{open: object[], project: object[], total: number}} `total`: quanti corrispondono, prima del tetto
   */
  function rankFiles({ files, open, recent = [], query, limit = LIMIT }) {
    const q = String(query || '').trim().toLowerCase();
    const openSet = new Set(open);
    if (!q) {
      const project = recent.filter((rel) => !openSet.has(rel)).slice(0, limit).map((rel) => item(rel));
      return { open: open.map((rel) => item(rel)), project, total: (files || []).length };
    }
    const scored = [];
    for (const rel of new Set([...open, ...(files || [])])) {
      const m = matchOf(rel, q);
      if (m) scored.push({ ...item(rel, m.hits), tier: m.tier });
    }
    scored.sort((a, b) => a.tier - b.tier || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
    return {
      open: scored.filter((i) => openSet.has(i.rel)),
      project: scored.filter((i) => !openSet.has(i.rel)).slice(0, limit),
      total: scored.length,
    };
  }

  /**
   * @param {{document: Document, host: Element, onPick: (rel: string) => void, onClose: () => void,
   *   source: () => {files: string[]|null, open: string[], recent: string[], git: object, loading?: boolean, truncated?: boolean}}} o
   */
  function createQuickView({ document: doc, host, source, onPick, onClose }) {
    const el = (tag, cls, parent, text) => {
      const n = doc.createElement(tag);
      n.className = cls;
      if (text !== undefined) n.textContent = text;
      if (parent) parent.appendChild(n);
      return n;
    };
    const panel = el('div', 'editor-quick-panel', host);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Vai al file');
    const field = el('div', 'editor-quick-field', panel);
    el('span', 'codicon codicon-search', field).setAttribute('aria-hidden', 'true');
    const input = el('input', 'editor-quick-input', field);
    input.setAttribute('placeholder', 'Nome del file…');
    input.setAttribute('aria-label', 'Nome del file');
    input.setAttribute('spellcheck', 'false');
    const count = el('span', 'editor-quick-count', field);
    const list = el('div', 'editor-quick-list', panel);
    list.setAttribute('role', 'listbox');
    el('div', 'editor-quick-foot', panel, '↑↓ scegli · Invio apri · Esc chiudi');

    let flat = [];
    let index = 0;
    let closed = false;

    function nameEl(it) {
      const name = el('span', 'editor-quick-name');
      const hits = new Set(it.hits);
      // Pezzi consecutivi dentro o fuori dalla corrispondenza
      let i = 0;
      while (i < it.name.length) {
        const lit = hits.has(i);
        let j = i;
        while (j < it.name.length && hits.has(j) === lit) j += 1;
        el('span', lit ? 'editor-match' : '', name, it.name.slice(i, j));
        i = j;
      }
      return name;
    }

    function rowEl(it, isOpen, git, at) {
      const row = el('div', 'editor-quick-row' + (at === index ? ' is-selected' : ''));
      row.dataset.rel = it.rel;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', at === index ? 'true' : 'false');
      row.append(Icons.iconElement(doc, it.name, 'file'), nameEl(it));
      el('span', 'editor-quick-dir', row, it.dir);
      if (isOpen) el('span', 'editor-quick-open', row, 'aperto');
      const letter = git[it.rel] || '';
      el('span', 'editor-tree-git' + (letter ? ` is-${letter}` : ''), row, letter);
      row.onmousedown = (e) => e.preventDefault(); // il fuoco resta nel campo
      row.onclick = () => pick(it.rel);
      row.onmousemove = () => { if (index !== at) { index = at; paint(); } };
      return row;
    }

    function paint() {
      const src = source();
      const r = rankFiles({ files: src.files, open: src.open, recent: src.recent, query: input.value });
      flat = [...r.open, ...r.project];
      index = Math.min(index, Math.max(0, flat.length - 1));
      count.textContent = src.loading ? 'leggo i file…' : `${r.total}${src.truncated ? '+' : ''} file`;
      const rows = [];
      let at = 0;
      for (const [label, items, isOpen] of [['Aperti', r.open, true], ['Nel progetto', r.project, false]]) {
        if (!items.length) continue;
        rows.push(el('div', 'editor-quick-group', null, label));
        for (const it of items) rows.push(rowEl(it, isOpen, src.git || {}, at++));
      }
      if (!flat.length && !src.loading) rows.push(el('div', 'editor-quick-none', null, 'Nessun file con questo nome.'));
      list.replaceChildren(...rows);
    }

    function close() {
      if (closed) return;
      closed = true;
      panel.remove();
      onClose();
    }

    function pick(rel) {
      close();
      onPick(rel);
    }

    input.addEventListener('input', () => { index = 0; paint(); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // i tasti del campo non arrivano a Monaco né alle scorciatoie dell'app
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (flat.length) index = (index + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
        paint();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flat[index]) pick(flat[index].rel);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    input.addEventListener('blur', close);
    paint();
    if (typeof input.focus === 'function') input.focus();

    return { element: panel, input, refresh: paint, close, isOpen: () => !closed };
  }

  return { rankFiles, createQuickView, LIMIT };
});
