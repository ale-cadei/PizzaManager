/* La quota di Claude letta dall'endpoint: parsing, cache, e il fatto che un
   errore non cancelli l'ultimo numero buono. Nessuna rete: fetch e' iniettato. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClaudeQuota, parseOauthUsage } = require('../lib/usage/claude-quota');

const BODY = {
  five_hour: { utilization: 10, resets_at: '2026-09-21T18:30:00.000Z', limit_dollars: null },
  seven_day: { utilization: 5, resets_at: '2026-09-25T02:00:00.000Z' },
  nimbus_quill: { utilization: 0, resets_at: null },
  tangelo: null,
};

function credentialsWith(token) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-'));
  const file = path.join(dir, '.credentials.json');
  fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: token } }));
  return file;
}

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
  const q = createClaudeQuota({ credentialsPath: credentialsWith(TOKEN), fetchImpl: okFetch(calls) });
  const r = await q.read({ now: 1000 });
  assert.equal(r.source, 'claude');
  assert.equal(r.fiveHour.usedPercent, 10);
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`);
});

test('la cache evita una chiamata di rete a ogni giro della barra', async () => {
  const calls = [];
  const q = createClaudeQuota({
    credentialsPath: credentialsWith(TOKEN), fetchImpl: okFetch(calls), ttlMs: 60_000,
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
  const file = credentialsWith('corto');
  const q = createClaudeQuota({ credentialsPath: file, fetchImpl: okFetch(calls) });
  assert.equal(await q.read({ now: 1 }), null);
  assert.equal(calls.length, 0);
});

test('file delle credenziali assente: nessun errore, nessuna quota', async () => {
  const q = createClaudeQuota({ credentialsPath: '/non/esiste.json', fetchImpl: okFetch([]) });
  assert.equal(await q.read({ now: 1 }), null);
});

test('una chiamata fallita non cancella l ultimo numero buono', async () => {
  let fail = false;
  const q = createClaudeQuota({
    credentialsPath: credentialsWith(TOKEN),
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
    credentialsPath: credentialsWith(TOKEN), ttlMs: 10, retryMs: 60_000,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 429 }; },
  });
  await q.read({ now: 1000 });
  await q.read({ now: 2000 });
  await q.read({ now: 30_000 });
  assert.equal(calls, 1, 'si aspetta il retryMs prima di riprovare');
  await q.read({ now: 100_000 });
  assert.equal(calls, 2);
});
