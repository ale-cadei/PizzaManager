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
 * Tutte le finestre di fatturazione attraversate dagli eventi. Una finestra
 * parte dall'ora piena del primo evento e dura 5 ore; un evento oltre la fine
 * ne apre una nuova. `closed` distingue quelle finite da quella in corso: solo
 * le prime possono fare da metro di paragone (vedi peakOf).
 * @param {Array<object>} events
 * @param {{ now?: number, hours?: number }} [opts]
 * @returns {Array<{start:number, end:number, closed:boolean, totals:object}>}
 */
function blocksOf(events, { now = Date.now(), hours = BLOCK_HOURS } = {}) {
  const span = hours * HOUR_MS;
  const past = sortedByTime(events).filter((e) => Number(e.ts) <= now);
  return past.reduce((acc, e) => {
    const ts = Number(e.ts);
    const last = acc[acc.length - 1];
    if (last && ts < last.start + span) return [...acc.slice(0, -1), { ...last, events: [...last.events, e] }];
    return [...acc, { start: floorToHour(ts), events: [e] }];
  }, []).map((b) => ({
    start: b.start,
    end: b.start + span,
    closed: now >= b.start + span,
    totals: sumEvents(b.events),
  }));
}

/**
 * Blocco di fatturazione corrente.
 * Se il blocco piu' recente e' gia' scaduto non c'e' nessun blocco attivo:
 * start/end sono null e i totali a zero (non e' "consumo zero", e' "finestra
 * nuova, nessun consumo ancora").
 * @param {Array<object>} events
 * @param {{ now?: number, hours?: number }} [opts]
 */
function currentBlock(events, { now = Date.now(), hours = BLOCK_HOURS } = {}) {
  const blocks = blocksOf(events, { now, hours });
  const last = blocks[blocks.length - 1];
  if (!last || last.closed) {
    return { start: null, end: null, now, totals: { ...EMPTY }, active: false };
  }
  return { start: last.start, end: last.end, now, totals: last.totals, active: true };
}

/**
 * Il consumo piu' alto osservato in una finestra **conclusa**.
 *
 * E' il denominatore della barra quando nessun CLI dichiara la sua quota
 * (Claude e opencode non la scrivono da nessuna parte). Le finestre ancora
 * aperte restano fuori di proposito: la prima finestra di un utente nuovo
 * sarebbe il massimo di se stessa, e la barra direbbe 100% dal primo minuto.
 * @returns {number} 0 se non c'e' ancora nessuna finestra conclusa
 */
function peakOf(events, { now = Date.now(), hours = BLOCK_HOURS } = {}) {
  return blocksOf(events, { now, hours })
    .filter((b) => b.closed)
    .reduce((max, b) => Math.max(max, b.totals.total), 0);
}

function eventsOf(events, source) {
  return (Array.isArray(events) ? events : []).filter((e) => e && e.source === source);
}

/** Ultima attivita' per sorgente, dalla piu' recente. */
function sourcesByRecency(events) {
  const last = (Array.isArray(events) ? events : []).reduce((acc, e) => {
    const s = e && e.source;
    if (!s) return acc;
    const ts = Number(e.ts) || 0;
    return { ...acc, [s]: Math.max(acc[s] || 0, ts) };
  }, {});
  return Object.keys(last).sort((a, b) => last[b] - last[a]);
}

/**
 * Il tetto osservato per ogni assistente, da conservare fra un avvio e l'altro.
 * Le sorgenti senza nemmeno una finestra conclusa restano fuori: uno zero
 * salvato sarebbe un tetto, e non lo e'.
 * @returns {Object<string, number>}
 */
function peaksBySource(events, { now = Date.now(), hours = BLOCK_HOURS } = {}) {
  return sourcesByRecency(events).reduce((acc, source) => {
    const peak = peakOf(eventsOf(events, source), { now, hours });
    return peak > 0 ? { ...acc, [source]: peak } : acc;
  }, {});
}

