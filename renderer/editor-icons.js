/* Icone dei file nell'albero e negli «Aperti» della scheda editor
 * (docs/plans/70, SPEC §0): una classe di @vscode/codicons e una tinta. Le
 * tinte hanno la stessa luminosità e saturazione e cambiano solo nella
 * tonalità: non sono colori di stato.
 *
 * Wrapper UMD come editor-tree.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorIcons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const DIM = 'var(--text-dim)';
  const FOLDER_TINT = 'color-mix(in srgb, var(--type-editor) 75%, var(--text-dim))';
  const CODE = { cls: 'codicon-file-code', tint: 'oklch(0.82 0.11 90)' };
  const BY_EXT = {
    js: CODE, mjs: CODE, cjs: CODE, ts: CODE,
    css: { cls: 'codicon-symbol-color', tint: 'oklch(0.78 0.11 245)' },
    html: { cls: 'codicon-code', tint: 'oklch(0.76 0.12 40)' },
    md: { cls: 'codicon-markdown', tint: 'oklch(0.78 0.10 300)' },
    json: { cls: 'codicon-json', tint: 'oklch(0.80 0.11 145)' },
  };
  const BY_NAME = { '.gitignore': { cls: 'codicon-git-commit', tint: DIM } };
  const OTHER = { cls: 'codicon-file', tint: DIM };

  /** L'estensione in minuscolo; '' senza, o se il punto è solo all'inizio (.js, .env). */
  const extOf = (name) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  };

  /**
   * @param {string} name nome del file o della cartella, senza percorso
   * @param {'file'|'dir'} kind
   * @param {boolean} [open] solo per le cartelle: aperta nell'albero
   * @returns {{cls: string, tint: string}} classe codicon e colore CSS
   */
  function iconFor(name, kind, open = false) {
    if (kind === 'dir') return { cls: open ? 'codicon-folder-opened' : 'codicon-folder', tint: FOLDER_TINT };
    return BY_NAME[name] || BY_EXT[extOf(name)] || OTHER;
  }

  /** Lo <span> dell'icona, già tinto. */
  function iconElement(doc, name, kind, open = false, className = 'editor-file-icon') {
    const { cls, tint } = iconFor(name, kind, open);
    const span = doc.createElement('span');
    span.className = `${className} codicon ${cls}`;
    span.style.color = tint;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  return { iconFor, iconElement };
});
