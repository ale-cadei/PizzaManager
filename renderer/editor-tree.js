/* Albero dei file della scheda editor (docs/plans/60). Il modello è puro:
 * figli letti per cartella (lazy, `''` è la radice), cartelle aperte,
 * selezione. La vista lo disegna con textContent (i nomi dei file arrivano
 * dal disco) e passa i click a chi la usa (editor-tab.js). Qui anche
 * l'input inline per i nomi e il menu contestuale.
 * Anche il drop di file da fuori e Ctrl+V (docs/plans/61): la vista dice
 * in quale cartella copiare, la copia la fa chi la usa.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorTree = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const INDENT = 12;
  const PAD = 8;

  const emptyTree = () => ({ children: {}, expanded: [], selected: null });
  const setChildren = (tree, dir, entries) => ({ ...tree, children: { ...tree.children, [dir]: entries } });
  const isExpanded = (tree, dir) => tree.expanded.includes(dir);
  const toggle = (tree, dir) => ({
    ...tree,
    expanded: isExpanded(tree, dir) ? tree.expanded.filter((d) => d !== dir) : [...tree.expanded, dir],
  });
  const select = (tree, rel) => ({ ...tree, selected: rel });

  const under = (rel, base) => rel === base || rel.startsWith(base + '/');
  const moved = (rel, from, to) => (under(rel, from) ? to + rel.slice(from.length) : rel);

  const parentOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
  const dirOf = (row) => (row.kind === 'dir' ? row.rel : parentOf(row.rel));
  // Solo i drag che portano file del sistema: non il testo, non le righe
  const carriesFiles = (e) => Boolean(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));

  function renamePath(tree, from, to) {
    const children = {};
    for (const [dir, list] of Object.entries(tree.children)) children[moved(dir, from, to)] = list;
    return {
      children,
      expanded: tree.expanded.map((d) => moved(d, from, to)),
      selected: tree.selected === null ? null : moved(tree.selected, from, to),
    };
  }

  function removePath(tree, rel) {
    const children = {};
    for (const [dir, list] of Object.entries(tree.children)) if (!under(dir, rel)) children[dir] = list;
    return {
      children,
      expanded: tree.expanded.filter((d) => !under(d, rel)),
      selected: tree.selected !== null && under(tree.selected, rel) ? null : tree.selected,
    };
  }

  function visibleRows(tree) {
    const rows = [];
    const walk = (dir, depth) => {
      for (const e of tree.children[dir] || []) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        const expanded = e.kind === 'dir' && isExpanded(tree, rel);
        rows.push({ rel, name: e.name, kind: e.kind, ignored: Boolean(e.ignored), depth, expanded });
        if (expanded) walk(rel, depth + 1);
      }
    };
    walk('', 0);
    return rows;
  }

  // Input di promptName ancora aperti → come chiuderli. Un render dell'albero
  // li toglie (replaceChildren) senza blur: la domanda si chiude con null,
  // invece di restare appesa per sempre.
  const openPrompts = new WeakMap();

  function createTreeView({ root, document: doc, onOpenFile, onToggleDir, onContextMenu, onCopyInto = () => {} }) {
    const list = doc.createElement('div');
    list.className = 'editor-tree';
    list.setAttribute('role', 'tree');
    list.tabIndex = 0; // per Ctrl+V
    // Click destro sul vuoto: le voci per creare nella radice
    list.oncontextmenu = (e) => { e.preventDefault(); onContextMenu(null, e); };
    root.appendChild(list);

    let shown = { rows: [], selected: null };
    let lit = null; // l'elemento evidenziato durante il drag

    const rowOf = (rel) => [...list.children].find((c) => c.dataset.rel === rel) || null;
    function highlight(el) {
      if (lit === el) return;
      if (lit) lit.classList.remove('is-drop-target');
      lit = el;
      if (el) el.classList.add('is-drop-target');
    }
    const targetOf = (dir) => (dir ? rowOf(dir) || list : list);
    const within = (node) => { for (let n = node; n; n = n.parentNode) if (n === list) return true; return false; };
    function onDragOver(dir) {
      return (e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault(); // senza, il drop non arriva
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        highlight(targetOf(dir));
      };
    }
    function onDrop(dir) {
      return (e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault(); // senza, Electron apre il file al posto della pagina
        e.stopPropagation();
        highlight(null);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onCopyInto(dir, { kind: 'drop', files });
      };
    }
    list.addEventListener('dragover', onDragOver(''));
    list.addEventListener('drop', onDrop(''));
    list.addEventListener('dragleave', (e) => { if (!within(e.relatedTarget)) highlight(null); });
    list.addEventListener('keydown', (e) => {
      const paste = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V');
      if (!paste) return;
      e.preventDefault();
      e.stopPropagation(); // non è l'incolla del terminale
      const row = shown.rows.find((r) => r.rel === shown.selected);
      onCopyInto(row ? dirOf(row) : '', { kind: 'paste' });
    });

    function rowElement(r, selected) {
      const el = doc.createElement('div');
      el.className = 'editor-tree-row'
        + (r.kind === 'dir' ? ' is-dir' : '')
        + (r.expanded ? ' is-open' : '')
        + (r.ignored ? ' is-ignored' : '')
        + (r.rel === selected ? ' is-selected' : '');
      el.dataset.rel = r.rel;
      el.setAttribute('role', 'treeitem');
      el.style.paddingLeft = `${PAD + r.depth * INDENT}px`;
      const twisty = doc.createElement('span');
      twisty.className = 'editor-tree-twisty';
      twisty.textContent = r.kind === 'dir' ? (r.expanded ? '▾' : '▸') : '';
      const name = doc.createElement('span');
      name.className = 'editor-tree-name';
      name.textContent = r.name; // testo, mai HTML: il nome viene dal disco
      el.append(twisty, name);
      el.onclick = () => (r.kind === 'dir' ? onToggleDir(r.rel) : onOpenFile(r.rel));
      el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(r, e); };
      el.addEventListener('dragover', onDragOver(dirOf(r)));
      el.addEventListener('drop', onDrop(dirOf(r)));
      return el;
    }

    return {
      element: list,
      render(rows, selected) {
        for (const child of [...list.children]) { const cancel = openPrompts.get(child); if (cancel) cancel(); }
        shown = { rows, selected };
        highlight(null);
        list.replaceChildren(...rows.map((r) => rowElement(r, selected)));
      },
      rowOf,
    };
  }

  /**
   * Input inline per un nome (nuovo file o cartella, rinomina), sotto la riga
   * `after` o in cima all'albero.
   * @returns {Promise<string|null>} il nome scritto; null con Esc, blur, vuoto
   *   o se un render dell'albero toglie l'input
   */
  function promptName({ document: doc, host, after = null, depth = 0, initial = '' }) {
    return new Promise((resolve) => {
      const input = doc.createElement('input');
      input.className = 'editor-tree-input';
      input.value = initial;
      input.style.marginLeft = `${PAD + depth * INDENT}px`;
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        openPrompts.delete(input);
        input.remove();
        resolve(value);
      };
      openPrompts.set(input, () => finish(null));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // le scorciatoie dell'app non devono vedere i tasti del nome
        if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim() || null); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      });
      input.addEventListener('blur', () => finish(null));
      const before = after ? after.nextElementSibling : host.children[0] || null;
      host.insertBefore(input, before);
      input.focus();
      // Rinomina: selezionato il nome senza estensione, come nei file manager
      if (initial && typeof input.setSelectionRange === 'function') {
        const dot = initial.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : initial.length);
      }
    });
  }

  /** Menu contestuale: si chiude su una scelta, su Esc e sul click fuori. */
  function showMenu({ document: doc, x, y, items }) {
    const menu = doc.createElement('div');
    menu.className = 'editor-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const inside = (node) => { for (let n = node; n; n = n.parentNode) if (n === menu) return true; return false; };
    const onDown = (e) => { if (!inside(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    function close() {
      menu.remove();
      doc.removeEventListener('mousedown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
    }
    for (const item of items) {
      const b = doc.createElement('button');
      b.className = 'editor-menu-item' + (item.danger ? ' is-danger' : '');
      b.setAttribute('role', 'menuitem');
      b.textContent = item.label;
      b.onclick = () => { close(); item.run(); };
      menu.appendChild(b);
    }
    doc.body.appendChild(menu);
    doc.addEventListener('mousedown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    return { element: menu, close };
  }

  return { emptyTree, setChildren, isExpanded, toggle, select, renamePath, removePath, visibleRows, createTreeView, promptName, showMenu };
});
