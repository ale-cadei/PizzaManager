// scripts/notarize-dmg.js: il controllo sul verdetto di Gatekeeper e la scelta
// delle credenziali. Il giro vero (firma, invio ad Apple, francobollo) si prova
// solo costruendo, e sta in docs/plans/44-release-firmata.md.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { isAccepted, notaryArgs } = require('../scripts/notarize-dmg.js');

ok('accettato solo se Gatekeeper accetta E il pacchetto e notarizzato', () => {
  assert.strictEqual(isAccepted(
    'dist/PizzaManager-mac-arm64.dmg: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Giacomo Grieco (CBRAP62CDG)',
  ), true);
});

ok('i casi che ci sono sfuggiti davvero vengono respinti', () => {
  // Il contenitore nudo: l'app dentro era perfetta, il dmg senza firma.
  assert.strictEqual(isAccepted('dist/x.dmg: rejected\nsource=no usable signature'), false);
  // Notarizzato ma con firma adhoc: Gatekeeper non ha un'identita da verificare.
  assert.strictEqual(isAccepted('dist/x.dmg: rejected\nsource=Unnotarized Developer ID'), false);
  // Firmato col certificato di sviluppo: valido, ma non per distribuire.
  assert.strictEqual(isAccepted('dist/x.app: rejected\norigin=Apple Development: Giacomo Grieco'), false);
});

ok('una stringa vuota non passa: era il difetto del primo tentativo', () => {
  // spctl scrive su stderr: leggendo solo stdout il verdetto era vuoto, e un
  // controllo che approva il vuoto non e un controllo.
  for (const v of ['', '   ', '\n']) assert.strictEqual(isAccepted(v), false, JSON.stringify(v));
});

ok('«accepted» dentro un altro discorso non basta', () => {
  assert.strictEqual(isAccepted('submission accepted by Apple'), false, 'serve il verdetto di spctl, non una parola qualsiasi');
  assert.strictEqual(isAccepted('dist/x.dmg: accepted'), false, 'senza source=Notarized il francobollo potrebbe mancare');
});

ok('le credenziali seguono la precedenza di electron-builder', () => {
  const key = { APPLE_API_KEY: '/k.p8', APPLE_API_KEY_ID: 'K1', APPLE_API_ISSUER: 'I1' };
  const pwd = { APPLE_ID: 'a@b.it', APPLE_APP_SPECIFIC_PASSWORD: 'x-y-z-w', APPLE_TEAM_ID: 'T1' };
  assert.deepStrictEqual(notaryArgs(key), ['--key', '/k.p8', '--key-id', 'K1', '--issuer', 'I1']);
  assert.deepStrictEqual(notaryArgs(pwd), ['--apple-id', 'a@b.it', '--password', 'x-y-z-w', '--team-id', 'T1']);
  // La chiave API vince: e' quella consigliata, e il giorno in cui Apple la
  // concede non si deve togliere niente perche' venga usata.
  assert.deepStrictEqual(notaryArgs({ ...pwd, ...key }).slice(0, 2), ['--key', '/k.p8']);
  assert.deepStrictEqual(notaryArgs({ APPLE_KEYCHAIN_PROFILE: 'p' }), ['--keychain-profile', 'p']);
  // Credenziali incomplete non valgono: meglio saltare che fallire a meta'.
  assert.strictEqual(notaryArgs({ APPLE_API_KEY: '/k.p8' }), null);
  assert.strictEqual(notaryArgs({ APPLE_ID: 'a@b.it' }), null);
  assert.strictEqual(notaryArgs({}), null);
});
