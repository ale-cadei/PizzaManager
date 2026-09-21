const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Finestra di contesto e quota della sessione: e' il numero dietro la barra
   del riquadro SESSIONE. */
const { contextLimitFor } = require('../lib/usage/context-window');
const { lookupFamily } = require('../lib/usage/model-family');
const { sessionContext, aggregate } = require('../lib/usage/aggregate');

const NOW = new Date(2026, 8, 21, 12, 0, 0).getTime();

function ev(over = {}) {
  return {
    source: 'claude', ts: NOW - 60_000, model: 'claude-opus-5',
    input: 1_000, output: 2_000, cacheWrite: 0, cacheRead: 47_000,
    cost: 0.1, sessionId: 's1', ...over,
  };
}

ok('contesto: il nome datato resta nella famiglia', () => {
  assert.strictEqual(contextLimitFor('claude-opus-4-20250514'), 200_000);
  assert.strictEqual(contextLimitFor('gpt-5.5-codex'), 400_000);
  assert.strictEqual(contextLimitFor('gemini-3-pro-preview'), 1_000_000);
});

ok('contesto: modello sconosciuto vale null, non un limite di ripiego', () => {
  assert.strictEqual(contextLimitFor('big-pickle'), null);
  assert.strictEqual(contextLimitFor(''), null);
  assert.strictEqual(contextLimitFor(undefined), null);
});

ok('famiglia: vince il prefisso piu lungo, non il primo che combacia', () => {
  const table = { 'gpt-5': 'corto', 'gpt-5-codex': 'lungo' };
  assert.strictEqual(lookupFamily(table, 'gpt-5-codex-2026'), 'lungo');
  assert.strictEqual(lookupFamily(table, 'gpt-5-mini'), 'corto');
});

ok('sessione: il contesto e quello dell ultimo scambio, non la somma', () => {
  const ctx = sessionContext([
    ev({ ts: NOW - 300_000, input: 10, output: 10, cacheRead: 10_000 }),
    ev({ ts: NOW - 60_000, input: 1_000, output: 2_000, cacheRead: 47_000 }),
  ]);
  assert.strictEqual(ctx.tokens, 50_000);
  assert.strictEqual(ctx.limit, 200_000);
  assert.strictEqual(ctx.ratio, 0.25);
});

ok('sessione: totali gia aggregati non diventano un contesto inventato', () => {
  assert.strictEqual(sessionContext([ev({ source: 'opencode', aggregated: true })]), null);
});

ok('sessione: modello fuori tabella, nessun contesto', () => {
  assert.strictEqual(sessionContext([ev({ model: 'big-pickle' })]), null);
  assert.strictEqual(sessionContext([]), null);
});

ok('aggregate: il contesto arriva nella sessione attiva, e non altrove', () => {
  const out = aggregate([ev(), ev({ sessionId: 's2', ts: NOW - 30_000 })], {
    now: NOW, active: { source: 'claude', sessionId: 's1' },
  });
  assert.strictEqual(out.session.context.tokens, 50_000);
  assert.strictEqual(out.session.total, 50_000);
  const nessuna = aggregate([ev()], { now: NOW, active: null });
  assert.strictEqual(nessuna.session, null);
});
