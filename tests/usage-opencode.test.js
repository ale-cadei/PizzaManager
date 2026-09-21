const assert = require("node:assert");
const { test: ok } = require("node:test");

const { parseUsageRows, usageQuery, collectOpencodeUsage } = require('../lib/usage/opencode-usage');

/* ---------- Uso di OpenCode: interrogando il database del CLI ---------- */

const ROW = {
  sessionId: 'ses_1',
  ts: 1789657250301,
  model: 'big-pickle',
  provider: 'opencode',
  input: 550,
  output: 59,
  cacheRead: 26496,
  cacheWrite: 0,
  cwd: '/home/tester/progetto',
};

ok('opencode usage: una riga del db diventa un evento', () => {
  const [e] = parseUsageRows(JSON.stringify([ROW]));
  assert.strictEqual(e.source, 'opencode');
  assert.strictEqual(e.input, 550);
  assert.strictEqual(e.cacheRead, 26496);
  assert.strictEqual(e.sessionId, 'ses_1');
  assert.strictEqual(e.cwd, '/home/tester/progetto');
  assert.strictEqual(e.ts, 1789657250301);
});

ok('opencode usage: niente costi, e le righe restano marcate come aggregate', () => {
  const [e] = parseUsageRows(JSON.stringify([ROW]));
  assert.ok(!('cost' in e), 'la barra non mostra soldi: il costo non si legge nemmeno');
  assert.strictEqual(e.aggregated, true, 'una riga = piu messaggi di un ora, non un contesto');
});

ok('opencode usage: la query non chiede la colonna cost', () => {
  assert.ok(!usageQuery(0).includes('cost'));
});

ok('opencode usage: output vuoto = nessun evento, non un errore', () => {
  assert.deepStrictEqual(parseUsageRows(''), []);
  assert.deepStrictEqual(parseUsageRows('[]'), []);
});

ok('opencode usage: output non JSON solleva, chi chiama lo trasforma in errore', () => {
  assert.throws(() => parseUsageRows('command not found'), /JSON/);
});

ok('opencode usage: la query filtra per data con un intero, mai con testo libero', () => {
  const q = usageQuery(1789000000000);
  assert.ok(q.includes('1789000000000'));
  assert.ok(!/;/.test(q.replace(/[^;]/g, '')), 'una sola istruzione');
  assert.throws(() => usageQuery("0; drop table message"), /since/);
  assert.throws(() => usageQuery(Number.NaN), /since/);
});

ok('opencode usage: il CLI che fallisce diventa un errore dichiarato', async () => {
  const run = (bin, args, opts, cb) => cb(new Error('boom'), '', 'no such command');
  const r = await collectOpencodeUsage({ run, binary: '/fake/opencode' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('no such command'));
  assert.deepStrictEqual(r.events, []);
});

ok('opencode usage: il CLI assente non e un errore rumoroso, e assenza di dati', async () => {
  const r = await collectOpencodeUsage({ binary: null });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.available, false);
  assert.deepStrictEqual(r.events, []);
});

ok('opencode usage: percorso felice, la query passa dal binario giusto', async () => {
  const calls = [];
  const run = (bin, args, opts, cb) => {
    calls.push({ bin, args });
    cb(null, JSON.stringify([ROW]), '');
  };
  const r = await collectOpencodeUsage({ run, binary: '/usr/bin/opencode', since: 1789000000000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(calls[0].bin, '/usr/bin/opencode');
  assert.deepStrictEqual(calls[0].args.slice(0, 1), ['db']);
  assert.ok(calls[0].args.includes('--format'));
  assert.ok(calls[0].args.includes('json'));
});
