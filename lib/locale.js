/* Locale UTF-8 per i processi nei terminali.
 *
 * Un'app avviata dal Finder, da Launchpad o da un menu non eredita la shell
 * dell'utente e quindi non ha LANG: zsh e i tool partirebbero in locale C,
 * dove ogni carattere non ASCII (è, →, i glifi dei prompt) diventa un `_`.
 * Da `npm start` non si vede, perché la shell di sviluppo lo passa: è il bug
 * che compare solo nell'app installata.
 *
 * Se l'ambiente ha già una locale UTF-8 (LANG, LC_ALL o LC_CTYPE) non si
 * tocca niente. Altrimenti si sceglie la lingua di sistema in UTF-8, se
 * esiste sulla macchina, poi en_US.UTF-8, poi C.UTF-8.
 *
 * Modulo puro: `available` (l'elenco di `locale -a`) e `systemLocale` sono
 * iniettabili; il default interroga `locale -a` una volta sola. */
'use strict';
const { execFileSync } = require('child_process');

const FALLBACKS = ['en_US.UTF-8', 'C.UTF-8'];
const LOCALE_TIMEOUT_MS = 2000;

let cachedAvailable = null;
/** Nomi di locale installati (`locale -a`), letti una volta. */
function availableLocales() {
  if (cachedAvailable) return cachedAvailable;
  const out = execFileSync('locale', ['-a'], { encoding: 'utf8', timeout: LOCALE_TIMEOUT_MS });
  cachedAvailable = out.split('\n').map((s) => s.trim()).filter(Boolean);
  return cachedAvailable;
}

const isUtf8 = (v) => /utf-?8/i.test(String(v || ''));

/* Regione di default per le lingue senza regione (`it` da solo non esiste
   come locale POSIX). */
const DEFAULT_REGION = { en: 'US', it: 'IT', fr: 'FR', de: 'DE', es: 'ES', pt: 'BR', nl: 'NL', ja: 'JP', zh: 'CN', ru: 'RU' };

/** `it-IT` (Electron/Intl) → `it_IT.UTF-8` (POSIX); null se non è una lingua. */
function localeName(systemLocale) {
  const m = /^([a-z]{2,3})(?:[-_]([A-Za-z]{2}))?/.exec(String(systemLocale || ''));
  if (!m) return null;
  const lang = m[1].toLowerCase();
  const region = (m[2] || DEFAULT_REGION[lang] || lang).toUpperCase();
  return `${lang}_${region}.UTF-8`;
}

/**
 * @param {object} env ambiente di partenza (non viene mutato)
 * @param {{ platform?: string, systemLocale?: string, available?: () => string[] }} [opts]
 * @returns {object} copia di `env`, con LANG impostato se mancava una locale UTF-8
 */
function ensureUtf8Locale(env, { platform = process.platform, systemLocale = intlLocale(), available = availableLocales } = {}) {
  const base = { ...env };
  if (platform === 'win32') return base;
  if (isUtf8(base.LC_ALL) || isUtf8(base.LC_CTYPE) || isUtf8(base.LANG)) return base;
  let installed;
  try { installed = new Set(available().map((s) => s.toLowerCase())); } catch { installed = null; }
  const candidates = [localeName(systemLocale), ...FALLBACKS].filter(Boolean);
  // Senza `locale -a` non si può verificare: en_US.UTF-8 c'è praticamente ovunque
  const chosen = installed ? candidates.find((c) => installed.has(c.toLowerCase())) : FALLBACKS[0];
  return chosen ? { ...base, LANG: chosen } : base;
}

function intlLocale() {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ''; }
}

module.exports = { ensureUtf8Locale, localeName, availableLocales };
