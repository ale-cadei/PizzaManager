/* Temi del dialogo «Colori» (menu View → Colori…): un colore principale e uno
 * per tipo di sessione, scelti per stare insieme sul fondo scuro dell'app.
 *
 * La scelta è uno stato `{ theme, custom }`: il tema in uso e, per ogni tema,
 * i soli colori ritoccati rispetto ai suoi. Un tema con ritocchi è
 * «personalizzato»; passare a un altro e tornare li ritrova (piano 41).
 * Le funzioni qui sono pure: ogni transizione restituisce uno stato nuovo.
 *
 * Il primo, «Forno», sono i colori di tokens.css: i suoi qui servono ai
 * campioni e ai selettori (un test li tiene allineati a tokens.css), ma su
 * :root si scrivono solo i suoi ritocchi, così tokens.css resta la fonte.
 *
 * Le varianti del principale (hover, ink, ring…) si ricavano in
 * type-colors.js come per un colore scelto a mano.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = root ? factory(root.AisessTypeColors) : factory(require('./type-colors'));
  if (root) root.AisessColorThemes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (TC) {
  const STORAGE_KEY = 'aisess.colorTheme';
  /** La scelta piatta del piano 39 (solo colori, senza tema): si migra. */
  const LEGACY_KEY = 'aisess.typeColors';
  const CUSTOM_SUFFIX = ' (personalizzato)';

  const THEMES = Object.freeze([
    {
      id: 'forno', name: 'Forno', isDefault: true,
      colors: { action: '#f04e23', shell: '#f2c14e', git: '#f1502f', opencode: '#4ade80', claude: '#ff9147', codex: '#5aa2ff', antigravity: '#ff6b6b' },
    },
    {
      id: 'mare', name: 'Mare di notte',
      colors: { action: '#2bb3c0', shell: '#f5d76e', git: '#ff7a59', opencode: '#7ee081', claude: '#ffb070', codex: '#6fa8ff', antigravity: '#f78fb3' },
    },
    {
      id: 'bosco', name: 'Bosco',
      colors: { action: '#5faf5a', shell: '#e8c468', git: '#d9734e', opencode: '#9be36d', claude: '#e8a15c', codex: '#6cb7d9', antigravity: '#c98bdb' },
    },
    {
      id: 'lavanda', name: 'Lavanda',
      colors: { action: '#9b7bff', shell: '#f2d16b', git: '#ff8a80', opencode: '#7fe0b0', claude: '#ffb38a', codex: '#8cb8ff', antigravity: '#f48fd0' },
    },
    {
      id: 'neon', name: 'Neon',
      colors: { action: '#ff2e88', shell: '#ffe14d', git: '#ff6b3d', opencode: '#39ff88', claude: '#ff9f1c', codex: '#00d1ff', antigravity: '#b266ff' },
    },
    {
      id: 'ambra', name: 'Ambra',
      colors: { action: '#e0a030', shell: '#f4d58d', git: '#e07a3f', opencode: '#a8d672', claude: '#f2a65a', codex: '#7fb3d5', antigravity: '#e57373' },
    },
    {
      // Grigi soli: i tipi si distinguono per chiarezza, dal più chiaro al più scuro.
      id: 'bianco-nero', name: 'Bianco e nero',
      colors: { action: '#e6e6e6', shell: '#d6d6d6', git: '#808080', opencode: '#adadad', claude: '#f2f2f2', codex: '#969696', antigravity: '#c4c4c4' },
    },
    {
      id: 'ghiaccio', name: 'Ghiaccio',
      colors: { action: '#7fb8e6', shell: '#ebd98a', git: '#f08a6c', opencode: '#8fe3c4', claude: '#f5b98a', codex: '#9cc9ff', antigravity: '#d9a6f5' },
    },
  ].map((t) => Object.freeze({ ...t, colors: Object.freeze(t.colors) })));

  /** I colori del tema ristretti alle chiavi che il dialogo sa colorare. */
  function themeColors(theme, keys) {
    return Object.fromEntries(keys.filter((k) => k in theme.colors).map((k) => [k, theme.colors[k]]));
  }

  const defaultTheme = (themes) => themes.find((t) => t.isDefault) || themes[0];
  const themeById = (themes, id) => themes.find((t) => t.id === id) || defaultTheme(themes);

  /** Toglie dai ritocchi i colori uguali a quelli del tema: non sono ritocchi. */
  function pruneCustom(theme, colors, keys) {
    return Object.fromEntries(Object.entries(TC.normalize(colors, keys)).filter(([k, v]) => v !== theme.colors[k]));
  }

  /** Lo stato di fabbrica: il primo tema, nessun ritocco. */
  const initialState = (themes) => ({ theme: defaultTheme(themes).id, custom: {} });

  /** Tiene solo temi conosciuti e colori validi; ciò che arriva dallo storage non è fidato. */
  function normalizeState(raw, themes, keys) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const customSrc = src.custom && typeof src.custom === 'object' ? src.custom : {};
    const custom = Object.fromEntries(themes
      .map((t) => [t.id, pruneCustom(t, customSrc[t.id], keys)])
      .filter(([, colors]) => Object.keys(colors).length > 0));
    return { theme: themeById(themes, src.theme).id, custom };
  }

  /** I ritocchi del tema in uso. */
  const customOf = (state) => state.custom[state.theme] || {};
  const isCustomized = (state, themeId = state.theme) => Object.keys(state.custom[themeId] || {}).length > 0;

  /** Tutti i colori di un tema coi suoi ritocchi: quelli dei selettori e dei campioni. */
  function palette(state, themes, keys, themeId = state.theme) {
    const theme = themeById(themes, themeId);
    return { ...themeColors(theme, keys), ...(state.custom[theme.id] || {}) };
  }

  /** Ciò che si scrive su :root: per il predefinito solo i ritocchi, tokens.css fa il resto. */
  function appliedColors(state, themes, keys) {
    return themeById(themes, state.theme).isDefault ? { ...customOf(state) } : palette(state, themes, keys);
  }

  /** Il nome sul pulsante: «Ghiaccio (personalizzato)» se il tema ha ritocchi. */
  const themeLabel = (state, theme) => theme.name + (isCustomized(state, theme.id) ? CUSTOM_SUFFIX : '');

  function withCustom(state, themeId, colors) {
    const { [themeId]: _old, ...rest } = state.custom;
    return { ...state, custom: Object.keys(colors).length ? { ...rest, [themeId]: colors } : rest };
  }

  const selectTheme = (state, themes, id) => ({ ...state, theme: themeById(themes, id).id });

  /** Ritocca un colore del tema in uso; riportato al valore del tema, smette di essere un ritocco. */
  function setColor(state, themes, keys, key, value) {
    const theme = themeById(themes, state.theme);
    return withCustom(state, theme.id, pruneCustom(theme, { ...customOf(state), [key]: value }, keys));
  }

  function resetColor(state, key) {
    const { [key]: _old, ...rest } = customOf(state);
    return withCustom(state, state.theme, rest);
  }

  const resetTheme = (state) => withCustom(state, state.theme, {});

  /**
   * La scelta piatta del piano 39 diventa il tema più vicino (meno colori
   * diversi; a pari merito vince il primo, Forno) con le differenze come ritocchi.
   * Un colore assente valeva il predefinito di tokens.css, cioè quello di Forno.
   */
  function fromLegacy(flat, themes, keys) {
    const base = defaultTheme(themes);
    const chosen = { ...themeColors(base, keys), ...TC.normalize(flat, keys) };
    const diff = (t) => pruneCustom(t, chosen, keys);
    const closest = themes.reduce((best, t) => (Object.keys(diff(t)).length < Object.keys(diff(best)).length ? t : best), base);
    return normalizeState({ theme: closest.id, custom: { [closest.id]: diff(closest) } }, themes, keys);
  }

  function readJson(storage, key) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /**
   * @param {Storage} storage localStorage, o un sostituto nei test
   * @param {string[]} keys TC.ACTION e i tipi di sessione che si possono colorare
   * @param {ReadonlyArray<{ id: string }>} themes
   */
  function createThemeStore(storage, keys, themes = THEMES) {
    const saved = readJson(storage, STORAGE_KEY);
    const legacy = saved ? null : readJson(storage, LEGACY_KEY);
    let state = saved ? normalizeState(saved, themes, keys)
      : legacy ? fromLegacy(legacy, themes, keys)
        : initialState(themes);

    function save(next) {
      state = normalizeState(next, themes, keys);
      const isFactory = state.theme === defaultTheme(themes).id && Object.keys(state.custom).length === 0;
      try {
        if (isFactory) storage.removeItem(STORAGE_KEY);
        else storage.setItem(STORAGE_KEY, JSON.stringify(state));
        storage.removeItem(LEGACY_KEY);
      } catch {}
      return get();
    }

    function get() {
      return { theme: state.theme, custom: { ...state.custom } };
    }

    return { get, save };
  }

  return {
    THEMES, STORAGE_KEY, LEGACY_KEY,
    themeColors, initialState, normalizeState, palette, appliedColors, themeLabel,
    isCustomized, customOf, selectTheme, setColor, resetColor, resetTheme, fromLegacy, createThemeStore,
  };
});
