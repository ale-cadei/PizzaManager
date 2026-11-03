// lib/update-policy.js: chi può aggiornarsi da sé e chi no, e cosa dire.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { updateMode, bannerText, isNoUpdateError, DOWNLOAD_URL, CHECK_EVERY_MS } = require('../lib/update-policy');

// Un pacchetto che viene da una release: e' il marcatore che il workflow
// scrive al build (`extraMetadata.buildFrom`).
const pacchetto = (extra = {}) => ({ isPackaged: true, buildFrom: 'release', ...extra });

ok('in sviluppo non si aggiorna niente', () => {
  // Con `npm start` il codice E' gia' quello corrente, e manca app-update.yml:
  // provarci darebbe solo errori nella console a ogni avvio.
  assert.strictEqual(updateMode({ platform: 'darwin', isPackaged: false }), 'off');
  assert.strictEqual(updateMode({ platform: 'linux', isPackaged: false, appImage: '/x.AppImage' }), 'off');
});

ok('una build fatta a mano non si aggiorna da se', () => {
  // `npm run install:mac` produce un'app installata come le altre: isPackaged
  // e' true e non basta a distinguerla. Senza il marcatore del workflow,
  // l'aggiornamento sostituirebbe la build che si sta provando con l'ultima
  // pubblicata — e `autoInstallOnAppQuit` lo farebbe alla chiusura, anche
  // dopo aver premuto «Più tardi».
  assert.strictEqual(updateMode({ platform: 'darwin', isPackaged: true }), 'off');
  assert.strictEqual(updateMode({ platform: 'darwin', isPackaged: true, buildFrom: 'locale' }), 'off');
  assert.strictEqual(updateMode({ platform: 'linux', isPackaged: true, appImage: '/x.AppImage' }), 'off');
  // Il marcatore vale solo esatto: un valore qualsiasi non apre la porta.
  assert.strictEqual(updateMode({ platform: 'darwin', isPackaged: true, buildFrom: 'Release' }), 'off');
});

ok('macOS e Windows si aggiornano da se', () => {
  assert.strictEqual(updateMode(pacchetto({ platform: 'darwin' })), 'auto');
  assert.strictEqual(updateMode(pacchetto({ platform: 'win32' })), 'auto');
});

ok('su Linux solo l AppImage: il .deb lo gestisce apt', () => {
  assert.strictEqual(updateMode(pacchetto({ platform: 'linux', appImage: '/home/x/PizzaManager.AppImage' })), 'auto');
  // Senza la variabile APPIMAGE l'app non gira da un'AppImage: electron-updater
  // non sa dove scrivere e darebbe errore. Si avvisa e si manda al download.
  assert.strictEqual(updateMode(pacchetto({ platform: 'linux' })), 'manual');
  assert.strictEqual(updateMode(pacchetto({ platform: 'linux', appImage: '' })), 'manual');
});

ok('il banner dice la versione, e cosa succede premendo', () => {
  const pronto = bannerText({ state: 'ready', version: '1.2.0' });
  assert.match(pronto.message, /1\.2\.0/);
  assert.strictEqual(pronto.action, 'restart');
  const manuale = bannerText({ state: 'ready', version: '1.2.0', mode: 'manual' });
  assert.strictEqual(manuale.action, 'download', 'in modalita manuale il tasto porta al download');
  assert.match(manuale.message, /1\.2\.0/);
});

ok('durante lo scaricamento il banner non offre il riavvio', () => {
  const giu = bannerText({ state: 'downloading', version: '1.2.0', percent: 42 });
  assert.strictEqual(giu.action, null, 'non c e niente da riavviare: il file non c e ancora');
  assert.match(giu.message, /42/);
});

ok('un errore si dice, senza spaventare', () => {
  const e = bannerText({ state: 'error', error: 'rete non raggiungibile' });
  assert.match(e.message, /rete non raggiungibile/);
  assert.strictEqual(e.action, null);
});

ok('senza versione il banner non si mostra', () => {
  assert.strictEqual(bannerText({ state: 'ready' }), null);
  assert.strictEqual(bannerText({ state: 'downloading' }), null);
  assert.strictEqual(bannerText({ state: 'idle', version: '1.2.0' }), null);
});

ok('i valori fissi sono quelli decisi', () => {
  assert.match(DOWNLOAD_URL, /^https:\/\/github\.com\/ale-cadei\/PizzaManager/);
  assert.strictEqual(CHECK_EVERY_MS, 4 * 60 * 60 * 1000, 'ogni 4 ore');
});

// Una release può uscire senza Windows (piano 81): i test Windows erano rossi
// su quel commit. Allora nella release più recente manca latest.yml, e
// electron-updater lo dice con un errore. Per chi usa Windows non è un guasto:
// è «nessun aggiornamento», resta sulla versione che ha.
const senzaLatestYml = () => Object.assign(
  new Error('Cannot find latest.yml in the latest release artifacts (https://github.com/ale-cadei/PizzaManager/releases/download/v1.8.0/latest.yml): HttpError: 404'),
  { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' },
);

ok('su Windows una release senza latest.yml vuol dire nessun aggiornamento', () => {
  assert.strictEqual(isNoUpdateError({ platform: 'win32', error: senzaLatestYml() }), true);
  // Conta il messaggio: il codice è lo stesso per il manifesto di ogni sistema.
  const soloMessaggio = new Error('Cannot find latest.yml in the latest release artifacts (…): 404');
  assert.strictEqual(isNoUpdateError({ platform: 'win32', error: soloMessaggio }), true);
});

ok('su macOS e Linux un manifesto mancante resta un errore', () => {
  // Mac e Linux escono a ogni release: se il loro manifesto manca la release
  // è rotta, e va detto.
  const macMancante = Object.assign(new Error('Cannot find latest-mac.yml in the latest release artifacts'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' });
  assert.strictEqual(isNoUpdateError({ platform: 'darwin', error: macMancante }), false);
  assert.strictEqual(isNoUpdateError({ platform: 'linux', error: macMancante }), false);
  assert.strictEqual(isNoUpdateError({ platform: 'darwin', error: senzaLatestYml() }), false);
});

ok('su Windows gli altri errori si mostrano ancora', () => {
  const rete = Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), { code: 'ERR_INTERNET_DISCONNECTED' });
  const nessunaRelease = Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' });
  const firma = Object.assign(new Error('New version 1.8.0 is not signed by the application owner'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' });
  for (const error of [rete, nessunaRelease, firma]) {
    assert.strictEqual(isNoUpdateError({ platform: 'win32', error }), false, error.message);
  }
  assert.strictEqual(isNoUpdateError({ platform: 'win32', error: null }), false);
  assert.strictEqual(isNoUpdateError({ platform: 'win32', error: 'stringa qualsiasi' }), false);
});
