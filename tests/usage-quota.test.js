const assert = require('node:assert');
const { test: ok } = require('node:test');

/* La quota in token della finestra di 5 ore (docs/plans/15-quota-token-5h.md).
 *
 * Il tetto non lo dichiara nessuno per Claude e opencode: si calibra sul
 * massimo consumo osservato in una finestra CHIUSA. Qui si verifica proprio
 * quello — che una finestra aperta non faccia da tetto a se stessa, che il
 * riquadro parli di una sola sorgente, e che la quota dichiarata da un CLI
 * abbia sempre la precedenza sulla stima. */

const {
  blocksOf, peakOf, peaksBySource, sourcesByRecency, fiveHourQuota, aggregate, BLOCK_HOURS,
} = require('../lib/usage/aggregate');

const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-21T10:00:00Z');

function ev(over = {}) {
  return {
    source: 'claude',
    ts: T0,
    model: 'claude-sonnet-5',
    input: 100,
    output: 50,
    cacheWrite: 0,
    cacheRead: 850,
    sessionId: 's1',
    ...over,
  };
}

/* ---------- Blocchi: chiusi e aperto ---------- */

ok('quota: gli eventi si dividono in finestre di 5h, marcate chiuse o aperte', () => {
  const now = T0 + 7 * H;
  const blocks = blocksOf([ev({ ts: T0 }), ev({ ts: T0 + 6 * H })], { now });
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].closed, true, 'la prima finestra e finita');
  assert.strictEqual(blocks[1].closed, false, 'la seconda e ancora aperta');
  assert.strictEqual(blocks[0].end - blocks[0].start, BLOCK_HOURS * H);
});

ok('quota: il tetto e il massimo delle finestre CHIUSE, mai di quella aperta', () => {
  // Finestra chiusa da 1.000, finestra aperta da 9.000: il tetto resta 1.000.
  const chiusa = ev({ ts: T0, input: 1000, output: 0, cacheRead: 0 });
  const aperta = ev({ ts: T0 + 6 * H, input: 9000, output: 0, cacheRead: 0 });
  assert.strictEqual(peakOf([chiusa, aperta], { now: T0 + 7 * H }), 1000);
});

ok('quota: senza nessuna finestra chiusa il tetto e zero, non il consumo di adesso', () => {
  assert.strictEqual(peakOf([ev({ ts: T0, input: 5000 })], { now: T0 + H }), 0);
  assert.strictEqual(peakOf([], { now: T0 }), 0);
});

ok('quota: ogni assistente ha il suo tetto, i token non si sommano fra fornitori', () => {
  const now = T0 + 7 * H;
  const peaks = peaksBySource([
    ev({ ts: T0, input: 1000, output: 0, cacheRead: 0 }),
    ev({ ts: T0, source: 'codex', input: 300, output: 0, cacheRead: 0 }),
    ev({ ts: T0 + 6 * H, source: 'codex', input: 7000, output: 0, cacheRead: 0 }),
  ], { now });
  assert.deepStrictEqual(peaks, { claude: 1000, codex: 300 });
});

ok('quota: le sorgenti si ordinano dalla piu recente, per scegliere in mancanza di scheda', () => {
  const list = sourcesByRecency([
    ev({ ts: T0, source: 'claude' }),
    ev({ ts: T0 + 2 * H, source: 'opencode' }),
    ev({ ts: T0 + H, source: 'codex' }),
  ]);
  assert.deepStrictEqual(list, ['opencode', 'codex', 'claude']);
});

/* ---------- Il riquadro FINESTRA 5h ---------- */

function claudeEvents() {
  // 2.000 token nella finestra chiusa, 500 in quella aperta.
  return [
    ev({ ts: T0, input: 2000, output: 0, cacheRead: 0 }),
    ev({ ts: T0 + 6 * H, input: 500, output: 0, cacheRead: 0 }),
  ];
}

ok('quota: la percentuale sono i token della finestra aperta sul tetto calibrato', () => {
  const now = T0 + 7 * H;
  const q = fiveHourQuota(claudeEvents(), { now, source: 'claude' });
  assert.strictEqual(q.source, 'claude');
  assert.strictEqual(q.totals.total, 500);
  assert.strictEqual(q.limit, 2000);
  assert.strictEqual(q.limitKind, 'calibrated');
  assert.strictEqual(q.ratio, 0.25);
  assert.strictEqual(q.overPeak, false);
});

ok('quota: il tetto salvato da prima vale se e piu alto di quello appena visto', () => {
  const now = T0 + 7 * H;
  const q = fiveHourQuota(claudeEvents(), { now, source: 'claude', peak: 5000 });
  assert.strictEqual(q.limit, 5000);
  assert.strictEqual(q.ratio, 0.1);
  // E se il salvato e piu basso, vince quello osservato adesso.
  const q2 = fiveHourQuota(claudeEvents(), { now, source: 'claude', peak: 100 });
  assert.strictEqual(q2.limit, 2000);
});

