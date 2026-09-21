const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Un'app avviata dal Finder o dal menu non ha LANG: la shell nei terminali
   partirebbe in locale C e ogni carattere non ASCII (è, →, i glifi dei
   prompt) diventerebbe un `_`. Da `npm start` il problema non si vede perché
   la shell di sviluppo la eredita: è il classico bug che compare solo
   nell'app installata. */
const { ensureUtf8Locale, localeName } = require('../lib/locale');

const AVAILABLE = ['C', 'POSIX', 'en_US.UTF-8', 'it_IT.UTF-8', 'C.UTF-8'];
const opts = { platform: 'darwin', systemLocale: 'it-IT', available: () => AVAILABLE };

ok('locale: senza LANG si imposta la lingua di sistema in UTF-8', () => {
  const env = ensureUtf8Locale({ PATH: '/bin' }, opts);
  assert.strictEqual(env.LANG, 'it_IT.UTF-8');
  assert.strictEqual(env.PATH, '/bin');
});

ok('locale: un LANG UTF-8 già presente non si tocca', () => {
  const base = { LANG: 'en_GB.UTF-8' };
  const env = ensureUtf8Locale(base, opts);
  assert.strictEqual(env.LANG, 'en_GB.UTF-8');
  assert.notStrictEqual(env, base, 'restituisce un oggetto nuovo, non muta');
});

ok('locale: LC_ALL o LC_CTYPE in UTF-8 bastano, LANG resta come è', () => {
  assert.strictEqual(ensureUtf8Locale({ LC_ALL: 'C.UTF-8' }, opts).LANG, undefined);
  assert.strictEqual(ensureUtf8Locale({ LC_CTYPE: 'en_US.utf8' }, opts).LANG, undefined);
});

ok('locale: se la lingua di sistema non esiste in UTF-8 si ripiega su en_US, poi C.UTF-8', () => {
  const noIt = { ...opts, available: () => ['en_US.UTF-8', 'C.UTF-8'] };
  assert.strictEqual(ensureUtf8Locale({}, noIt).LANG, 'en_US.UTF-8');
  const onlyC = { ...opts, available: () => ['C.UTF-8'] };
  assert.strictEqual(ensureUtf8Locale({}, onlyC).LANG, 'C.UTF-8');
  const nothing = { ...opts, available: () => ['C', 'POSIX'] };
  assert.strictEqual(ensureUtf8Locale({}, nothing).LANG, undefined, 'senza locale UTF-8 non si inventa niente');
});

ok('locale: la lingua di sistema si traduce nel nome POSIX', () => {
  assert.strictEqual(localeName('it-IT'), 'it_IT.UTF-8');
  assert.strictEqual(localeName('en'), 'en_US.UTF-8', 'senza regione si usa quella più diffusa');
  assert.strictEqual(localeName('pt-BR'), 'pt_BR.UTF-8');
  assert.strictEqual(localeName(''), null);
});

ok('locale: su Windows non si fa niente', () => {
  const env = ensureUtf8Locale({}, { ...opts, platform: 'win32' });
  assert.strictEqual(env.LANG, undefined);
});

ok('locale: se `locale -a` fallisce si ripiega su en_US.UTF-8 senza esplodere', () => {
  const env = ensureUtf8Locale({}, { ...opts, available: () => { throw new Error('no'); } });
  assert.strictEqual(env.LANG, 'en_US.UTF-8');
});
