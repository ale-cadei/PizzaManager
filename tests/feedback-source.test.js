// lib/feedback-source.js: come si legge la bacheca e come si compongono gli
// indirizzi per aprirla su GitHub. Nessuna rete: il feed arriva come testo.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { parseFeed, createUrl, issueUrl, REPO } = require('../lib/feedback-source');

const voce = (n, extra = {}) => ({
  numero: n, titolo: `voce ${n}`, autore: 'tizio', voti: 0,
  stato: 'aperta', tipo: 'richiesta', url: `https://x/${n}`, creata: '2026-10-01T00:00:00Z', ...extra,
});
const feed = (voci) => JSON.stringify({ generato: '2026-10-09T10:00:00Z', voci });

ok('il feed si legge e le voci restano quelle', () => {
  const r = parseFeed(feed([voce(1), voce(2)]));
  assert.strictEqual(r.voci.length, 2);
  assert.strictEqual(r.generato, '2026-10-09T10:00:00Z');
});

ok('un feed rotto non fa cadere il pannello', () => {
  // Il file lo genera un'Action: se un giorno sbaglia, meglio una bacheca
  // vuota che una finestra bianca.
  for (const brutto of ['', 'non json', '{}', '{"voci":null}', '[]', null, undefined]) {
    const r = parseFeed(brutto);
    assert.deepStrictEqual(r.voci, [], JSON.stringify(brutto));
  }
});

ok('le voci senza i campi minimi si scartano, le altre no', () => {
  const r = parseFeed(feed([{ titolo: 'senza numero' }, voce(3), { numero: 4 }]));
  assert.deepStrictEqual(r.voci.map((v) => v.numero), [3], 'serve numero E titolo');
});

ok('gli stati sono quelli delle etichette del repo, uno sconosciuto torna «aperta»', () => {
  // Il vocabolario e' condiviso col repo pubblico: un'etichetta che l'app non
  // conosce la renderebbe una riga aperta come le altre, che continua a
  // raccogliere voti. Per questo sul repo ci sono solo queste (piano 50).
  const { STATI } = require('../lib/feedback-source');
  assert.deepStrictEqual(STATI, ['aperta', 'pianificato', 'in-corso', 'completato', 'non-lo-faremo']);
  const r = parseFeed(feed([voce(1, { stato: 'non-lo-faremo' }), voce(2, { stato: 'bloccato-da-qualcuno' })]));
  assert.strictEqual(r.voci[0].stato, 'non-lo-faremo');
  assert.strictEqual(r.voci[1].stato, 'aperta', 'uno stato inventato non deve passare');
});

ok('l indirizzo della nuova richiesta porta titolo, corpo e diagnostica', () => {
  const u = new URL(createUrl({ tipo: 'richiesta', titolo: 'Fare X', corpo: 'perche si', diagnostica: 'v1.4.0 · macOS' }));
  assert.ok(u.pathname.startsWith(`/${REPO}/issues/new`), u.pathname);
  assert.strictEqual(u.searchParams.get('title'), 'Fare X');
  assert.match(u.searchParams.get('descrizione'), /perche si/);
  assert.match(u.searchParams.get('ambiente'), /v1\.4\.0 · macOS/, 'la diagnostica deve viaggiare con la segnalazione');
});

ok('i caratteri speciali non rompono l indirizzo', () => {
  // Titolo e corpo li scrive una persona: & # ? accenti e a capo ci finiscono.
  const titolo = 'Crash con & e # e ? perché';
  const corpo = 'riga 1\nriga 2 con "virgolette" e 100%';
  const u = new URL(createUrl({ tipo: 'segnalazione', titolo, corpo, diagnostica: '' }));
  assert.strictEqual(u.searchParams.get('title'), titolo);
  assert.match(u.searchParams.get('descrizione'), /riga 1\nriga 2/);
});

ok('il testo va nei campi del modulo, non in «body» che GitHub butta via', () => {
  // Un modulo .yml si precompila con l'ID dei campi. `body` e' riservato ai
  // template Markdown: su un modulo si apre la pagina col campo vuoto e
  // quello che la persona ha scritto e' perso. Verificato aprendo
  // l'indirizzo (piano 50).
  const u = new URL(createUrl({ tipo: 'segnalazione', titolo: 't', corpo: 'non si chiude', diagnostica: 'PizzaManager 1.5.0' }));
  assert.strictEqual(u.searchParams.get('descrizione'), 'non si chiude');
  assert.strictEqual(u.searchParams.get('ambiente'), 'PizzaManager 1.5.0', 'la diagnostica ha un campo suo');
  assert.strictEqual(u.searchParams.get('body'), null, 'body non arriva: non va usato');
});

ok('senza testo non si mandano campi vuoti', () => {
  const u = new URL(createUrl({ tipo: 'richiesta', titolo: 't' }));
  assert.strictEqual(u.searchParams.get('descrizione'), null);
  assert.strictEqual(u.searchParams.get('ambiente'), null);
});

ok('il tipo sceglie il modulo giusto', () => {
  const r = new URL(createUrl({ tipo: 'richiesta', titolo: 't', corpo: '', diagnostica: '' }));
  const s = new URL(createUrl({ tipo: 'segnalazione', titolo: 't', corpo: '', diagnostica: '' }));
  assert.strictEqual(r.searchParams.get('template'), 'richiesta.yml');
  assert.strictEqual(s.searchParams.get('template'), 'segnalazione.yml');
});

ok('il voto porta alla issue: da un link non si puo reagire', () => {
  assert.strictEqual(issueUrl(12), `https://github.com/${REPO}/issues/12`);
  assert.strictEqual(issueUrl(null), null, 'senza numero non c e dove andare');
});
