/* Sidebar collassabile (docs/plans/72-sidebar-collassabile.md).
 *
 * Il modulo tiene solo lo stato: mette `.collapsed` su #sidebar, aggiorna il
 * tasto e lo ricorda. Che cosa resta visibile da collassata (icone, barrette,
 * pallini) lo decide la CSS sotto `#sidebar.collapsed`: le card non sanno di
 * essere strette, quindi segnali e selezione restano gli stessi.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina e module.exports sotto
 * Node, per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessSidebarCollapse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const STORAGE_KEY = 'aisess.sidebarCollapsed';
  const COLLAPSE_TITLE = 'Comprimi la sidebar';
  const EXPAND_TITLE = 'Espandi la sidebar';

  function readSaved(storage) {
    try { return storage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  }

  /**
   * @param {{sidebar: Element, toggle: Element, searchButton?: Element,
   *   searchInput?: Element, storage: Storage,
   *   onChange?: (collapsed: boolean) => void}} opts
   */
  function createSidebarCollapse({ sidebar, toggle, searchButton, searchInput, storage, onChange }) {
    let collapsed = readSaved(storage);

    function paint() {
      sidebar.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = collapsed ? EXPAND_TITLE : COLLAPSE_TITLE;
    }

    function setCollapsed(next) {
      const value = Boolean(next);
      if (value === collapsed) return;
      collapsed = value;
      try { storage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
      paint();
      if (onChange) onChange(collapsed);
    }

    toggle.addEventListener('click', () => setCollapsed(!collapsed));
    // La lente è la ricerca vista da collassata: per scrivere serve spazio,
    // quindi riapre la sidebar e porta il cursore nella casella.
    if (searchButton) searchButton.addEventListener('click', () => {
      setCollapsed(false);
      if (searchInput) searchInput.focus();
    });
    paint();

    return {
      isCollapsed: () => collapsed,
      setCollapsed,
      toggle: () => setCollapsed(!collapsed),
    };
  }

  return { createSidebarCollapse, STORAGE_KEY };
});