ok('quota: oltre il tetto ci si ferma a 100% e lo si dichiara', () => {
  const now = T0 + 7 * H;
  const eventi = [
    ev({ ts: T0, input: 1000, output: 0, cacheRead: 0 }),
    ev({ ts: T0 + 6 * H, input: 4000, output: 0, cacheRead: 0 }),
  ];
  const q = fiveHourQuota(eventi, { now, source: 'claude' });
  assert.strictEqual(q.ratio, 1);
  assert.strictEqual(q.overPeak, true);
});

ok('quota: finche non c e una finestra chiusa non si mostra nessuna percentuale', () => {
  const q = fiveHourQuota([ev({ ts: T0, input: 5000 })], { now: T0 + H, source: 'claude' });
  assert.strictEqual(q.active, true, 'la finestra e aperta');
  assert.strictEqual(q.limit, null);
  assert.strictEqual(q.limitKind, null);
  assert.strictEqual(q.ratio, null, 'nessun tetto: nessuna barra, non uno zero');
});

ok('quota: fuori da una finestra aperta non c e ne percentuale ne reset', () => {
  const q = fiveHourQuota([ev({ ts: T0 })], { now: T0 + 30 * H, source: 'claude' });
  assert.strictEqual(q.active, false);
  assert.strictEqual(q.ratio, null);
  assert.strictEqual(q.resetsIn, null);
  assert.strictEqual(q.totals.total, 0);
});

ok('quota: il reset e la fine della finestra, quanto manca da adesso', () => {
  const now = T0 + 2 * H;
  const q = fiveHourQuota([ev({ ts: T0 })], { now, source: 'claude' });
  assert.strictEqual(q.resetsAt, T0 + 5 * H);
  assert.strictEqual(q.resetsIn, 3 * H);
});

ok('quota: il riquadro conta solo la sorgente chiesta', () => {
  const now = T0 + 7 * H;
  const eventi = [
    ...claudeEvents(),
    ev({ ts: T0 + 6 * H, source: 'codex', input: 999_999, output: 0, cacheRead: 0 }),
  ];
  const q = fiveHourQuota(eventi, { now, source: 'claude' });
  assert.strictEqual(q.totals.total, 500, 'i token di codex non entrano nella finestra di claude');
});

ok('quota: senza sorgente indicata si prende quella con l attivita piu recente', () => {
  const now = T0 + 7 * H;
  const eventi = [
    ev({ ts: T0, input: 1000, output: 0, cacheRead: 0 }),
    ev({ ts: T0 + 6 * H, source: 'codex', input: 42, output: 0, cacheRead: 0 }),
  ];
  const q = fiveHourQuota(eventi, { now, source: null });
  assert.strictEqual(q.source, 'codex');
});

/* ---------- La quota dichiarata dal CLI vince ---------- */

const declaredCodex = {
  ts: T0 + 6 * H,
  source: 'codex',
  fiveHour: { usedPercent: 8, windowMinutes: 300, resetsAt: T0 + 9 * H },
  weekly: null,
};

ok('quota: se il CLI la dichiara si usa quella, col suo reset', () => {
  const now = T0 + 7 * H;
  const eventi = [
    ev({ ts: T0, source: 'codex', input: 1000, output: 0, cacheRead: 0 }),
    ev({ ts: T0 + 6 * H, source: 'codex', input: 900, output: 0, cacheRead: 0 }),
  ];
  const q = fiveHourQuota(eventi, { now, source: 'codex', declared: declaredCodex });
  assert.strictEqual(q.limitKind, 'declared');
  assert.strictEqual(q.ratio, 0.08, 'la stima nostra direbbe 90%, ma il CLI dice 8%');
  assert.strictEqual(q.resetsAt, T0 + 9 * H);
  assert.strictEqual(q.resetsIn, 2 * H);
});

ok('quota: la quota di un CLI non si applica a un altro assistente', () => {
  const now = T0 + 7 * H;
  const q = fiveHourQuota(claudeEvents(), { now, source: 'claude', declared: declaredCodex });
  assert.strictEqual(q.limitKind, 'calibrated', 'i rate_limits di codex non parlano di claude');
  assert.strictEqual(q.ratio, 0.25);
});

/* ---------- Come lo vede la barra ---------- */

ok('quota: aggregate consegna il riquadro gia pronto e i tetti da salvare', () => {
  const now = T0 + 7 * H;
  const snap = aggregate(claudeEvents(), {
    now,
    active: { source: 'claude', sessionId: 's1' },
    peaks: { claude: 100 },
  });
  assert.strictEqual(snap.block.source, 'claude');
  assert.strictEqual(snap.block.ratio, 0.25);
  assert.strictEqual(snap.block.limitKind, 'calibrated');
  assert.deepStrictEqual(snap.peaks, { claude: 2000 }, 'i massimi osservati, da persistere');
});

ok('quota: una scheda senza sessione non azzera il riquadro della finestra', () => {
  const now = T0 + 7 * H;
  const snap = aggregate(claudeEvents(), { now, active: null });
  assert.strictEqual(snap.session, null, 'niente sessione in primo piano');
  assert.strictEqual(snap.block.source, 'claude', 'la finestra parla comunque dell ultimo assistente attivo');
  assert.strictEqual(snap.block.ratio, 0.25);
});
