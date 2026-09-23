/* Colori dei tipi di sessione scelti dall'utente (menu View → Colori delle sessioni).
 *
 * I predefiniti restano in tokens.css (--type-shell, --type-claude, …): qui si
 * ricordano solo i colori CAMBIATI, e applicarli vuol dire scrivere la
 * variabile sullo stile di :root, che vince sul foglio. Togliere la variabile
 * riporta il predefinito, qualunque cosa dica tokens.css in futuro: nessuna
 * seconda copia della palette da tenere allineata.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessTypeColors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const STORAGE_KEY = 'aisess.typeColors';
  const HEX = /^#[0-9a-f]{6}$/i;

  const cssVar = (type) => '--type-' + type;

  /** Tiene solo tipi conosciuti con un colore #rrggbb; tutto il resto sparisce. */
  function normalize(raw, types) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(types
      .filter((t) => typeof src[t] === 'string' && HEX.test(src[t]))
      .map((t) => [t, src[t].toLowerCase()]));
  }

  /**
   * @param {Storage} storage localStorage, o un sostituto nei test
   * @param {string[]} types i tipi di sessione che si possono colorare
   */
  function createTypeColorStore(storage, types) {
    let overrides = {};
    try { overrides = normalize(JSON.parse(storage.getItem(STORAGE_KEY) || '{}'), types); } catch {}

    function save(next) {
      overrides = normalize(next, types);
      try {
        if (Object.keys(overrides).length) storage.setItem(STORAGE_KEY, JSON.stringify(overrides));
        else storage.removeItem(STORAGE_KEY);
      } catch {}
      return { ...overrides };
    }

    return {
      get: () => ({ ...overrides }),
      save,
      reset: () => save({}),
    };
  }

  /**
   * Scrive i colori cambiati su `style` (quello di :root) e toglie gli altri.
   * @param {{setProperty: Function, removeProperty: Function}} style
   */
  function applyTypeColors(style, overrides, types) {
    const valid = normalize(overrides, types);
    for (const t of types) {
      if (valid[t]) style.setProperty(cssVar(t), valid[t]);
      else style.removeProperty(cssVar(t));
    }
  }

  /** Il valore calcolato di una variabile in forma #rrggbb minuscola, come la vuole <input type="color">. */
  function toInputColor(value, fallback = '#000000') {
    const v = String(value || '').trim();
    if (HEX.test(v)) return v.toLowerCase();
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
    return short ? ('#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toLowerCase() : fallback;
  }

  return { STORAGE_KEY, cssVar, normalize, createTypeColorStore, applyTypeColors, toInputColor };
});
