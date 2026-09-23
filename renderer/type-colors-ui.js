/* Dialogo «Colori»: un selettore per il colore principale e uno per tipo di
 * sessione, anteprima dal vivo.
 *
 * Ogni ritocco si applica subito a :root, quindi pulsanti, card, linguette,
 * legenda e lampeggio cambiano mentre si sceglie. `onChange` avvisa chi i
 * colori non li legge dal CSS (il tema di xterm). «Annulla» (o Esc, o click fuori)
 * rimette i colori salvati; «Ripristina predefiniti» torna a tokens.css.
 * La logica pura sta in type-colors.js; qui solo il DOM.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = factory(root ? root.AisessTypeColors : require('./type-colors'));
  if (root) root.AisessTypeColorsUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (TC) {
  /**
   * @param {{ doc: Document, backdrop: HTMLElement, list: HTMLElement,
   *   saveBtn: HTMLElement, cancelBtn: HTMLElement, resetBtn: HTMLElement,
   *   store: ReturnType<TC['createTypeColorStore']>, types: string[],
   *   labels: Record<string, string>, style: CSSStyleDeclaration,
   *   readVar: (name: string) => string, onChange?: () => void }} opts
   */
  function createTypeColorsDialog({ doc, backdrop, list, saveBtn, cancelBtn, resetBtn, store, types, labels, style, readVar, onChange = () => {} }) {
    let draft = {};
    let inputs = {};
    let isOpen = false;

    const apply = (overrides) => {
      TC.applyTypeColors(style, overrides, types);
      onChange();
    };
    const current = (t) => TC.toInputColor(readVar(TC.cssVar(t)));

    function buildRow(t) {
      const row = doc.createElement('label');
      row.className = 'type-color-row type-color-row--' + t;
      const dot = doc.createElement('span');
      dot.className = 'dot ' + t;
      const name = doc.createElement('span');
      name.className = 'type-color-name';
      name.textContent = labels[t] || t;
      const input = doc.createElement('input');
      input.type = 'color';
      input.value = current(t);
      input.addEventListener('input', () => {
        draft = { ...draft, [t]: input.value };
        apply(draft);
      });
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(input);
      inputs = { ...inputs, [t]: input };
      return row;
    }

    function close(overrides) {
      if (!isOpen) return;
      isOpen = false;
      apply(overrides);
      backdrop.hidden = true;
      doc.removeEventListener('keydown', onKey);
    }

    const onKey = (e) => { if (e.key === 'Escape') close(store.get()); };
    const onSave = () => close(store.save(draft));
    const onCancel = () => close(store.get());
    const onBackdrop = (e) => { if (e.target === backdrop) close(store.get()); };
    const onReset = () => {
      draft = {};
      apply(draft);
      for (const t of types) inputs[t].value = current(t);
    };

    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
    resetBtn.addEventListener('click', onReset);
    backdrop.addEventListener('click', onBackdrop);

    function open() {
      if (isOpen) return;
      isOpen = true;
      draft = store.get();
      inputs = {};
      list.innerHTML = '';
      for (const t of types) list.appendChild(buildRow(t));
      backdrop.hidden = false;
      doc.addEventListener('keydown', onKey);
    }

    return { open, isOpen: () => isOpen };
  }

  return { createTypeColorsDialog };
});
