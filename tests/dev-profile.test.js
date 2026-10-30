const assert = require('node:assert');
const { test: ok } = require('node:test');
const { devProfile: profileOf } = require('../lib/dev-profile');

const devProfile = (env) => profileOf(env, 'AISessionManager');

/* Istanza di prova (AISESS_PROFILE): cartella dei dati e socket tmux suoi,
   così non tocca le sessioni e i dati dell'app installata. */

ok('devProfile: senza variabile i nomi di sempre', () => {
  assert.deepStrictEqual(devProfile({}), { name: null, userDataDir: 'AISessionManager', socket: 'aisession' });
  assert.deepStrictEqual(devProfile({ AISESS_PROFILE: '' }), { name: null, userDataDir: 'AISessionManager', socket: 'aisession' });
});

ok('devProfile: con un nome, cartella e socket separati', () => {
  assert.deepStrictEqual(devProfile({ AISESS_PROFILE: 'prova' }), { name: 'prova', userDataDir: 'AISessionManager-prova', socket: 'aisession-prova' });
  assert.deepStrictEqual(devProfile({ AISESS_PROFILE: 'editor-1c' }).socket, 'aisession-editor-1c');
});

ok('devProfile: un nome che potrebbe uscire dalla cartella o dal socket si rifiuta', () => {
  for (const bad of ['../x', 'a/b', 'a b', 'x'.repeat(33), '-x', 'a;rm']) {
    assert.throws(() => devProfile({ AISESS_PROFILE: bad }), /AISESS_PROFILE/, bad);
  }
});
