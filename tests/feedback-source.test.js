// lib/feedback-source.js: come si legge la bacheca e come si compongono gli
// indirizzi per aprirla su GitHub. Nessuna rete: il feed arriva come testo.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { parseFeed, createUrl, voteUrl, REPO } = require('../lib/feedback-source');

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

ok('l indirizzo della nuova richiesta porta titolo, corpo e diagnostica', () => {
  const u = new URL(createUrl({ tipo: 'richiesta', titolo: 'Fare X', corpo: 'perche si', diagnostica: 'v1.4.0 · macOS' }));
  assert.ok(u.pathname.startsWith(`/${REPO}/issues/new`), u.pathname);
  assert.strictEqual(u.searchParams.get('title'), 'Fare X');
  const body = u.searchParams.get('body');
  assert.match(body, /perche si/);
  assert.match(body, /v1\.4\.0 · macOS/, 'la diagnostica deve viaggiare con la segnalazione');
});

ok('i caratteri speciali non rompono l indirizzo', () => {
  // Titolo e corpo li scrive una persona: & # ? accenti e a capo ci finiscono.
  const titolo = 'Crash con & e # e ? perché';
  const corpo = 'riga 1\nriga 2 con "virgolette" e 100%';
  const u = new URL(createUrl({ tipo: 'segnalazione', titolo, corpo, diagnostica: '' }));
  assert.strictEqual(u.searchParams.get('title'), titolo);
  assert.match(u.searchParams.get('body'), /riga 1\nriga 2/);
});

ok('il tipo sceglie il modulo giusto', () => {
  const r = new URL(createUrl({ tipo: 'richiesta', titolo: 't', corpo: '', diagnostica: '' }));
  const s = new URL(createUrl({ tipo: 'segnalazione', titolo: 't', corpo: '', diagnostica: '' }));
  assert.strictEqual(r.searchParams.get('template'), 'richiesta.yml');
  assert.strictEqual(s.searchParams.get('template'), 'segnalazione.yml');
});

ok('il voto porta alla issue: da un link non si puo reagire', () => {
  assert.strictEqual(voteUrl(12), `https://github.com/${REPO}/issues/12`);
  assert.strictEqual(voteUrl(null), null, 'senza numero non c e dove andare');
});
