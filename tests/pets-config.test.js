// renderer/pets-config.js: impostazioni degli animaletti, validate e ricordate
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { DEFAULTS, MAX_PETS, castCount, sanitizeConfig, createPetsStore, STORAGE_KEY } = require('../renderer/pets-config');
const { createStorage } = require('./fake-dom');

ok('pets-config: spenti di default, con SpongeBob e la medusa', () => {
  assert.deepStrictEqual(DEFAULTS, { enabled: false, cast: ['inseguimento'], size: 'm', speed: 'normale' });
});

ok('pets-config: JSON rotto, null o tipi sbagliati tornano al default', () => {
  for (const raw of ['{rotto', null, undefined, 42, '[]', '"x"']) {
    assert.deepStrictEqual(sanitizeConfig(raw), DEFAULTS, `input ${String(raw)}`);
  }
});

ok('pets-config: tiene i campi validi e rimette gli altri al default', () => {
  const cfg = sanitizeConfig({ enabled: 'si', cast: ['gary', 'drago', 7, 'gatto'], size: 'xl', speed: 'veloce' });
  assert.deepStrictEqual(cfg, { enabled: false, cast: ['gary', 'gatto'], size: 'm', speed: 'veloce' });
  assert.deepStrictEqual(sanitizeConfig(JSON.stringify({ enabled: true, size: 'l' })),
    { enabled: true, cast: ['inseguimento'], size: 'l', speed: 'normale' });
});

ok('pets-config: la coppia conta due e oltre MAX_PETS si tronca dalla fine', () => {
  assert.strictEqual(castCount(['inseguimento', 'gary']), 3);
  const cfg = sanitizeConfig({ cast: ['gatto', 'inseguimento', 'gary', 'inseguimento', 'pizza'] });
  assert.deepStrictEqual(cfg.cast, ['gatto', 'inseguimento', 'gary', 'pizza']);
  assert.ok(castCount(cfg.cast) <= MAX_PETS);
  // Una coppia che non ci sta non entra, ma chi viene dopo e ci sta sì
  assert.deepStrictEqual(sanitizeConfig({ cast: ['gatto', 'gary', 'pizza', 'patrick', 'inseguimento', 'gatto'] }).cast,
    ['gatto', 'gary', 'pizza', 'patrick', 'gatto']);
});

ok('pets-config: un cast vuoto resta vuoto (nessun animale, striscia vuota)', () => {
  assert.deepStrictEqual(sanitizeConfig({ cast: [] }).cast, []);
});

ok('pets-config: lo store salva, rilegge e non si fida di quello che trova', () => {
  const storage = createStorage();
  const store = createPetsStore(storage);
  assert.deepStrictEqual(store.get(), DEFAULTS);
  const saved = store.save({ enabled: true, cast: ['patrick'], size: 's', speed: 'lenta' });
  assert.deepStrictEqual(saved, { enabled: true, cast: ['patrick'], size: 's', speed: 'lenta' });
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
