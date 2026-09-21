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
const { createUsageLimitsStore } = require('./usage-limits');
const { createClaudeQuota } = require('./claude-quota');

/* Una sola istanza per processo: la cache della quota vive li' dentro, e
   collectUsage viene chiamata ogni 8 secondi. Crearla a ogni giro vorrebbe
   dire una chiamata di rete a ogni giro. */
let claudeQuotaInstance = null;
function sharedClaudeQuota() {
  if (!claudeQuotaInstance) claudeQuotaInstance = createClaudeQuota();
  return claudeQuotaInstance;
}

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
 *           collectors?: object, limitsDir?: string|null, limits?: object|null }} [opts]
 *           `limitsDir` e' la cartella dati (la passa main.js, come per gli altri
 *           store); `collectors` e `limits` sono iniettabili nei test
 * @returns {Promise<object>}
 */
async function collectUsage({
  now = Date.now(), since, active = null, collectors = {}, limitsDir = null, limits = null,
  quota = null,
} = {}) {
  const peaksStore = limits || (limitsDir ? createUsageLimitsStore({ dir: limitsDir }) : null);
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

  /* Il tetto in token della finestra di 5h non lo dichiara nessuno tranne
     Codex: per gli altri e' il massimo osservato in una finestra conclusa, e
     vive fra un avvio e l'altro nello store (docs/plans/15-quota-token-5h.md).
     Senza store la barra funziona lo stesso, calibrata sulla sola settimana
     letta: i test passano un oggetto finto, non il disco. */
  /* Claude la quota non la scrive da nessuna parte: la chiede al server, e
     quel numero e' l'unico sincronizzato fra dispositivi (piano 16). Se la
     chiamata non risponde si resta sulla stima calibrata. */
  /* L'istanza condivisa si accende solo quando c'e' `limitsDir`, cioe' quando
     a chiamare e' l'app: cosi' la suite non tocca la rete per sbaglio e chi
     vuole provarla inietta `quota`. */
  const quotaReader = quota || (limitsDir ? sharedClaudeQuota() : null);
  const claudeDeclared = quotaReader
    ? await Promise.resolve().then(() => quotaReader.read({ now })).catch(() => null)
    : null;
  const declaredAll = [rateLimits, claudeDeclared].filter(Boolean);

  const snapshot = aggregate(events, {
    now,
    active: wanted,
    peaks: peaksStore ? peaksStore.peaks() : {},
    peaksAt: peaksStore && peaksStore.peaksAt ? peaksStore.peaksAt() : {},
    declared: declaredAll,
  });
  if (peaksStore) peaksStore.observe(snapshot.peaks, { now });

  return {
    ...snapshot,
    since: from,
    // Il riquadro SETTIMANA segue lo stesso assistente della finestra di 5h:
    // due quote di fornitori diversi affiancate non si sommano e non si
    // confrontano.
    rateLimits: (snapshot.block && snapshot.block.source === 'claude' && claudeDeclared)
      || rateLimits,
    sources: { ...statusOf('claude', c), ...statusOf('codex', x), ...statusOf('opencode', o), ...UNSUPPORTED },
  };
}

module.exports = { collectUsage, defaultSince, DAY_MS };
