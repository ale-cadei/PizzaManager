/* Temi pronti per il dialogo «Colori» (menu View → Colori…): un colore
 * principale e uno per tipo di sessione, scelti per stare insieme sul fondo
 * scuro dell'app.
 *
 * Il primo, «Forno», è il predefinito di tokens.css: i suoi colori qui servono
 * solo a disegnare i campioni (un test li tiene allineati a tokens.css).
 * Sceglierlo non salva una copia della palette ma toglie ogni colore cambiato,
 * come «Ripristina predefiniti».
 *
 * Un tema è solo un punto di partenza: cliccato riempie i selettori, che si
 * possono ancora ritoccare uno per uno prima di salvare. Si salva come
 * qualunque altra scelta, colore per colore: nessun «tema attivo» da ricordare.
 *
 * Le varianti del principale (hover, ink, ring…) si ricavano in
 * type-colors.js come per un colore scelto a mano.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessColorThemes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const THEMES = Object.freeze([
    {
      id: 'forno', name: 'Forno (predefinito)', isDefault: true,
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
      id: 'ghiaccio', name: 'Ghiaccio',
      colors: { action: '#7fb8e6', shell: '#ebd98a', git: '#f08a6c', opencode: '#8fe3c4', claude: '#f5b98a', codex: '#9cc9ff', antigravity: '#d9a6f5' },
    },
  ].map((t) => Object.freeze({ ...t, colors: Object.freeze(t.colors) })));

  /** I colori del tema ristretti alle chiavi che il dialogo sa colorare. */
  function themeColors(theme, keys) {
    return Object.fromEntries(keys.filter((k) => k in theme.colors).map((k) => [k, theme.colors[k]]));
  }

  /** Ciò che sceglierlo salva: niente per il predefinito, che vive in tokens.css. */
  const themeOverrides = (theme, keys) => (theme.isDefault ? {} : themeColors(theme, keys));

  /** Il tema che corrisponde esattamente alla scelta, o null (ritoccata). Per il
   * predefinito un colore non cambiato vale quanto il suo. */
  function matchTheme(overrides, themes, keys) {
    const src = overrides || {};
    return themes.find((t) => {
      const colors = themeColors(t, keys);
      const used = keys.filter((k) => k in colors || k in src);
      return used.length > 0 && used.every((k) => {
        if (t.isDefault && !(k in src)) return true;
        return String(src[k] || '').toLowerCase() === colors[k];
      });
    }) || null;
  }

  return { THEMES, themeColors, themeOverrides, matchTheme };
});
