/* I limiti dichiarati dai CLI, normalizzati in due finestre: 5 ore e settimana.
 *
 * Codex spedisce `rate_limits` dentro gli eventi `token_count`, con due slot
 * (`primary`, `secondary`) il cui significato non e' fisso: quale sia la
 * finestra lo dice `window_minutes` (300 = 5 ore, 10080 = una settimana,
 * 43200 = un mese sui piani a credito). Si abbinano per durata, non per
 * posizione: su un account free il `primary` e' mensile, e leggerlo come
 * "5 ore" mostrerebbe un numero sbagliato.
 *
 * Quello che non e' dichiarato resta null: la barra nasconde la quota invece
 * di stimarla. Una percentuale inventata su un limite che fa sospendere il
 * lavoro e' peggio di nessuna percentuale.
 */
'use strict';

const FIVE_HOURS_MINUTES = 5 * 60;
const WEEK_MINUTES = 7 * 24 * 60;
/* Tolleranza larga: i CLI arrotondano (295, 300, 10079) e un domani potrebbero
   cambiare di poco la finestra senza cambiarne il senso. */
const TOLERANCE = 0.25;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function matchesWindow(minutes, target) {
  if (minutes === null) return false;
  return Math.abs(minutes - target) <= target * TOLERANCE;
}

/** Istante del reset in ms: i CLI usano epoch in secondi o un conto alla rovescia. */
function resetAt(slot, now) {
  const at = num(slot.resets_at);
  if (at) return at * 1000;
  const inSeconds = num(slot.resets_in_seconds);
  return inSeconds === null ? null : now + inSeconds * 1000;
}

function slotFor(raw, target, now) {
  const slots = [raw && raw.primary, raw && raw.secondary].filter((s) => s && typeof s === 'object');
  const slot = slots.find((s) => matchesWindow(num(s.window_minutes), target));
  if (!slot) return null;
  const usedPercent = num(slot.used_percent);
  if (usedPercent === null) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowMinutes: num(slot.window_minutes),
    resetsAt: resetAt(slot, now),
  };
}

/**
 * Le due finestre che interessano alla barra.
 * @param {object|null} raw payload `rate_limits` di Codex
 * @param {{ now?: number }} [opts]
 * @returns {{ fiveHour: object|null, weekly: object|null }}
 */
function parseRateLimits(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object') return { fiveHour: null, weekly: null };
  return {
    fiveHour: slotFor(raw, FIVE_HOURS_MINUTES, now),
    weekly: slotFor(raw, WEEK_MINUTES, now),
  };
}

module.exports = { parseRateLimits, FIVE_HOURS_MINUTES, WEEK_MINUTES };
