/* Colori scelti dall'utente (menu View → Colori…): il colore principale
 * dell'app e quello di ogni tipo di sessione. Quali colori, e come si
 * ricordano per tema, lo decide type-color-themes.js.
 *
 * I predefiniti restano in tokens.css (--action, --type-shell, …): qui si
 * applicano solo i colori CAMBIATI, e applicarli vuol dire scrivere la
 * variabile sullo stile di :root, che vince sul foglio. Togliere la variabile
 * riporta il predefinito, qualunque cosa dica tokens.css in futuro: nessuna
 * seconda copia della palette da tenere allineata.
 *
 * Il colore principale non è una variabile sola: pulsanti, chip e focus usano
 * anche le sue varianti (--action-hover, -soft, -text, -ink, -ring). Chi ne
 * sceglie uno ne sceglie uno solo, le varianti si ricavano qui con gli stessi
 * rapporti che hanno i predefiniti col pomodoro.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessTypeColors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const HEX = /^#[0-9a-f]{6}$/i;
  /** La chiave del colore principale, accanto a quelle dei tipi. */
  const ACTION = 'action';
  const ACTION_VARS = ['--action', '--action-hover', '--action-soft', '--action-text', '--action-ink', '--action-ring'];

  // Le superfici su cui si mescolano le varianti (tokens.css: --bg, --text).
  const BG = '#070505';
  const TEXT = '#F6F1EC';
  const WHITE = '#ffffff';
  const BLACK = '#000000';

  const cssVar = (key) => (key === ACTION ? '--action' : '--type-' + key);

  const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  /** `amount` di `a` dentro `b`, come color-mix(in srgb, a amount, b). */
  const mix = (a, b, amount) => {
    const [x, y] = [toRgb(a), toRgb(b)];
    return toHex(x.map((c, i) => c * amount + y[i] * (1 - amount)));
  };

  /** Luminanza relativa WCAG. */
  function luminance(hex) {
    const lin = toRgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  };

  /**
   * Le variabili del colore principale ricavate da uno solo. L'inchiostro (il
   * testo sopra il pieno) è scuro come quello predefinito finché si legge; su
   * un principale scuro passa al testo chiaro, o il pulsante primario diventa
   * una macchia senza scritta.
   */
  function actionVars(hex) {
    const c = hex.toLowerCase();
    const darkInk = mix(c, BLACK, 0.1);
    const [r, g, b] = toRgb(c);
    return {
      '--action': c,
      '--action-hover': mix(c, WHITE, 0.8),
      '--action-soft': mix(c, BG, 0.15),
      '--action-text': mix(c, WHITE, 0.6),
      '--action-ink': contrast(c, darkInk) >= contrast(c, TEXT) ? darkInk : TEXT.toLowerCase(),
      '--action-ring': `rgba(${r},${g},${b},0.22)`,
    };
  }

  /** Tiene solo chiavi conosciute con un colore #rrggbb; tutto il resto sparisce. */
  function normalize(raw, keys) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(keys
      .filter((k) => typeof src[k] === 'string' && HEX.test(src[k]))
      .map((k) => [k, src[k].toLowerCase()]));
  }

  /**
   * Scrive i colori cambiati su `style` (quello di :root) e toglie gli altri.
   * @param {{setProperty: Function, removeProperty: Function}} style
   */
  function applyTypeColors(style, overrides, keys) {
    const valid = normalize(overrides, keys);
    for (const k of keys) {
      if (k === ACTION) {
        const vars = valid[k] ? actionVars(valid[k]) : null;
        for (const name of ACTION_VARS) {
          if (vars) style.setProperty(name, vars[name]);
          else style.removeProperty(name);
        }
      } else if (valid[k]) style.setProperty(cssVar(k), valid[k]);
      else style.removeProperty(cssVar(k));
    }
  }

  return { ACTION, ACTION_VARS, cssVar, normalize, actionVars, contrast, applyTypeColors };
});
