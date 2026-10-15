/* Quale scheda editor apre un file del pannello modifiche (docs/plans/64).
 * Puro: riceve la radice del repository, il percorso del file come lo dà
 * git (relativo alla radice) e le schede nell'ordine della barra laterale.
 * Una scheda editor vale se la sua cartella contiene il file; se nessuna va
 * bene se ne apre una sulla radice. Separatori `/` e `\` insieme, e su
 * Windows maiuscole e minuscole uguali (regole Windows del CLAUDE.md).
 *
 * Wrapper UMD come editor-gutter.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorRoute = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // Nel renderer non c'è process.platform: Windows si riconosce dal navigator
  const pagePlatform = () => (typeof navigator !== 'undefined' && /^win/i.test(navigator.platform || '') ? 'win32' : 'posix');

  /* I pezzi di un percorso; null se non è una stringa piena o se risale con «..» */
  function pieces(p) {
    if (typeof p !== 'string' || !p) return null;
    const parts = p.split(/[\\/]+/).filter((s) => s && s !== '.');
    return parts.includes('..') ? null : parts;
  }

  const samePiece = (win) => (a, b) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);

  /* Il resto di `file` sotto `dir`; null se `dir` non lo contiene (un file non contiene sé stesso) */
  function under(dir, file, same) {
    if (dir.length >= file.length) return null;
    return dir.every((s, i) => same(s, file[i])) ? file.slice(dir.length) : null;
  }

  /**
   * @param {{repoRoot: string, file: string, tabs?: Array<{id: string, type: string, cwd: string}>,
   *   platform?: string}} o
   * @returns {{tabId: string, rel: string}|{cwd: string, rel: string}|null}
   */
  function editorTarget({ repoRoot, file, tabs = [], platform = pagePlatform() } = {}) {
    const rootParts = pieces(repoRoot);
    const relParts = pieces(file);
    if (!rootParts || !relParts || !relParts.length) return null;
    const full = [...rootParts, ...relParts];
    const same = samePiece(platform === 'win32');
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!tab || tab.type !== 'editor') continue;
      const dir = pieces(tab.cwd);
      const rest = dir && under(dir, full, same);
      if (rest) return { tabId: tab.id, rel: rest.join('/') };
    }
    return { cwd: repoRoot, rel: relParts.join('/') };
  }

  return { editorTarget };
});
