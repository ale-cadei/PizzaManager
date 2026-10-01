/* La quota di Claude letta dall'endpoint: parsing, cache, e il fatto che un
   errore non cancelli l'ultimo numero buono. Nessuna rete: fetch e' iniettato. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createClaudeQuota, parseOauthUsage } = require('../lib/usage/claude-quota');

const BODY = {
  five_hour: { utilization: 10, resets_at: '2026-09-21T18:30:00.000Z', limit_dollars: null },
  seven_day: { utilization: 5, resets_at: '2026-09-25T02:00:00.000Z' },
  nimbus_quill: { utilization: 0, resets_at: null },
  tangelo: null,
};

// Da dove arriva il token lo verifica claude-token.test.js: qui conta solo
// cosa succede con o senza.
const tokenIs = (token) => async () => token;

const TOKEN = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz';
const okFetch = (calls) => async (url, opts) => {
  calls.push({ url, auth: opts.headers.authorization });
  return { ok: true, json: async () => BODY };
};

test('parseOauthUsage tiene five_hour e seven_day', () => {
  const p = parseOauthUsage(BODY);
  assert.equal(p.fiveHour.usedPercent, 10);
  assert.equal(p.fiveHour.windowMinutes, 300);
  assert.equal(p.fiveHour.resetsAt, Date.parse('2026-09-21T18:30:00.000Z'));
  assert.equal(p.weekly.usedPercent, 5);
  assert.equal(p.weekly.windowMinutes, 7 * 24 * 60);
});

test('i campi sperimentali della risposta non finiscono nel risultato', () => {
  const p = parseOauthUsage(BODY);
  assert.deepEqual(Object.keys(p).sort(), ['fiveHour', 'weekly']);
});

test('una risposta senza le due finestre vale niente, non zero', () => {
  assert.equal(parseOauthUsage({ tangelo: null }), null);
  assert.equal(parseOauthUsage(null), null);
  assert.equal(parseOauthUsage('{}'), null);
});

test('read() manda il token nell header e marca la sorgente', async () => {
  const calls = [];
  const q = createClaudeQuota({ readToken: tokenIs(TOKEN), fetchImpl: okFetch(calls) });
  const r = await q.read({ now: 1000 });
  assert.equal(r.source, 'claude');
  assert.equal(r.fiveHour.usedPercent, 10);
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`);
});

test('la cache evita una chiamata di rete a ogni giro della barra', async () => {
  const calls = [];
  const q = createClaudeQuota({
    readToken: tokenIs(TOKEN), fetchImpl: okFetch(calls), ttlMs: 60_000,
  });
  await q.read({ now: 1000 });
  await q.read({ now: 9000 });
  await q.read({ now: 30_000 });
  assert.equal(calls.length, 1, 'una sola chiamata dentro il ttl');
  await q.read({ now: 70_000 });
  assert.equal(calls.length, 2, 'scaduto il ttl si richiede');
});

test('senza token non si chiama nulla', async () => {
  const calls = [];
  const q = createClaudeQuota({ readToken: tokenIs(null), fetchImpl: okFetch(calls) });
  assert.equal(await q.read({ now: 1 }), null);
  assert.equal(calls.length, 0);
});

test('lettura del token che esplode: nessun errore, nessuna quota', async () => {
  const q = createClaudeQuota({ readToken: async () => { throw new Error('keychain'); }, fetchImpl: okFetch([]) });
  assert.equal(await q.read({ now: 1 }), null);
});

test('ogni config dir ha il suo token e la sua cache', async () => {
  const calls = [];
  const asked = [];
  const q = createClaudeQuota({
    readToken: async (configDir) => { asked.push(configDir); return `${TOKEN}-${configDir || 'default'}`; },
    fetchImpl: okFetch(calls), ttlMs: 60_000,
  });
  await q.read({ now: 1000, configDir: '/u/.claude' });
  await q.read({ now: 2000, configDir: '/u/.claude-personal' });
  await q.read({ now: 3000, configDir: '/u/.claude' });
  await q.read({ now: 4000 });
  assert.deepEqual(asked, ['/u/.claude', '/u/.claude-personal', null]);
  assert.deepEqual(calls.map((c) => c.auth), [
    `Bearer ${TOKEN}-/u/.claude`, `Bearer ${TOKEN}-/u/.claude-personal`, `Bearer ${TOKEN}-default`,
  ]);
});

test('un errore su una config dir non ferma le altre', async () => {
  let calls = 0;
  const q = createClaudeQuota({
    readToken: async (configDir) => (configDir ? TOKEN : null),
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => BODY }; },
    retryMs: 60_000,
  });
  assert.equal(await q.read({ now: 1000 }), null);
  const r = await q.read({ now: 2000, configDir: '/u/.claude' });
  assert.equal(r.fiveHour.usedPercent, 10);
  assert.equal(calls, 1);
});

test('una chiamata fallita non cancella l ultimo numero buono', async () => {
  let fail = false;
  const q = createClaudeQuota({
    readToken: tokenIs(TOKEN),
    ttlMs: 10, retryMs: 1000,
    fetchImpl: async () => { if (fail) throw new Error('rete giu'); return { ok: true, json: async () => BODY }; },
  });
  const first = await q.read({ now: 1000 });
  fail = true;
  const after = await q.read({ now: 5000 });
  assert.equal(after.fiveHour.usedPercent, first.fiveHour.usedPercent);
});

test('dopo un errore non si martella l endpoint', async () => {
  let calls = 0;
  const q = createClaudeQuota({
    readToken: tokenIs(TOKEN), ttlMs: 10, retryMs: 60_000,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 429 }; },
  });
  await q.read({ now: 1000 });
  await q.read({ now: 2000 });
  await q.read({ now: 30_000 });
  assert.equal(calls, 1, 'si aspetta il retryMs prima di riprovare');
  await q.read({ now: 100_000 });
  assert.equal(calls, 2);
});
