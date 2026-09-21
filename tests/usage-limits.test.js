const assert = require('node:assert');
const { test: ok } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Lo store dei tetti osservati: il denominatore della barra della finestra di
 * 5 ore vive qui fra un avvio e l'altro (docs/plans/15-quota-token-5h.md).
 * Come gli altri store, la cartella arriva dalla factory: qui una tmpdir. */

const { createUsageLimitsStore, LIMITS_FILE } = require('../lib/usage/usage-limits');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-limits-'));
  return { dir, store: createUsageLimitsStore({ dir }) };
}

ok('usage-limits: senza directory non si costruisce', () => {
  assert.throws(() => createUsageLimitsStore({}), /directory/i);
});

ok('usage-limits: senza file i tetti sono vuoti, non un errore', () => {
  const { store } = tmpStore();
  assert.deepStrictEqual(store.peaks(), {});
});

ok('usage-limits: un tetto osservato si salva e si rilegge dopo un riavvio', () => {
  const { dir, store } = tmpStore();
  store.observe({ claude: 8_400_000 }, { now: 1000 });
  assert.deepStrictEqual(store.peaks(), { claude: 8_400_000 });
  const riaperto = createUsageLimitsStore({ dir });
  assert.deepStrictEqual(riaperto.peaks(), { claude: 8_400_000 });
  assert.ok(fs.existsSync(path.join(dir, LIMITS_FILE)));
});

ok('usage-limits: il tetto sale e non scende', () => {
  const { store } = tmpStore();
  store.observe({ claude: 8_400_000 }, { now: 1000 });
  // Una settimana dopo la lettura copre solo finestre piu piccole: il massimo
  // storico non va perso, altrimenti la percentuale si gonfierebbe da sola.
  const dopo = store.observe({ claude: 1_000_000 }, { now: 2000 });
  assert.deepStrictEqual(dopo, { claude: 8_400_000 });
});

ok('usage-limits: ogni assistente ha la sua riga', () => {
  const { store } = tmpStore();
  store.observe({ claude: 500, codex: 300 }, { now: 1000 });
  store.observe({ codex: 900, opencode: 10 }, { now: 2000 });
  assert.deepStrictEqual(store.peaks(), { claude: 500, codex: 900, opencode: 10 });
});

ok('usage-limits: si annota quando il massimo e stato visto, per il tooltip', () => {
  const { store } = tmpStore();
  store.observe({ claude: 500 }, { now: 111 });
  store.observe({ claude: 900 }, { now: 222 });
  assert.strictEqual(store.read().claude.observedAt, 222);
  store.observe({ claude: 400 }, { now: 333 });
  assert.strictEqual(store.read().claude.observedAt, 222, 'la data e quella del massimo, non dell ultimo giro');
});

ok('usage-limits: niente scrittura se nessun tetto e cresciuto', () => {
  const { dir, store } = tmpStore();
  store.observe({ claude: 500 }, { now: 1000 });
  const file = path.join(dir, LIMITS_FILE);
  const prima = fs.statSync(file).mtimeMs;
  fs.utimesSync(file, new Date(0), new Date(0)); // segna il file come "vecchio"
  store.observe({ claude: 400 }, { now: 2000 });
  assert.strictEqual(fs.statSync(file).mtimeMs, 0, 'il file non e stato riscritto');
  assert.ok(prima >= 0);
});

ok('usage-limits: valori assurdi non entrano nel file', () => {
  const { store } = tmpStore();
  store.observe({
    claude: 0,
    codex: -5,
    opencode: Number.POSITIVE_INFINITY,
    strano: 'molto',
    'nome/sporco': 100,
  }, { now: 1000 });
  assert.deepStrictEqual(store.peaks(), {});
});

ok('usage-limits: un file corrotto non fa saltare la barra', () => {
  const { dir, store } = tmpStore();
  fs.writeFileSync(path.join(dir, LIMITS_FILE), '{ questo non e json');
  assert.deepStrictEqual(store.peaks(), {});
  store.observe({ claude: 700 }, { now: 1000 });
  assert.deepStrictEqual(store.peaks(), { claude: 700 }, 'si riparte da capo invece di restare rotti');
});

ok('usage-limits: un file con dentro spazzatura si filtra riga per riga', () => {
  const { dir, store } = tmpStore();
  fs.writeFileSync(path.join(dir, LIMITS_FILE), JSON.stringify({
    version: 1,
    sources: { claude: { fiveHourPeak: 900 }, codex: { fiveHourPeak: 'tanti' }, nulla: null },
  }));
  assert.deepStrictEqual(store.peaks(), { claude: 900 });
});
