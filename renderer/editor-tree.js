/* Albero dei file della scheda editor (docs/plans/60). Il modello è puro:
 * figli letti per cartella (lazy, `''` è la radice), cartelle aperte,
 * selezione. La vista lo disegna con textContent (i nomi dei file arrivano
 * dal disco) e passa i click a chi la usa (editor-tab.js). Qui anche
 * l'input inline per i nomi e il menu contestuale.
 * Anche il drop di file da fuori e Ctrl+V (docs/plans/61): la vista dice
 * in quale cartella copiare, la copia la fa chi la usa.
 *
 * Righe con chevron e icona, menu con icone e scorciatoie (docs/plans/70).
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory(root ? root.AisessEditorIcons : require('./editor-icons'));
  if (root) root.AisessEditorTree = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Icons) {
  const INDENT = 14;
  const PAD = 8;

  const GIT_TITLES = { M: 'Modificato', U: 'Nuovo, non tracciato', A: 'Aggiunto', D: 'Eliminato' };

  const emptyTree = () => ({ children: {}, expanded: [], selected: null });
  const setChildren = (tree, dir, entries) => ({ ...tree, children: { ...tree.children, [dir]: entries } });
  const isExpanded = (tree, dir) => tree.expanded.includes(dir);
  const toggle = (tree, dir) => ({
    ...tree,
    expanded: isExpanded(tree, dir) ? tree.expanded.filter((d) => d !== dir) : [...tree.expanded, dir],
  });
  const select = (tree, rel) => ({ ...tree, selected: rel });
  const deselect = (tree) => ({ ...tree, selected: null });

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

  /**
   * Filtro dell'albero (docs/plans/70): le voci delle cartelle già lette il
   * cui nome contiene `query`, senza maiuscole. Prima chi comincia così, poi
   * i percorsi più corti. `at`: dove sta la corrispondenza nel nome.
   */
  function filterRows(tree, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const rows = [];
    for (const [dir, list] of Object.entries(tree.children)) {
      for (const e of list || []) {
        const at = e.name.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        rows.push({ rel, name: e.name, kind: e.kind, ignored: Boolean(e.ignored), depth: 0, expanded: false, dir, at, length: q.length });
      }
    }
    const prefixFirst = (a, b) => (b.at === 0) - (a.at === 0);
    return rows.sort((a, b) => prefixFirst(a, b) || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
  }

  /** Le cartelle che contengono qualcosa di cambiato, dalle lettere git dei file. */
  function changedDirs(git) {
    const dirs = new Set();
    for (const rel of Object.keys(git || {})) {
      for (let i = rel.indexOf('/'); i > 0; i = rel.indexOf('/', i + 1)) dirs.add(rel.slice(0, i));
    }
    return dirs;
  }

  // Input di promptName ancora aperti → come chiuderli. Un render dell'albero
  // li toglie (replaceChildren) senza blur: la domanda si chiude con null,
  // invece di restare appesa per sempre.
  const openPrompts = new WeakMap();

  function createTreeView({
    root, document: doc, onOpenFile, onToggleDir, onContextMenu,
    onCopyInto = () => {}, onDeselect = () => {}, onRename = () => {}, onTrash = () => {}, onTypeToFilter = () => {},
  }) {
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
    // Solo il click che arriva sul vuoto della lista stessa (non su una riga,
    // un suo testo o un input aperto, che arrivano per bolla con un altro
    // bersaglio): toglie la selezione, così Ctrl+V torna a incollare nella
    // radice (docs/plans/61)
    list.addEventListener('click', (e) => { if (e.target === list) onDeselect(); });
    const selectedRow = () => shown.rows.find((r) => r.rel === shown.selected) || null;
    list.addEventListener('keydown', (e) => {
      const paste = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V');
      if (paste) {
        e.preventDefault();
        e.stopPropagation(); // non è l'incolla del terminale
        const row = selectedRow();
        onCopyInto(row ? dirOf(row) : '', { kind: 'paste' });
        return;
      }
      // Una lettera scritta con l'albero a fuoco apre il filtro (docs/plans/70)
      if (e.key && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onTypeToFilter(e.key);
        return;
      }
      // F2 rinomina, Canc (o Cmd+Backspace, sui Mac senza Canc) elimina
      const action = e.key === 'F2' ? onRename
        : e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey) ? onTrash : null;
      const row = action && selectedRow();
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      action(row);
    });

    function gitMark(r, git, dirs) {
      const mark = doc.createElement('span');
      const letter = r.kind === 'dir' ? (dirs.has(r.rel) ? '•' : '') : git[r.rel] || '';
      mark.className = 'editor-tree-git' + (letter ? (r.kind === 'dir' ? ' is-dir' : ` is-${letter}`) : '');
      mark.textContent = letter;
      if (letter && r.kind !== 'dir') mark.title = GIT_TITLES[letter] || '';
      return mark;
    }

    /** Il nome con la parte che corrisponde al filtro in evidenza: tre pezzi di testo. */
    function matchedName(r) {
      const name = doc.createElement('span');
      name.className = 'editor-tree-name';
      const piece = (text, cls) => {
        const n = doc.createElement('span');
        if (cls) n.className = cls;
        n.textContent = text; // testo, mai HTML: il nome viene dal disco
        name.appendChild(n);
      };
      piece(r.name.slice(0, r.at));
      piece(r.name.slice(r.at, r.at + r.length), 'editor-match');
      piece(r.name.slice(r.at + r.length));
      return name;
    }

    function rowElement(r, selected, git = {}, dirs = new Set()) {
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
      twisty.className = 'editor-tree-twisty'
        + (r.kind === 'dir' ? ` codicon codicon-chevron-${r.expanded ? 'down' : 'right'}` : '');
      const name = doc.createElement('span');
      name.className = 'editor-tree-name';
      name.textContent = r.name; // testo, mai HTML: il nome viene dal disco
      el.append(twisty, Icons.iconElement(doc, r.name, r.kind, r.expanded, 'editor-tree-icon'), name, gitMark(r, git, dirs));
      el.onclick = () => (r.kind === 'dir' ? onToggleDir(r.rel) : onOpenFile(r.rel));
      el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(r, e); };
      el.addEventListener('dragover', onDragOver(dirOf(r)));
      el.addEventListener('drop', onDrop(dirOf(r)));
      return el;
    }

    return {
      element: list,
      /** `git`: lettere per file ({rel: 'M'|'U'|'A'|'D'}); le cartelle col pallino si ricavano. */
      render(rows, selected, git = {}) {
        for (const child of [...list.children]) { const cancel = openPrompts.get(child); if (cancel) cancel(); }
        shown = { rows, selected };
        highlight(null);
        const dirs = changedDirs(git);
        list.replaceChildren(...rows.map((r) => rowElement(r, selected, git, dirs)));
      },
      /** Righe di filterRows: piatte, su due livelli (nome, cartella sotto), e la nota in fondo. */
      renderFiltered(rows, selected, git = {}) {
        for (const child of [...list.children]) { const cancel = openPrompts.get(child); if (cancel) cancel(); }
        shown = { rows, selected };
        highlight(null);
        const dirs = changedDirs(git);
        const note = (cls, text) => {
          const n = doc.createElement('div');
          n.className = cls;
          n.textContent = text;
          return n;
        };
        const els = rows.map((r) => {
          const el = doc.createElement('div');
          el.className = 'editor-tree-row is-flat' + (r.kind === 'dir' ? ' is-dir' : '') + (r.ignored ? ' is-ignored' : '')
            + (r.rel === selected ? ' is-selected' : '');
          el.dataset.rel = r.rel;
          el.setAttribute('role', 'treeitem');
          const top = doc.createElement('div');
          top.className = 'editor-tree-flat-top';
          top.append(Icons.iconElement(doc, r.name, r.kind, false, 'editor-tree-icon'), matchedName(r), gitMark(r, git, dirs));
          const dir = doc.createElement('div');
          dir.className = 'editor-tree-dir';
          dir.textContent = r.dir || '';
          el.append(top, dir);
          el.onclick = () => (r.kind === 'dir' ? onToggleDir(r.rel) : onOpenFile(r.rel));
          el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(r, e); };
          return el;
        });
        list.replaceChildren(
          ...(rows.length ? els : [note('editor-filter-empty', 'Nessun nome corrisponde.')]),
          note('editor-filter-note', 'Cerca nei nomi delle cartelle già lette. Per tutto il progetto usa Ctrl+P.'),
        );
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

  function menuItem(doc, item, close) {
    if (item.sep) {
      const sep = doc.createElement('div');
      sep.className = 'editor-menu-sep';
      sep.setAttribute('role', 'separator');
      return sep;
    }
    const b = doc.createElement('button');
    b.className = 'editor-menu-item' + (item.danger ? ' is-danger' : '') + (item.className ? ` ${item.className}` : '');
    b.setAttribute('role', 'menuitem');
    const icon = doc.createElement('span');
    icon.className = item.icon ? `codicon codicon-${item.icon}` : 'editor-menu-noicon';
    icon.setAttribute('aria-hidden', 'true');
    if (item.tint) icon.style.color = item.tint;
    const text = (cls, value) => {
      const span = doc.createElement('span');
      span.className = cls;
      span.textContent = value; // può contenere nomi di file
      b.appendChild(span);
    };
    b.appendChild(icon);
    text('editor-menu-label', item.label);
    if (item.detail) text('editor-menu-detail', item.detail);
    if (item.key) text('editor-menu-key', item.key);
    b.onclick = () => { close(); item.run(); };
    return b;
  }

  /**
   * Menu contestuale: si chiude su una scelta, su Esc e sul click fuori.
   * Voci `{ label, run, icon?, tint?, detail?, key?, danger?, className? }`
   * (icon: nome codicon senza prefisso) o `{ sep: true }`. `onClose` arriva
   * una volta, comunque si chiuda.
   */
  function showMenu({ document: doc, x, y, items, onClose = () => {} }) {
    const menu = doc.createElement('div');
    menu.className = 'editor-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const inside = (node) => { for (let n = node; n; n = n.parentNode) if (n === menu) return true; return false; };
    const onDown = (e) => { if (!inside(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    let open = true;
    function close() {
      if (!open) return;
      open = false;
      onClose();
      menu.remove();
      doc.removeEventListener('mousedown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
    }
    for (const item of items) menu.appendChild(menuItem(doc, item, close));
    doc.body.appendChild(menu);
    doc.addEventListener('mousedown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    return { element: menu, close };
  }

  return {
    emptyTree, setChildren, isExpanded, toggle, select, deselect, renamePath, removePath, visibleRows, filterRows, changedDirs,
    createTreeView, promptName, showMenu,
  };
});
