const assert = require("node:assert");
const { test: ok } = require("node:test");

const { sumEvents, currentBlock, currentWeek, aggregate, EMPTY } = require('../lib/usage/aggregate');

/* ---------- Aggregazione: eventi -> quello che mostra la barra ---------- */

const H = 60 * 60 * 1000;

function ev(over = {}) {
  return {
    source: 'claude',
    ts: Date.parse('2026-09-21T10:00:00Z'),
    model: 'claude-sonnet-4-5-20250929',
    input: 100,
    output: 50,
    cacheWrite: 0,
    cacheRead: 1000,
    sessionId: 's1',
    ...over,
  };
}

ok('aggregate: la somma di zero eventi e zero, non null', () => {
  const t = sumEvents([]);
  assert.deepStrictEqual({ ...t }, { ...EMPTY });
  assert.strictEqual(t.total, 0);
});

ok('aggregate: somma i token e conta il totale', () => {
  const t = sumEvents([ev(), ev({ input: 900, output: 150 })]);
  assert.strictEqual(t.input, 1000);
  assert.strictEqual(t.output, 200);
  assert.strictEqual(t.cacheRead, 2000);
  assert.strictEqual(t.count, 2);
  assert.strictEqual(t.total, 1000 + 200 + 0 + 2000);
});

ok('aggregate: nessun costo nei totali, la barra non parla di soldi', () => {
  const t = sumEvents([ev()]);
  assert.ok(!('cost' in t) && !('partial' in t));
});

ok('aggregate: la finestra di 5h parte dall ora piena del primo evento', () => {
  const first = Date.parse('2026-09-21T10:37:00Z');
  const block = currentBlock([ev({ ts: first })], { now: first + H });
  assert.strictEqual(new Date(block.start).toISOString(), '2026-09-21T10:00:00.000Z');
  assert.strictEqual(new Date(block.end).toISOString(), '2026-09-21T15:00:00.000Z');
});

ok('aggregate: dopo 5h inizia un blocco nuovo, il vecchio non conta piu', () => {
  const t0 = Date.parse('2026-09-21T10:30:00Z');
  const events = [ev({ ts: t0, input: 1 }), ev({ ts: t0 + 6 * H, input: 7 })];
  const block = currentBlock(events, { now: t0 + 6 * H + 60000 });
  assert.strictEqual(block.totals.input, 7, 'il blocco corrente contiene solo il secondo evento');
  assert.strictEqual(new Date(block.start).toISOString(), '2026-09-21T16:00:00.000Z');
});

ok('aggregate: senza eventi nella finestra il blocco e vuoto ma descritto', () => {
  const now = Date.parse('2026-09-21T10:00:00Z');
  const block = currentBlock([], { now });
  assert.strictEqual(block.totals.total, 0);
  assert.strictEqual(block.start, null);
  assert.strictEqual(block.end, null);
});

ok('aggregate: la settimana e mobile, non parte da lunedi', () => {
  const now = new Date(2026, 8, 21, 12, 0, 0).getTime();
  const dentro = now - 6 * 24 * H;
  const fuori = now - 8 * 24 * H;
  const week = currentWeek([ev({ ts: dentro, input: 11 }), ev({ ts: fuori, input: 5 })], { now });
  assert.strictEqual(week.totals.input, 11, 'oltre i 7 giorni non conta piu');
  assert.strictEqual(week.start, now - 7 * 24 * H);
});

ok('aggregate: la sessione attiva filtra per sorgente e id', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const events = [
    ev({ sessionId: 's1', input: 3 }),
    ev({ sessionId: 's2', input: 9 }),
    ev({ sessionId: 's1', source: 'codex', input: 100 }),
  ];
  const out = aggregate(events, { now, active: { source: 'claude', sessionId: 's1' } });
  assert.strictEqual(out.session.input, 3);
});

ok('aggregate: senza sessione attiva il riquadro e nullo, non zero', () => {
  const out = aggregate([ev()], { now: Date.parse('2026-09-21T12:00:00Z') });
  assert.strictEqual(out.session, null);
});

ok('aggregate: la ripartizione per agente serve al tooltip', () => {
  const now = new Date(2026, 8, 21, 12, 0, 0).getTime();
  const t = new Date(2026, 8, 21, 9, 0, 0).getTime();
  const out = aggregate([
    ev({ ts: t, source: 'claude', input: 5 }),
    ev({ ts: t, source: 'codex', input: 3 }),
    ev({ ts: t, source: 'codex', input: 4 }),
  ], { now });
  assert.strictEqual(out.bySource.claude.input, 5);
  assert.strictEqual(out.bySource.codex.input, 7);
});
