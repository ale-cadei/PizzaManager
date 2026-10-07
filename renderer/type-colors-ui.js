/* Dialogo «Colori»: sopra i temi (type-color-themes.js), sotto un selettore per
 * il colore principale e uno per tipo di sessione, anteprima dal vivo.
 *
 * Cliccare un tema riempie i selettori coi suoi colori, compresi i ritocchi
 * che gli si erano fatti. Ritoccare un colore personalizza il tema in uso: il
 * pulsante diventa «Ghiaccio (personalizzato)», la riga ritoccata mostra il
 * suo «Ripristina» e in fondo compare «Ripristina colori predefiniti», che
 * toglie i ritocchi del solo tema in uso.
 *
 * Ogni ritocco si applica subito a :root, quindi pulsanti, card, linguette,
 * legenda e lampeggio cambiano mentre si sceglie. `onChange` avvisa chi i
 * colori non li legge dal CSS (il tema di xterm). «Annulla» (o Esc, o click
 * fuori) rimette la scelta salvata. Lo stato e le sue transizioni stanno in
 * type-color-themes.js; qui solo il DOM.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = root
    ? factory(root.AisessTypeColors, root.AisessColorThemes)
    : factory(require('./type-colors'), require('./type-color-themes'));
  if (root) root.AisessTypeColorsUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (TC, Themes) {
  /**
   * @param {{ doc: Document, backdrop: HTMLElement, list: HTMLElement,
   *   saveBtn: HTMLElement, cancelBtn: HTMLElement, resetBtn: HTMLElement,
   *   store: ReturnType<Themes['createThemeStore']>, types: string[],
   *   labels: Record<string, string>, style: CSSStyleDeclaration,
   *   onChange?: () => void, themesEl?: HTMLElement,
   *   themes?: ReadonlyArray<{ id: string, name: string, colors: Record<string, string> }> }} opts
   */
  function createTypeColorsDialog({ doc, backdrop, list, saveBtn, cancelBtn, resetBtn, store, types, labels, style, onChange = () => {}, themesEl = null, themes = Themes.THEMES }) {
    let draft = Themes.initialState(themes);
    let rows = {};
    let chips = [];
    let isOpen = false;

    function fillSwatches(el, colors) {
      el.innerHTML = '';
      for (const t of types) {
        if (!colors[t]) continue;
        const sw = doc.createElement('span');
        sw.className = 'color-theme-swatch';
        sw.style.background = colors[t];
        el.appendChild(sw);
      }
    }

    /** Riallinea selettori, pulsanti dei temi e ripristini allo stato in corso. */
    function render() {
      const colors = Themes.palette(draft, themes, types);
      const custom = Themes.customOf(draft);
      for (const t of types) {
        rows[t].input.value = colors[t];
        rows[t].reset.hidden = !(t in custom);
      }
      for (const { theme, btn, swatches, name } of chips) {
        btn.setAttribute('aria-pressed', String(theme.id === draft.theme));
        name.textContent = Themes.themeLabel(draft, theme);
        fillSwatches(swatches, Themes.palette(draft, themes, types, theme.id));
      }
      resetBtn.hidden = !Themes.isCustomized(draft);
    }

    function update(next) {
      draft = next;
      TC.applyTypeColors(style, Themes.appliedColors(draft, themes, types), types);
      onChange();
      render();
    }

    function buildRow(t) {
      const row = doc.createElement('div');
      row.className = 'type-color-row type-color-row--' + t;
      const dot = doc.createElement('span');
      dot.className = 'dot ' + t;
      const name = doc.createElement('label');
      name.className = 'type-color-name';
      name.textContent = labels[t] || t;
      name.htmlFor = 'type-color-' + t;
      const reset = doc.createElement('button');
      reset.type = 'button';
      reset.className = 'btn btn--ghost type-color-reset';
      reset.textContent = 'Ripristina';
      reset.title = 'Ripristina il colore predefinito del tema';
      const input = doc.createElement('input');
      input.type = 'color';
      input.id = 'type-color-' + t;
      input.addEventListener('input', () => update(Themes.setColor(draft, themes, types, t, input.value)));
      // il pulsante sparisce: il fuoco passa al selettore, non si perde sul body
      reset.addEventListener('click', () => { update(Themes.resetColor(draft, t)); input.focus(); });
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(reset);
      row.appendChild(input);
      rows = { ...rows, [t]: { input, reset } };
      return row;
    }

    function buildThemeChip(theme) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'color-theme';
      const swatches = doc.createElement('span');
      swatches.className = 'color-theme-swatches';
      const name = doc.createElement('span');
      name.className = 'color-theme-name';
      btn.appendChild(swatches);
      btn.appendChild(name);
      btn.addEventListener('click', () => update(Themes.selectTheme(draft, themes, theme.id)));
      chips = [...chips, { theme, btn, swatches, name }];
      return btn;
    }

    function close(state) {
      if (!isOpen) return;
      isOpen = false;
      TC.applyTypeColors(style, Themes.appliedColors(state, themes, types), types);
      onChange();
      backdrop.hidden = true;
      doc.removeEventListener('keydown', onKey);
    }

    const onKey = (e) => { if (e.key === 'Escape') close(store.get()); };
    const onSave = () => close(store.save(draft));
    const onCancel = () => close(store.get());
    const onBackdrop = (e) => { if (e.target === backdrop) close(store.get()); };
    const onReset = () => {
      update(Themes.resetTheme(draft));
      const active = chips.find((c) => c.theme.id === draft.theme);
      if (active) active.btn.focus();
    };

    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
    resetBtn.addEventListener('click', onReset);
    backdrop.addEventListener('click', onBackdrop);

    function open() {
      if (isOpen) return;
      isOpen = true;
      draft = store.get();
      rows = {};
      list.innerHTML = '';
      for (const t of types) list.appendChild(buildRow(t));
      chips = [];
      if (themesEl) {
        themesEl.innerHTML = '';
        for (const theme of themes) themesEl.appendChild(buildThemeChip(theme));
        themesEl.hidden = themes.length === 0;
      }
      render();
      backdrop.hidden = false;
      doc.addEventListener('keydown', onKey);
    }

    return { open, isOpen: () => isOpen };
  }

  return { createTypeColorsDialog };
});
