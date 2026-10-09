/* Notifiche di sistema, lato renderer (docs/plans/38).
 *
 * Il main mostra la notifica (app/notify.js); qui la preferenza accese/spente,
 * ricordata in localStorage, e la voce che descrive la scheda che ha finito.
 * Solo nomi già visibili in sidebar: mai output del terminale.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessNotify = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const STORAGE_KEY = 'aisess.notifications';
  const ON = '1';
  const OFF = '0';

  /** @param {Storage} storage localStorage, o un sostituto nei test */
  function createNotifyStore(storage) {
    let enabled = true;
    // Solo uno «0» esplicito le spegne: qualsiasi altra cosa è il default
    try { enabled = storage.getItem(STORAGE_KEY) !== OFF; } catch {}

    return {
      get: () => enabled,
      toggle() {
        enabled = !enabled;
        try { storage.setItem(STORAGE_KEY, enabled ? ON : OFF); } catch {}
        return enabled;
      },
    };
  }

  /**
   * @param {{id: string, type: string, name?: string, cwd?: string}} tab
   * @param {{typeLabels: Record<string, string>, shortPath: (cwd: string) => string}} helpers
   */
  function notifyItem(tab, { typeLabels, shortPath }) {
    return {
      id: tab.id,
      name: tab.name || '',
      typeLabel: typeLabels[tab.type] || tab.type,
      where: tab.cwd ? shortPath(tab.cwd) || '' : '',
      kind: tab.attentionKind === 'permission' ? 'permission' : 'done',
    };
  }

  /** Quante card sono accese: il numero sul badge del Dock. */
  function attentionCount(tabs) {
    let n = 0;
    for (const t of tabs) if (t.needsAttention) n += 1;
    return n;
  }

  return { createNotifyStore, notifyItem, attentionCount, STORAGE_KEY };
});
