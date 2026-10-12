/* Impostazioni degli animaletti (docs/plans/33-animaletti.md): accesi o no,
 * chi c'è, quanto sono grandi e veloci. Ricordate in localStorage come la
 * dimensione del testo (term-font.js).
 *
 * Quello che si legge dallo storage è input esterno: un campo che non torna
 * si rimette al default, una voce sconosciuta si scarta.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = factory(root ? root.AisessPetsSprites : require('./pets-sprites'));
  if (root) root.AisessPetsConfig = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Sprites) {
  const STORAGE_KEY = 'aisess.pets';
  /** Altezza di riferimento in pixel (un personaggio alto GRID righe). */
  const SIZES = { s: 24, m: 32, l: 48 };
  const SPEEDS = { lenta: 0.5, normale: 1, veloce: 1.8 };
  /** Voci del dialogo: quante sono in Sprites.CAST. */
  const MAX_CAST = 18;
  const DEFAULTS = Object.freeze({ enabled: false, cast: Object.freeze(['pizza']), size: 'm', speed: 'normale' });

  const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
  /** Voci note, nell'ordine dato, fino a MAX_CAST. */
  function sanitizeCast(raw) {
    if (!Array.isArray(raw)) return [...DEFAULTS.cast];
    return raw.filter((id) => has(Sprites.CAST, id)).slice(0, MAX_CAST);
  }

  function parse(raw) {
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }

  /** @returns {{enabled: boolean, cast: string[], size: string, speed: string}} */
  function sanitizeConfig(raw) {
    const obj = parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...DEFAULTS, cast: [...DEFAULTS.cast] };
    return {
      enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULTS.enabled,
      cast: sanitizeCast(obj.cast === undefined ? DEFAULTS.cast : obj.cast),
      size: has(SIZES, obj.size) ? obj.size : DEFAULTS.size,
      speed: has(SPEEDS, obj.speed) ? obj.speed : DEFAULTS.speed,
    };
  }

  /** @param {Storage} storage localStorage, o un sostituto nei test */
  function createPetsStore(storage) {
    let config = sanitizeConfig(null);
    try { config = sanitizeConfig(storage.getItem(STORAGE_KEY)); } catch {}

    function save(next) {
      config = sanitizeConfig({ ...config, ...next });
      try { storage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
      return config;
    }

    return { get: () => config, save };
  }

  return { STORAGE_KEY, SIZES, SPEEDS, MAX_CAST, DEFAULTS, sanitizeConfig, createPetsStore };
});
