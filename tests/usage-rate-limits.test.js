const assert = require('node:assert');
const { test: ok } = require('node:test');

/* I limiti dichiarati dai CLI: quello che finisce sotto le barre di 5h e
   settimana. Payload presi da rollout veri di Codex. */
const { parseRateLimits } = require('../lib/usage/rate-limits');

const NOW = Date.parse('2026-09-21T12:00:00Z');

ok('rate limits: le finestre si riconoscono dalla durata, non dalla posizione', () => {
  // Account free visto sul campo: il "primary" e' mensile (43200 minuti).
  const out = parseRateLimits({
    primary: { used_percent: 100, window_minutes: 43200, resets_at: 1785421530 },
    secondary: null,
  }, { now: NOW });
  assert.strictEqual(out.fiveHour, null, 'un limite mensile non e la finestra di 5 ore');
  assert.strictEqual(out.weekly, null);
});

ok('rate limits: 300 minuti = 5 ore, 10080 = settimana', () => {
  const out = parseRateLimits({
    primary: { used_percent: 61.5, window_minutes: 300, resets_at: NOW / 1000 + 3600 },
    secondary: { used_percent: 12, window_minutes: 10080, resets_in_seconds: 86400 },
  }, { now: NOW });
  assert.strictEqual(out.fiveHour.usedPercent, 61.5);
  assert.strictEqual(out.fiveHour.resetsAt, NOW + 3600 * 1000);
  assert.strictEqual(out.weekly.usedPercent, 12);
  assert.strictEqual(out.weekly.resetsAt, NOW + 86400 * 1000, 'il conto alla rovescia diventa un istante');
});

ok('rate limits: le finestre possono arrivare invertite fra primary e secondary', () => {
  const out = parseRateLimits({
    primary: { used_percent: 5, window_minutes: 10080 },
    secondary: { used_percent: 90, window_minutes: 300 },
  }, { now: NOW });
  assert.strictEqual(out.fiveHour.usedPercent, 90);
  assert.strictEqual(out.weekly.usedPercent, 5);
  assert.strictEqual(out.fiveHour.resetsAt, null, 'nessun reset dichiarato: null, non una data inventata');
});

ok('rate limits: niente payload, niente quote', () => {
  assert.deepStrictEqual(parseRateLimits(null, { now: NOW }), { fiveHour: null, weekly: null });
  assert.deepStrictEqual(parseRateLimits({ primary: null, secondary: null }, { now: NOW }), { fiveHour: null, weekly: null });
  const senzaPercento = parseRateLimits({ primary: { window_minutes: 300 } }, { now: NOW });
  assert.strictEqual(senzaPercento.fiveHour, null, 'una finestra senza percentuale non si disegna');
});

ok('rate limits: la percentuale resta fra 0 e 100', () => {
  const out = parseRateLimits({ primary: { used_percent: 142, window_minutes: 300 } }, { now: NOW });
  assert.strictEqual(out.fiveHour.usedPercent, 100);
});
