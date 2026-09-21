const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert");
const { test: ok } = require("node:test");

const { eventsFromLines, collectCodexUsage, clearCache } = require('../lib/usage/codex-usage');

/* ---------- Uso di Codex CLI: dai rollout agli eventi ---------- */

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function meta(over = {}) {
  return {
    timestamp: '2026-09-21T07:00:00.000Z',
    type: 'session_meta',
    payload: { id: 'sess-cdx', cwd: '/home/tester/progetto', timestamp: '2026-09-21T07:00:00.000Z', ...over },
  };
}

function turnContext(model) {
  return { timestamp: '2026-09-21T07:00:01.000Z', type: 'turn_context', payload: { model, cwd: '/home/tester/progetto' } };
}

function tokenCount({ input = 1000, cached = 900, output = 50, reasoning = 10, ts = '2026-09-21T07:05:00.000Z', total = 5000, rate = null } = {}) {
  return {
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total },
        last_token_usage: {
          input_tokens: input, cached_input_tokens: cached,
          output_tokens: output, reasoning_output_tokens: reasoning,
          total_tokens: input + output,
        },
        model_context_window: 258400,
      },
      ...(rate ? { rate_limits: rate } : {}),
    },
  };
}

function lines(records) {
  return records.map((r) => JSON.stringify(r));
}

ok('codex usage: il token_count diventa un evento, con la cache scorporata', () => {
  const [e, ...rest] = eventsFromLines(lines([meta(), turnContext('gpt-5.5'), tokenCount()]));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(e.source, 'codex');
  assert.strictEqual(e.input, 100, 'input_tokens include la cache: va tolta');
  assert.strictEqual(e.cacheRead, 900);
  assert.strictEqual(e.output, 50);
  assert.strictEqual(e.model, 'gpt-5.5');
  assert.strictEqual(e.sessionId, 'sess-cdx');
  assert.strictEqual(e.cwd, '/home/tester/progetto');
});

ok('codex usage: si sommano i delta del turno, non i totali cumulativi', () => {
  const out = eventsFromLines(lines([
    meta(), turnContext('gpt-5.5'),
    tokenCount({ input: 1000, cached: 0, output: 10, ts: '2026-09-21T07:05:00.000Z', total: 1010 }),
    tokenCount({ input: 2000, cached: 1000, output: 20, ts: '2026-09-21T07:06:00.000Z', total: 3030 }),
  ]));
  const somma = out.reduce((a, e) => a + e.input + e.cacheRead + e.output, 0);
  assert.strictEqual(somma, 1010 + 2020, 'due turni, non il cumulativo del secondo');
});

ok('codex usage: il modello e quello del turno in corso', () => {
  const out = eventsFromLines(lines([
    meta(), turnContext('gpt-5.5'), tokenCount({ ts: '2026-09-21T07:05:00.000Z' }),
    turnContext('gpt-5-mini'), tokenCount({ ts: '2026-09-21T07:09:00.000Z' }),
  ]));
  assert.deepStrictEqual(out.map((e) => e.model), ['gpt-5.5', 'gpt-5-mini']);
});

ok('codex usage: lo stesso turno ricopiato in un rollout di resume vale una volta', () => {
  const uno = tokenCount({ ts: '2026-09-21T07:05:00.000Z', total: 1010 });
  const out = eventsFromLines(lines([meta(), turnContext('gpt-5.5'), uno, uno]));
  assert.strictEqual(out.length, 1);
});

ok('codex usage: le righe senza info non producono eventi ne eccezioni', () => {
  const out = eventsFromLines(lines([
    meta(),
    { type: 'event_msg', payload: { type: 'token_count' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'ciao' } },
    { type: 'response_item', payload: { type: 'message', role: 'user' } },
  ]).concat(['{ troncat']));
  assert.deepStrictEqual(out, []);
});

ok('codex usage: i limiti dichiarati dal CLI vengono riportati', () => {
  const rate = { primary: { used_percent: 61.5, window_minutes: 300, resets_in_seconds: 3600 } };
  const out = eventsFromLines(lines([meta(), turnContext('gpt-5.5'), tokenCount({ rate })]));
  assert.strictEqual(out[0].rateLimits.primary.used_percent, 61.5);
});

ok('codex usage: legge i rollout sotto ~/.codex/sessions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-codex-'));
  try {
    clearCache();
    const dir = path.join(home, '.codex', 'sessions', '2026', '09', '21');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rollout-2026-09-21T07-00-00-sess-cdx.jsonl'),
      lines([meta(), turnContext('gpt-5.5'), tokenCount()]).join('\n') + '\n');
    const r = collectCodexUsage({ home });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.events.length, 1);
    assert.strictEqual(r.events[0].sessionId, 'sess-cdx');
  } finally { removeDir(home); }
});

ok('codex usage: senza ~/.codex l errore e dichiarato', () => {
  clearCache();
  const r = collectCodexUsage({ home: path.join(os.tmpdir(), 'aisess-nulla-' + Date.now()) });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.events, []);
});
