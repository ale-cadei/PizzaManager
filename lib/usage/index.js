/* Una sola funzione per la barra: raccoglie da tutte le sorgenti e aggrega.
 *
 * Le sorgenti sono indipendenti e fragili in modi diversi (un CLI puo' mancare,
 * una directory puo' non esistere, un formato puo' cambiare): una che fallisce
 * non deve azzerare le altre. Ogni sorgente riporta il suo stato in `sources`,
 * e la UI puo' dire *quale* pezzo manca invece di mostrare un totale muto.
 *
 * Antigravity non c'e': tiene le conversazioni in protobuf binario
 * (~/.gemini/antigravity-cli/conversations/*.pb) e i token non sono leggibili
 * senza decodificarlo. E' dichiarato non supportato, non messo a zero: zero
 * vorrebbe dire "non ha consumato niente", che e' falso.
 */
'use strict';
const { collectClaudeUsage } = require('./claude-usage');
const { collectCodexUsage } = require('./codex-usage');
const { collectOpencodeUsage } = require('./opencode-usage');
const { aggregate, DAY_MS, WEEK_DAYS } = require('./aggregate');
const { parseRateLimits } = require('./rate-limits');

/* La finestra piu' larga che la barra mostra e' la settimana mobile: leggere
   piu' indietro costerebbe I/O per dati che nessun riquadro userebbe. Un giorno
   di margine copre gli orologi storti e i log scritti in ritardo. */
function defaultSince(now) {
  return now - (WEEK_DAYS + 1) * DAY_MS;
}

/* La scheda attiva arriva dal renderer, cioe' da fuori: si accettano solo due
   stringhe corte, e qualunque altra forma vale "nessuna sessione attiva". */
function normalizeActive(active) {
  if (!active || typeof active !== 'object') return null;
  const source = typeof active.source === 'string' ? active.source.slice(0, 40) : '';
  const sessionId = typeof active.sessionId === 'string' ? active.sessionId.slice(0, 200) : '';
  return sessionId ? { source, sessionId } : null;
}

const UNSUPPORTED = Object.freeze({
  antigravity: {
    ok: false,
    supported: false,
    error: 'Antigravity salva le conversazioni in protobuf binario: i token non sono leggibili.',
  },
});

function statusOf(name, r) {
  return {
    [name]: r.ok
      ? { ok: true, supported: true, events: r.events.length }
      : { ok: false, supported: true, error: r.error || 'errore sconosciuto', ...(r.available === false ? { available: false } : {}) },
  };
}

/**
 * Fotografia dell'uso: totali per sessione attiva, giornata, finestra di 5h e mese.
 * @param {{ now?: number, since?: number, active?: {source:string,sessionId:string}|null,
 *           collectors?: object }} [opts] `collectors` iniettabile nei test
 * @returns {Promise<object>}
 */
async function collectUsage({ now = Date.now(), since, active = null, collectors = {} } = {}) {
  const from = Number.isFinite(since) ? since : defaultSince(now);
  const wanted = normalizeActive(active);
  const claude = collectors.claude || collectClaudeUsage;
  const codex = collectors.codex || collectCodexUsage;
  const opencode = collectors.opencode || collectOpencodeUsage;

  const [c, x, o] = await Promise.all([
    Promise.resolve().then(() => claude({ since: from })).catch((e) => ({ ok: false, error: String(e.message || e), events: [] })),
    Promise.resolve().then(() => codex({ since: from })).catch((e) => ({ ok: false, error: String(e.message || e), events: [] })),
    Promise.resolve().then(() => opencode({ since: from })).catch((e) => ({ ok: false, error: String(e.message || e), events: [] })),
  ]);

  const events = [...c.events, ...x.events, ...o.events].filter((e) => e && Number(e.ts) >= from);
  // I limiti dichiarati da Codex valgono piu' di una stima: si tiene il piu'
  // recente e lo si normalizza in {fiveHour, weekly}.
  const declared = x.events
    .filter((e) => e.rateLimits)
    .reduce((best, e) => (!best || e.ts > best.ts ? e : best), null);
  const rateLimits = declared
    ? { ts: declared.ts, source: 'codex', ...parseRateLimits(declared.rateLimits, { now }) }
    : null;

  return {
    ...aggregate(events, { now, active: wanted }),
    since: from,
    rateLimits,
    sources: { ...statusOf('claude', c), ...statusOf('codex', x), ...statusOf('opencode', o), ...UNSUPPORTED },
  };
}

module.exports = { collectUsage, defaultSince, DAY_MS };
