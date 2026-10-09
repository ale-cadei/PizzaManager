// renderer/update-banner.js sul DOM finto: cosa appare in ogni stato e cosa
// fanno i tasti. Le regole su CHI puo' aggiornarsi stanno in update-policy.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { installDocument, createElement, descendants, fire } = require('./fake-dom');

function monta() {
  const uninstall = installDocument();
  const host = createElement('div');
  const applicati = [];
  const scartati = [];
  const { createUpdateBanner } = require('../renderer/update-banner');
  const banner = createUpdateBanner({ host, onApply: () => applicati.push(1), onDismiss: () => scartati.push(1) });
  const testo = () => descendants(host).map((e) => e.textContent).filter(Boolean).join(' | ');
  const tasto = (etichetta) => descendants(host).find((e) => e.tag === 'button' && e.textContent.includes(etichetta));
  return { banner, host, testo, tasto, applicati, scartati, uninstall };
}

ok('banner: senza aggiornamenti non si vede niente', () => {
  const t = monta();
  t.banner.render(null);
  assert.strictEqual(t.host.children.length, 0, 'nessun elemento quando non c e nulla da dire');
  t.uninstall();
});

ok('banner: mentre scarica dice la percentuale e non offre il riavvio', () => {
  const t = monta();
  t.banner.render({ state: 'downloading', message: 'Sto scaricando la versione 1.2.0… 42%', action: null, percent: 42 });
  assert.match(t.testo(), /1\.2\.0/);
  assert.match(t.testo(), /42/);
  assert.strictEqual(t.tasto('Riavvia'), undefined, 'il file non c e ancora: niente da riavviare');
  t.uninstall();
});

ok('banner: pronto offre il riavvio, e il tasto chiama chi installa', () => {
  const t = monta();
  t.banner.render({ state: 'ready', message: 'La versione 1.2.0 è pronta', action: 'restart', version: '1.2.0' });
  const b = t.tasto('Riavvia');
  assert.ok(b, 'manca il tasto per riavviare');
  fire(b, 'click');
  assert.strictEqual(t.applicati.length, 1);
  t.uninstall();
});

ok('banner: «Più tardi» lo fa sparire e avvisa chi lo ha mostrato', () => {
  const t = monta();
  t.banner.render({ state: 'ready', message: 'La versione 1.2.0 è pronta', action: 'restart', version: '1.2.0' });
  const dopo = t.tasto('tardi');
  assert.ok(dopo, 'manca il tasto per rimandare');
  fire(dopo, 'click');
  assert.strictEqual(t.scartati.length, 1);
  t.uninstall();
});

ok('banner: in modalita manuale il tasto porta al download, non al riavvio', () => {
  const t = monta();
  t.banner.render({ state: 'ready', message: 'È disponibile la versione 1.2.0', action: 'download', version: '1.2.0' });
  assert.strictEqual(t.tasto('Riavvia'), undefined);
  const b = t.tasto('Scarica');
  assert.ok(b, 'manca il tasto per scaricare');
  fire(b, 'click');
  assert.strictEqual(t.applicati.length, 1, 'anche qui decide il main: apre la pagina');
  t.uninstall();
});

ok('banner: un errore si legge e si puo chiudere', () => {
  const t = monta();
  t.banner.render({ state: 'error', message: 'Aggiornamento non riuscito: rete non raggiungibile', action: null });
  assert.match(t.testo(), /rete non raggiungibile/);
  assert.ok(t.tasto('tardi'), 'anche un errore si deve poter togliere di mezzo');
  t.uninstall();
});

ok('banner: il testo arriva da fuori e non passa da innerHTML', () => {
  const t = monta();
  // Le note di rilascio vengono da GitHub: sono dati esterni, e nella pagina
  // ci entrano con textContent (regola di CLAUDE.md).
  t.banner.render({ state: 'ready', message: '<img src=x onerror=alert(1)> 1.2.0', action: 'restart' });
  const html = descendants(t.host).map((e) => e.innerHTML).join('');
  assert.strictEqual(html, '', 'nessun innerHTML usato');
  assert.match(t.testo(), /<img src=x/, 'il testo resta testo');
  t.uninstall();
});

ok('banner: due render di seguito non accumulano elementi', () => {
  const t = monta();
  t.banner.render({ state: 'downloading', message: 'a', action: null, percent: 1 });
  t.banner.render({ state: 'downloading', message: 'b', action: null, percent: 2 });
  t.banner.render({ state: 'ready', message: 'c', action: 'restart' });
  assert.strictEqual(t.host.children.length, 1, 'un banner solo, non tre');
  t.uninstall();
});
