/* Da elenco di eventi d'uso a quello che mostra la barra in basso.
 *
 * Un evento e' quello che i vari CLI scrivono nei loro log, normalizzato:
 *   { source, ts, model, input, output, cacheWrite, cacheRead, sessionId, cwd }
 *
 * Si contano solo token, non soldi: la barra risponde a «quanto manca al
 * limite», non a «quanto ho speso». I limiti veri sono tre — il contesto della
 * sessione, la finestra di 5 ore, la settimana — e nessuno dei tre e' espresso
 * in dollari.
 *
 * Tutto qui dentro e' puro: prende eventi e `now`, restituisce oggetti nuovi.
 */
'use strict';
const { contextLimitFor } = require('./context-window');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BLOCK_HOURS = 5; // Claude fattura a blocchi di 5 ore
const WEEK_DAYS = 7;

const EMPTY = Object.freeze({
  input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0, count: 0,
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Somma di un gruppo di eventi.
 * @param {Array<object>} events
 * @returns {typeof EMPTY}
 */
function sumEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const t = list.reduce((acc, e) => ({
    input: acc.input + num(e && e.input),
    output: acc.output + num(e && e.output),
    cacheWrite: acc.cacheWrite + num(e && e.cacheWrite),
    cacheRead: acc.cacheRead + num(e && e.cacheRead),
    count: acc.count + 1,
  }), { ...EMPTY });
  return { ...t, total: t.input + t.output + t.cacheWrite + t.cacheRead };
}

function floorToHour(ts) {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

function sortedByTime(events) {
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && Number.isFinite(Number(e.ts)))
    .slice()
    .sort((a, b) => Number(a.ts) - Number(b.ts));
}

/**
 * Blocco di fatturazione corrente: parte dall'ora piena del primo evento e
 * dura 5 ore; un evento oltre la fine apre il blocco successivo.
 * Se il blocco piu' recente e' gia' scaduto non c'e' nessun blocco attivo:
 * start/end sono null e i totali a zero (non e' "consumo zero", e' "finestra
 * nuova, nessun consumo ancora").
 * @param {Array<object>} events
 * @param {{ now?: number, hours?: number }} [opts]
 */
function currentBlock(events, { now = Date.now(), hours = BLOCK_HOURS } = {}) {
  const span = hours * HOUR_MS;
  const past = sortedByTime(events).filter((e) => Number(e.ts) <= now);
  const blocks = past.reduce((acc, e) => {
    const ts = Number(e.ts);
    const last = acc[acc.length - 1];
    if (last && ts < last.start + span) return [...acc.slice(0, -1), { ...last, events: [...last.events, e] }];
    return [...acc, { start: floorToHour(ts), events: [e] }];
  }, []);
  const last = blocks[blocks.length - 1];
  if (!last || now >= last.start + span) {
    return { start: null, end: null, now, totals: { ...EMPTY }, active: false };
  }
  return {
    start: last.start,
    end: last.start + span,
    now,
    totals: sumEvents(last.events),
    active: true,
  };
}

/**
 * Settimana mobile: gli ultimi 7 giorni fino a `now`.
 * Mobile e non «da lunedi'» perche' il limite settimanale degli abbonamenti
 * scorre con l'uso, non con il calendario.
 * @param {Array<object>} events
 * @param {{ now?: number, days?: number }} [opts]
 */
function currentWeek(events, { now = Date.now(), days = WEEK_DAYS } = {}) {
  const start = now - days * DAY_MS;
  const inside = (Array.isArray(events) ? events : [])
    .filter((e) => Number(e.ts) >= start && Number(e.ts) <= now);
  return { start, end: now, now, totals: sumEvents(inside) };
}

/**
 * Quanto contesto occupa l'ultimo scambio della sessione.
 *
 * I token spesi non hanno un tetto: la sola quota della sessione con un limite
 * vero e' il contesto, cioe' i token dell'ultima richiesta piu' la sua
 * risposta. E' quello che la barra disegna.
 *
 * Restituisce null quando il conto non sarebbe onesto: modello fuori tabella
 * (niente limite) o evento che e' gia' una somma di piu' messaggi (opencode
 * aggrega per ora, vedi opencode-usage.js: sommare messaggi diversi non da'
 * un contesto).
 * @param {Array<object>} events eventi della sola sessione
 * @returns {{model:string, tokens:number, limit:number, ratio:number, ts:number}|null}
 */
function sessionContext(events) {
  const past = sortedByTime(events);
  const last = past[past.length - 1];
  if (!last || last.aggregated) return null;
  const tokens = num(last.input) + num(last.cacheRead) + num(last.cacheWrite) + num(last.output);
  const limit = contextLimitFor(last.model);
  if (!tokens || !limit) return null;
  return {
    model: String(last.model || ''),
    tokens,
    limit,
    ratio: Math.min(1, tokens / limit),
    ts: Number(last.ts),
  };
}

/** Raggruppa i totali per agente, per il dettaglio del tooltip. */
function groupBySource(events) {
  const list = Array.isArray(events) ? events : [];
  const sources = [...new Set(list.map((e) => (e && e.source) || 'sconosciuto'))];
  return sources.reduce((acc, source) => ({
    ...acc,
    [source]: sumEvents(list.filter((e) => ((e && e.source) || 'sconosciuto') === source)),
  }), {});
}

/**
 * Tutto quello che serve alla barra: sessione in primo piano, finestra di 5
 * ore, settimana.
 * @param {Array<object>} events
 * @param {{ now?: number, active?: { source: string, sessionId: string }|null }} [opts]
 * @returns {{ now:number, session: object|null, block: object, week: object, bySource: object }}
 */
function aggregate(events, { now = Date.now(), active = null } = {}) {
  const list = Array.isArray(events) ? events : [];
  const mine = active && active.sessionId
    ? list.filter((e) => e.sessionId === active.sessionId && (!active.source || e.source === active.source))
    : null;
  const week = currentWeek(list, { now });
  return {
    now,
    session: mine ? { ...sumEvents(mine), context: sessionContext(mine) } : null,
    block: currentBlock(list, { now }),
    week,
    bySource: groupBySource(list.filter((e) => Number(e.ts) >= week.start && Number(e.ts) <= now)),
  };
}

module.exports = {
  sumEvents, currentBlock, currentWeek, aggregate, sessionContext, groupBySource,
  EMPTY, HOUR_MS, DAY_MS, BLOCK_HOURS, WEEK_DAYS,
};
