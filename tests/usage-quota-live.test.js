/* L'innesto della quota di Claude dentro collectUsage: quando c'e', vince sulla
   stima calibrata; quando non c'e', la barra resta com'era. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { collectUsage } = require('../lib/usage');

const NOW = Date.parse('2026-09-21T16:00:00.000Z');
const HOUR = 3600_000;

function claudeEvents() {
  return [
    { ts: NOW - 8 * HOUR, source: 'claude', sessionId: 's1', input: 1000, output: 100, total: 1100 },
    { ts: NOW - 30 * 60_000, source: 'claude', sessionId: 's2', input: 500, output: 50, total: 550 },
  ];
}

const empty = () => ({ ok: true, events: [] });
const collectors = {
  claude: () => ({ ok: true, events: claudeEvents() }),
  codex: empty,
  opencode: empty,
};

const fakeQuota = (fiveHour, weekly) => ({
  read: async () => ({ ts: NOW, source: 'claude', fiveHour, weekly }),
});

test('collect: la quota dell endpoint vince sulla stima calibrata', async () => {
  const u = await collectUsage({
    now: NOW, collectors,
    active: { source: 'claude', sessionId: 's2' },
    quota: fakeQuota(
      { usedPercent: 10, windowMinutes: 300, resetsAt: NOW + 2 * HOUR },
      { usedPercent: 5, windowMinutes: 7 * 24 * 60, resetsAt: NOW + 3 * 24 * HOUR },
    ),
  });
  assert.equal(u.block.limitKind, 'declared');
  assert.equal(u.block.ratio, 0.1);
  assert.equal(u.block.resetsAt, NOW + 2 * HOUR);
});

test('collect: il riquadro settimanale segue lo stesso assistente', async () => {
  const u = await collectUsage({
    now: NOW, collectors,
    active: { source: 'claude', sessionId: 's2' },
    quota: fakeQuota({ usedPercent: 10, windowMinutes: 300 }, { usedPercent: 5, windowMinutes: 10_080 }),
  });
  assert.equal(u.rateLimits.source, 'claude');
  assert.equal(u.rateLimits.weekly.usedPercent, 5);
});

test('collect: endpoint muto, la barra resta sulla stima', async () => {
  const u = await collectUsage({
    now: NOW, collectors,
    active: { source: 'claude', sessionId: 's2' },
    quota: { read: async () => null },
  });
  assert.notEqual(u.block.limitKind, 'declared');
  assert.equal(u.rateLimits, null);
});

test('collect: senza limitsDir non si tocca la rete', async () => {
  const u = await collectUsage({ now: NOW, collectors });
  assert.equal(u.rateLimits, null);
  assert.ok(u.block);
});