/**
 * Il riquadro FINESTRA 5h, per un solo assistente: i limiti sono per account e
 * per fornitore, sommare piu' agenti contro un tetto unico non corrisponderebbe
 * a niente di reale.
 *
 * La quota dichiarata da un CLI (`rate_limits` di Codex) ha sempre la
 * precedenza sulla calibrazione: e' un dato del fornitore, non una stima. Senza
 * tetto — nessuna finestra ancora conclusa — `ratio` e' null e la barra si
 * nasconde, come per il contesto di un modello fuori tabella.
 *
 * @param {Array<object>} events eventi di tutte le sorgenti
 * @param {{ now?: number, source?: string|null, peak?: number, peakAt?: number|null,
 *           declared?: {source:string, fiveHour:object|null}|null, hours?: number }} [opts]
 */
function fiveHourQuota(events, {
  now = Date.now(), source = null, peak = 0, peakAt = null, declared = null, hours = BLOCK_HOURS,
} = {}) {
  const chosen = source || sourcesByRecency(events)[0] || null;
  const mine = chosen ? eventsOf(events, chosen) : [];
  const block = currentBlock(mine, { now, hours });
  const observed = peakOf(mine, { now, hours });
  const stored = num(peak);
  const limit = Math.max(stored, observed) || null;
  /* Le quote dichiarate possono essere piu' d'una (Codex dai suoi rollout,
     Claude dall'endpoint): vale quella dell'assistente che si sta guardando. */
  const claimed = (Array.isArray(declared) ? declared : [declared]).filter(Boolean);
  const mio = claimed.find((d) => d.source === chosen);
  const cli = mio && mio.fiveHour
    && Number.isFinite(Number(mio.fiveHour.usedPercent))
    ? mio.fiveHour
    : null;
  const resetsAt = cli && Number.isFinite(Number(cli.resetsAt))
    ? Number(cli.resetsAt)
    : (block.active ? block.end : null);
  const ratio = cli
    ? Math.min(1, Math.max(0, Number(cli.usedPercent) / 100))
    : (limit && block.active ? Math.min(1, block.totals.total / limit) : null);
  return {
    ...block,
    source: chosen,
    limit: cli ? null : limit,
    limitKind: cli ? 'declared' : (ratio === null ? null : 'calibrated'),
    peakObservedAt: !cli && limit && limit === stored ? peakAt : null,
    ratio,
    overPeak: !cli && !!limit && block.active && block.totals.total > limit,
    resetsAt,
    resetsIn: Number.isFinite(Number(resetsAt)) && Number(resetsAt) > now ? Number(resetsAt) - now : null,
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
 *
 * `peaks` sono i tetti gia' osservati in passato (lib/usage/usage-limits.js):
 * la lettura copre una settimana, il massimo storico puo' essere piu' vecchio.
 * `peaks` in uscita e' quello visto adesso, da riconsegnare allo store.
 *
 * @param {Array<object>} events
 * @param {{ now?: number, active?: { source: string, sessionId: string }|null,
 *           peaks?: Object<string,number>, peaksAt?: Object<string,number>,
 *           declared?: object|null }} [opts]
 * @returns {{ now:number, session: object|null, block: object, week: object,
 *             bySource: object, peaks: Object<string,number> }}
 */
function aggregate(events, {
  now = Date.now(), active = null, peaks = {}, peaksAt = {}, declared = null,
} = {}) {
  const list = Array.isArray(events) ? events : [];
  const mine = active && active.sessionId
    ? list.filter((e) => e.sessionId === active.sessionId && (!active.source || e.source === active.source))
    : null;
  const week = currentWeek(list, { now });
  // Il riquadro della finestra segue la scheda in primo piano; se non e' un
  // assistente riconosciuto parla dell'ultimo che ha lavorato, e lo dichiara.
  const source = (active && active.source) || sourcesByRecency(list)[0] || null;
  return {
    now,
    session: mine ? { ...sumEvents(mine), context: sessionContext(mine) } : null,
    block: fiveHourQuota(list, {
      now,
      source,
      peak: num(peaks && peaks[source]),
      peakAt: (peaksAt && peaksAt[source]) || null,
      declared,
    }),
    week,
    bySource: groupBySource(list.filter((e) => Number(e.ts) >= week.start && Number(e.ts) <= now)),
    peaks: peaksBySource(list, { now }),
  };
}

module.exports = {
  sumEvents, currentBlock, currentWeek, aggregate, sessionContext, groupBySource,
  blocksOf, peakOf, peaksBySource, sourcesByRecency, fiveHourQuota,
  EMPTY, HOUR_MS, DAY_MS, BLOCK_HOURS, WEEK_DAYS,
};
