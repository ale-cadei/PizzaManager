'use strict';

/**
 * Notifiche di sistema quando una sessione ha finito (docs/plans/38).
 *
 * Il «quando ha finito» non si decide qui: lo decide il renderer, la card che
 * si accende (renderer/attention.js). Qui solo se la notifica va mostrata,
 * con che testo, e il raggruppamento di più sessioni che finiscono insieme.
 * Logica pura: Electron e i timer li passa chi chiama (app/notify.js).
 */

/** Dove le notifiche sono state provate. Windows dopo, con un piano suo. */
const SUPPORTED_PLATFORMS = ['darwin', 'linux'];
/** Sessioni che finiscono entro questa finestra diventano una notifica sola. */
const COALESCE_MS = 1500;
/** Lunghezza massima di nome, tipo e percorso che arrivano dal renderer. */
const MAX_FIELD = 80;
/** Lunghezza massima del corpo: i centri notifiche tagliano comunque. */
const MAX_BODY = 160;
const SEPARATOR = ' · ';
const DEFAULT_TYPE_LABEL = 'Sessione';

function isPlatformSupported(platform = process.platform) {
  return SUPPORTED_PLATFORMS.includes(platform);
}

/** La finestra davanti basta il lampeggio: la notifica è per chi è altrove. */
function shouldNotify({ enabled = false, focused = true, supported = false } = {}) {
  return Boolean(enabled && supported && !focused);
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function cleanText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return truncate(value.trim(), MAX_FIELD);
}

/**
 * Una voce arrivata dal renderer via IPC: dati esterni, si controllano.
 * @returns {{id: string, name: string, typeLabel: string, where: string} | null}
 */
function validateItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    name: cleanText(raw.name),
    typeLabel: cleanText(raw.typeLabel) || DEFAULT_TYPE_LABEL,
    where: cleanText(raw.where),
    // Piano 46: chiede un permesso o ha finito. Qualunque altro valore è «ha finito».
    kind: raw.kind === 'permission' ? 'permission' : 'done',
  };
}

function validateBadgeCount(raw) {
  return Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Titolo e corpo per una o più sessioni che hanno finito o chiedono un
 * permesso. Solo nomi già visibili in sidebar: mai output del terminale.
 * @returns {{title: string, body: string, tabId: string} | null}
 */
function composeNotification(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const [first] = items;
  if (items.length === 1) {
    return {
      title: first.kind === 'permission' ? `${first.typeLabel} chiede un permesso` : `${first.typeLabel} ha finito`,
      body: truncate([first.name, first.where].filter(Boolean).join(SEPARATOR), MAX_BODY),
      tabId: first.id,
    };
  }
  return {
    // Con un permesso in mezzo «hanno finito» sarebbe falso per almeno una
    title: items.some((i) => i.kind === 'permission') ? `${items.length} sessioni ti aspettano` : `${items.length} sessioni hanno finito`,
    body: truncate(items.map((i) => i.name || i.typeLabel).join(SEPARATOR), MAX_BODY),
    tabId: first.id,
  };
}

/**
 * Raccoglie le voci per `windowMs` dalla prima, poi chiama `onFlush` una
 * volta. La finestra non si allunga con le voci nuove: la prima notifica
 * non tarda mai più di `windowMs`. La stessa scheda conta una volta sola.
 */
function createCoalescer({ windowMs = COALESCE_MS, schedule = setTimeout, cancel = clearTimeout, onFlush }) {
  let pending = new Map();
  let timer = null;

  function flush() {
    timer = null;
    const items = [...pending.values()];
    pending = new Map();
    if (items.length) onFlush(items);
  }

  return {
    push(item) {
      pending = new Map(pending).set(item.id, item);
      if (!timer) timer = schedule(flush, windowMs);
    },
    dispose() {
      if (timer) cancel(timer);
      timer = null;
      pending = new Map();
    },
  };
}

module.exports = {
  isPlatformSupported,
  shouldNotify,
  validateItem,
  validateBadgeCount,
  composeNotification,
  createCoalescer,
  COALESCE_MS,
  MAX_FIELD,
  MAX_BODY,
};
