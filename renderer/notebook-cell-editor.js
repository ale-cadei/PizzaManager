/* L'editor di una cella del notebook (docs/plans/78): un Monaco piccolo,
 * senza numeri di riga né minimappa, alto quanto il suo testo, dentro la
 * cella. Il testo non è un file: il model è in memoria e se ne va con
 * l'editor; chi lo usa riceve ogni modifica (`onChange`) e i tasti che
 * escono dalla cella come nomi (`onKey`).
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessNotebookCellEditor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const KEYS = Object.freeze({ ESCAPE: 'escape', NEXT: 'next', RUN: 'run', SAVE: 'save' });
  // Esc lascia prima a Monaco i suoi usi: chiudere suggerimenti, ricerca, fumetti
  const ESCAPE_WHEN = '!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !inSnippetMode';

  const known = (monaco, language) => monaco.languages.getLanguages().some((l) => l.id === language);

  function cellKeys(monaco, editor, onKey) {
    const { KeyMod, KeyCode } = monaco;
    const bind = (key, keybindings, precondition) => editor.addAction({
      id: `aisess.nb.${key}`, label: key, keybindings, precondition, run: () => onKey(key),
    });
    bind(KEYS.ESCAPE, [KeyCode.Escape], ESCAPE_WHEN);
    bind(KEYS.NEXT, [KeyMod.Shift | KeyCode.Enter]);
    bind(KEYS.RUN, [KeyMod.CtrlCmd | KeyCode.Enter]);
    bind(KEYS.SAVE, [KeyMod.CtrlCmd | KeyCode.KeyS]);
  }

  /**
   * @param {{monaco: object, node: {style: object}, text: string, language: string,
   *   fontSize: number, theme: string, font: string,
   *   onChange: (text: string) => void, onKey: (key: string) => void}} o
   * @returns {{focus: () => void, getValue: () => string, dispose: () => void}}
   */
  function createCellEditor({ monaco, node, text, language, fontSize, theme, font, onChange, onKey }) {
    const model = monaco.editor.createModel(text, known(monaco, language) ? language : 'plaintext');
    const editor = monaco.editor.create(node, {
      model, theme, fontSize, fontFamily: font, automaticLayout: true,
      lineNumbers: 'off', glyphMargin: false, folding: false, lineDecorationsWidth: 8,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'none',
      overviewRulerLanes: 0, hideCursorInOverviewRuler: true, wordWrap: 'on',
      padding: { top: 6, bottom: 6 },
      // Alta quanto il testo: niente barra verticale, la rotella scorre il notebook
      scrollbar: { vertical: 'hidden', alwaysConsumeMouseWheel: false },
    });
    const fit = () => {
      node.style.height = `${editor.getContentHeight()}px`;
      editor.layout();
    };
    editor.onDidContentSizeChange(fit);
    fit();
    model.onDidChangeContent(() => onChange(model.getValue()));
    cellKeys(monaco, editor, onKey);
    return {
      focus: () => editor.focus(),
      getValue: () => model.getValue(),
      dispose() {
        editor.dispose();
        model.dispose();
      },
    };
  }

  return { createCellEditor, KEYS };
});
