/* La sotto-sezione di un worktree dentro il gruppo del suo progetto, nella
 * sidebar (docs/plans/36-sessione-worktree.md):
 *
 *   ⑂ feat/scorciatoie   da main   +120 −30   [+] [⋯]
 *      ▸ Claude · scorciatoie ⌘T
 *
 * I numeri sono le righe toccate rispetto alla base (docs/plans/32), letti
 * da changes-cache.js; un worktree pulito non ne mostra.
 *
 * Le card le crea la sidebar (`fill`), che sa disegnarle e trascinarle; qui
 * si costruisce la riga e il contenitore. Tutto con textContent: il nome di
 * un branch lo sceglie chi lo crea, e git ammette anche `<` e `>`.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina e module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessWorktreeSection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const GLYPH = '⑂';
  const lastSegment = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).pop() || String(p || '');

  function span(doc, cls, text) {
    const s = doc.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function button(doc, cls, text, title, onClick) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    // Il click non deve arrivare alla linguetta del gruppo e collassarlo
    b.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); onClick(b); };
    return b;
  }

  function changesBadge(doc, changes, base) {
    const badge = doc.createElement('span');
    badge.className = 'worktree-changes';
    badge.appendChild(span(doc, 'worktree-added', `+${changes.added}`));
    badge.appendChild(span(doc, 'worktree-removed', `−${changes.removed}`));
    const files = changes.files === 1 ? '1 file cambiato' : `${changes.files} file cambiati`;
    badge.title = base ? `${files} rispetto a ${base}` : `${files} rispetto all'ultimo commit`;
    return badge;
  }

  /**
   * @param {{doc: Document, worktree: {path: string, branch: string|null, base: string|null},
   *   changes?: {files: number, added: number, removed: number}|null,
   *   onNew?: (() => void)|null, onMenu?: ((el: Element) => void)|null,
   *   fill: (body: Element) => number}} o
   *   `fill` mette le card nel corpo e dice quante sono
   * @returns {Element}
   */
  function createSection({ doc, worktree, changes = null, onNew = null, onMenu = null, fill }) {
    const name = worktree.branch || lastSegment(worktree.path);
    const section = doc.createElement('div');
    section.className = 'worktree-section';
    section.dataset.path = worktree.path;

    const row = doc.createElement('div');
    row.className = 'worktree-row';
    row.title = worktree.path;
    const glyph = span(doc, 'worktree-glyph', GLYPH);
    glyph.setAttribute('aria-hidden', 'true');
    row.appendChild(glyph);
    row.appendChild(span(doc, 'worktree-branch', name));
    if (worktree.base) row.appendChild(span(doc, 'worktree-base', `da ${worktree.base}`));
    if (changes && changes.files > 0) row.appendChild(changesBadge(doc, changes, worktree.base));
    if (onNew) row.appendChild(button(doc, 'worktree-add', '+', `Nuova sessione nel worktree ${name}`, () => onNew()));
    if (onMenu) {
      const menu = button(doc, 'worktree-menu', '⋯', `Unisci, tieni il branch o butta ${name}`, (el) => onMenu(el));
      // Il fumetto del menu si ritrova da qui dopo un render (session-list.js, findAnchor)
      menu.dataset.path = worktree.path;
      row.appendChild(menu);
    }
    section.appendChild(row);

    const body = doc.createElement('div');
    body.className = 'worktree-body';
    // Vuoto resta visibile: è da qui che lo si unisce o lo si butta
    if (!fill(body)) body.appendChild(span(doc, 'worktree-empty', 'nessuna sessione'));
    section.appendChild(body);
    return section;
  }

  return { createSection, GLYPH };
});
