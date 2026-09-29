// renderer/pets-config.js: impostazioni degli animaletti, validate e ricordate
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { DEFAULTS, MAX_CAST, sanitizeConfig, createPetsStore, STORAGE_KEY } = require('../renderer/pets-config');
const { createStorage } = require('./fake-dom');
const { CAST } = require('../renderer/pets-sprites');

ok('pets-config: spenti di default, con il pescatore e la medusa', () => {
  assert.deepStrictEqual(DEFAULTS, { enabled: false, cast: ['inseguimento'], size: 'm', speed: 'normale' });
});

ok('pets-config: JSON rotto, null o tipi sbagliati tornano al default', () => {
  for (const raw of ['{rotto', null, undefined, 42, '[]', '"x"']) {
    assert.deepStrictEqual(sanitizeConfig(raw), DEFAULTS, `input ${String(raw)}`);
  }
});

ok('pets-config: tiene i campi validi e rimette gli altri al default', () => {
  const cfg = sanitizeConfig({ enabled: 'si', cast: ['lumaca', 'drago', 7, 'gatto'], size: 'xl', speed: 'veloce' });
  assert.deepStrictEqual(cfg, { enabled: false, cast: ['lumaca', 'gatto'], size: 'm', speed: 'veloce' });
  assert.deepStrictEqual(sanitizeConfig(JSON.stringify({ enabled: true, size: 'l' })),
    { enabled: true, cast: ['inseguimento'], size: 'l', speed: 'normale' });
});

ok('pets-config: il limite conta le voci del dialogo, la coppia vale una', () => {
  const oneEach = Object.keys(CAST);
  assert.strictEqual(MAX_CAST, oneEach.length);
  assert.deepStrictEqual(sanitizeConfig({ cast: oneEach }).cast, oneEach, 'uno di ognuno ci deve stare');
  assert.deepStrictEqual(sanitizeConfig({ cast: [...oneEach, 'gatto', 'inseguimento'] }).cast, oneEach, 'oltre MAX_CAST si tronca dalla fine');
});

ok('pets-config: un cast vuoto resta vuoto (nessun animale, striscia vuota)', () => {
  assert.deepStrictEqual(sanitizeConfig({ cast: [] }).cast, []);
});

ok('pets-config: lo store salva, rilegge e non si fida di quello che trova', () => {
  const storage = createStorage();
  const store = createPetsStore(storage);
  assert.deepStrictEqual(store.get(), DEFAULTS);
  const saved = store.save({ enabled: true, cast: ['stella'], size: 's', speed: 'lenta' });
  assert.deepStrictEqual(saved, { enabled: true, cast: ['stella'], size: 's', speed: 'lenta' });
  assert.deepStrictEqual(createPetsStore(storage).get(), saved);
  storage.setItem(STORAGE_KEY, '{"cast":["drago"]}');
  assert.deepStrictEqual(createPetsStore(storage).get().cast, []);
});

ok('pets-config: uno storage che lancia non rompe niente', () => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  const store = createPetsStore(broken);
  assert.deepStrictEqual(store.get(), DEFAULTS);
  assert.strictEqual(store.save({ enabled: true }).enabled, true);
  assert.strictEqual(store.get().enabled, true);
});
