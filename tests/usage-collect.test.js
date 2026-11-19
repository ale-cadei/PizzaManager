const assert = require("node:assert");
const { test: ok } = require("node:test");

const { collectUsage, defaultSince } = require('../lib/usage');

/* ---------- Raccolta: piu sorgenti, una barra sola ---------- */

const NOW = new Date(2026, 8, 21, 12, 0, 0).getTime();

function ev(source, over = {}) {
  return {
    source, ts: new Date(2026, 8, 21, 9, 0, 0).getTime(),
    model: 'claude-opus-5', input: 100, output: 10, cacheWrite: 0, cacheRead: 0,
    sessionId: source + '-1', cwd: '/x', key: source + '-k',
    ...over,
  };
}

const collectors = {
  claude: () => ({ ok: true, events: [ev('claude')] }),
  codex: () => ({ ok: true, events: [ev('codex', {
    rateLimits: {
      primary: { used_percent: 40, window_minutes: 300, resets_at: 1789000000 },
      secondary: { used_percent: 12.5, window_minutes: 10080, resets_at: 1789500000 },
    },
  })] }),
  opencode: async () => ({ ok: true, available: true, events: [ev('opencode')] }),
};

ok('collect: i totali sommano tutte le sorgenti', async () => {
  const u = await collectUsage({ now: NOW, collectors });
  assert.strictEqual(u.week.totals.count, 3);
  assert.strictEqual(u.bySource.codex.count, 1);
  assert.ok(!('cost' in u.week.totals), 'nessun costo nei totali');
});

ok('collect: una sorgente rotta non azzera le altre e si dichiara', async () => {
  const u = await collectUsage({
    now: NOW,
    collectors: { ...collectors, claude: () => ({ ok: false, error: 'directory non trovata', events: [] }) },
  });
  assert.strictEqual(u.week.totals.count, 2, 'restano codex e opencode');
  assert.strictEqual(u.sources.claude.ok, false);
  assert.ok(u.sources.claude.error.includes('directory'));
  assert.strictEqual(u.sources.codex.ok, true);
});

ok('collect: una sorgente che solleva viene catturata, non propaga', async () => {
  const u = await collectUsage({
    now: NOW,
    collectors: { ...collectors, opencode: () => { throw new Error('boom'); } },
  });
  assert.strictEqual(u.sources.opencode.ok, false);
  assert.strictEqual(u.week.totals.count, 2);
});

ok('collect: antigravity e dichiarato non supportato, non zero', async () => {
  const u = await collectUsage({ now: NOW, collectors });
  assert.strictEqual(u.sources.antigravity.supported, false);
  assert.ok(u.sources.antigravity.error.includes('protobuf'));
});

ok('collect: i limiti di Codex arrivano alla UI divisi per finestra', async () => {
  const u = await collectUsage({ now: NOW, collectors, tab: { type: 'codex' } });
  assert.strictEqual(u.rateLimits.fiveHour.usedPercent, 40);
  assert.strictEqual(u.rateLimits.weekly.usedPercent, 12.5);
});

ok('collect: la sessione attiva filtra per sorgente e id', async () => {
  const u = await collectUsage({ now: NOW, collectors, active: { source: 'codex', sessionId: 'codex-1' } });
  assert.strictEqual(u.session.count, 1);
});

ok('collect: si legge una settimana, piu un giorno di margine', () => {
  const giorni = (NOW - defaultSince(NOW)) / (24 * 60 * 60 * 1000);
  assert.strictEqual(giorni, 8);
});

/* ---------- La barra segue la scheda attiva, sempre ---------- */
/* Con Antigravity in primo piano la barra mostrava finestra e settimana di
   Claude: un tipo che lib/usage non sa leggere ripiegava sull'ultimo
   assistente che aveva lavorato. Ora parla della scheda, anche per dire
   «non lo so». */

for (const type of ['antigravity', 'copilot']) {
  ok(`collect: con ${type} in primo piano la finestra non parla di un altro assistente`, async () => {
    const u = await collectUsage({ now: NOW, collectors, tab: { type } });
    assert.strictEqual(u.block.source, type);
    assert.strictEqual(u.block.ratio, null, 'nessuna percentuale inventata');
    assert.strictEqual(u.rateLimits, null, 'niente quota settimanale di Codex o Claude');
  });

  ok(`collect: ${type} si dichiara non supportato, con il motivo`, async () => {
    const u = await collectUsage({ now: NOW, collectors, tab: { type } });
    assert.strictEqual(u.sources[type].supported, false);
    assert.ok(u.sources[type].error.length > 0);
  });
}

ok('collect: con opencode in primo piano la settimana non e quella di Codex', async () => {
  const u = await collectUsage({ now: NOW, collectors, tab: { type: 'opencode' } });
  assert.strictEqual(u.block.source, 'opencode');
  assert.strictEqual(u.rateLimits, null);
});

ok('collect: con Codex in primo piano la settimana resta quella di Codex', async () => {
  const u = await collectUsage({ now: NOW, collectors, tab: { type: 'codex' } });
  assert.strictEqual(u.block.source, 'codex');
  assert.strictEqual(u.rateLimits.weekly.usedPercent, 12.5);
});

ok('collect: senza scheda (o remota) la barra resta vuota invece di parlare dell ultimo assistente', async () => {
  const u = await collectUsage({ now: NOW, collectors, tab: null });
  assert.strictEqual(u.block.source, null);
  assert.strictEqual(u.block.ratio, null);
  assert.strictEqual(u.rateLimits, null);
  assert.strictEqual(u.week.totals.count, 3, 'i totali per il tooltip restano');
});
