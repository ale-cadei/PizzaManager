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

/* Piano 35: la quota e' quella dell'account della scheda, non una per tutta l'app. */
const profiles = {
  load: () => ({ version: 1, profiles: { claude: [
    { id: 'claude:lavoro', label: 'Lavoro', command: 'CLAUDE_CONFIG_DIR=/u/.claude claude', resumeArgs: '--resume {id}' },
    { id: 'claude:pers', label: 'Personale', command: 'CLAUDE_CONFIG_DIR=/u/.claude-personal claude', resumeArgs: '--resume {id}' },
  ] } }),
};
const recordingQuota = (asked) => ({
  read: async ({ configDir }) => {
    asked.push(configDir);
    return { ts: NOW, source: 'claude', fiveHour: { usedPercent: configDir === '/u/.claude-personal' ? 40 : 7, windowMinutes: 300 }, weekly: null };
  },
});

test('collect: la quota chiesta e\' quella del profilo della scheda', async () => {
  const asked = [];
  const u = await collectUsage({
    now: NOW, collectors, profiles, env: {},
    active: { source: 'claude', sessionId: 's2' },
    tab: { type: 'claude', commandProfileId: 'claude:pers', claudeAccountId: 'oauth' },
    quota: recordingQuota(asked),
  });
  assert.deepEqual(asked, ['/u/.claude-personal']);
  assert.equal(u.block.ratio, 0.4);
});

test('collect: cambiando scheda cambia l account', async () => {
  const asked = [];
  await collectUsage({
    now: NOW, collectors, profiles, env: {},
    tab: { type: 'claude', commandProfileId: 'claude:lavoro' },
    quota: recordingQuota(asked),
  });
  assert.deepEqual(asked, ['/u/.claude']);
});

test('collect: scheda con chiave API, niente quota dichiarata', async () => {
  const asked = [];
  const u = await collectUsage({
    now: NOW, collectors, profiles, env: {},
    active: { source: 'claude', sessionId: 's2' },
    tab: { type: 'claude', commandProfileId: 'claude:pers', claudeAccountId: 'acc_chiave' },
    quota: recordingQuota(asked),
  });
  assert.deepEqual(asked, []);
  assert.notEqual(u.block.limitKind, 'declared');
});
