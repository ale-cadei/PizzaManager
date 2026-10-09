// renderer/feedback-view.js sul DOM finto: cosa si vede nella bacheca.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { installDocument, createElement, descendants, fire } = require('./fake-dom');
const { renderFeedback, filterBy } = require('../renderer/feedback-view');

// I filtri stanno nel UMD del renderer e non in lib/: la pagina gira
// sandboxed e non puo' require() un modulo di lib/ (regola di CLAUDE.md).

const voce = (n, extra = {}) => ({
  numero: n, titolo: `voce ${n}`, autore: 'tizio', voti: 0,
  stato: 'aperta', tipo: 'richiesta', url: `https://x/${n}`, creata: '2026-10-01T00:00:00Z', ...extra,
});

function monta(voci, extra = {}) {
  const uninstall = installDocument();
  const root = createElement('div');
  const aperte = [];
  renderFeedback(root, { voci, onOpen: (n) => aperte.push(n), ...extra });
  const testo = () => descendants(root).map((e) => e.textContent).filter(Boolean).join(' | ');
  const bottoni = () => descendants(root).filter((e) => e.tag === 'button');
  return { root, testo, bottoni, aperte, uninstall };
}

ok('bacheca: ogni voce mostra titolo, voti e autore', () => {
  const t = monta([voce(1, { titolo: 'Tema chiaro', autore: 'nina', voti: 7 })]);
  assert.match(t.testo(), /Tema chiaro/);
  assert.match(t.testo(), /7/);
  assert.match(t.testo(), /nina/);
  t.uninstall();
});

ok('bacheca: lo stato si vede solo quando c e', () => {
  const con = monta([voce(1, { stato: 'in-corso' })]);
  assert.match(con.testo(), /corso/i);
  con.uninstall();
  const senza = monta([voce(2, { stato: 'aperta' })]);
  assert.ok(!/corso|completato|pianificato/i.test(senza.testo()), 'una voce aperta non ha etichetta');
  senza.uninstall();
});

ok('bacheca: il voto chiama chi apre la issue, col numero giusto', () => {
  const t = monta([voce(5), voce(9)]);
  const b = t.bottoni().find((x) => x.attrs['data-numero'] === '9');
  assert.ok(b, 'manca il pulsante di voto');
  fire(b, 'click');
  assert.deepStrictEqual(t.aperte, [9]);
  t.uninstall();
});

ok('bacheca: il voto dice che apre GitHub, non finge di votare', () => {
  // Da un link non si puo' aggiungere una reazione: il pulsante porta alla
  // issue e la persona preme 👍 li'. Nasconderlo sarebbe una bugia.
  const t = monta([voce(1)]);
  const b = t.bottoni().find((x) => x.attrs['data-numero'] === '1');
  assert.match(String(b.title || ''), /GitHub/i, 'il titolo del pulsante deve dirlo');
  t.uninstall();
});

ok('bacheca: anche il titolo apre la issue, non solo il riquadro del voto', () => {
  // Chi vuole leggere una segnalazione non deve premere «vota» (piano 50).
  const t = monta([voce(5), voce(9)]);
  const corpo = t.bottoni().filter((x) => x.className.includes('fb-corpo'));
  assert.strictEqual(corpo.length, 2, 'il corpo della riga non è cliccabile');
  fire(corpo.find((x) => x.attrs['data-numero'] === '9'), 'click');
  assert.deepStrictEqual(t.aperte, [9], 'porta alla issue sbagliata');
  assert.match(String(corpo[0].title || ''), /GitHub/i);
  t.uninstall();
});

ok('bacheca: la riga dice se è un problema o una richiesta', () => {
  // Il tipo arriva fin qui dall'etichetta della issue: se non finisce nel
  // DOM, il filo colorato non può esistere.
  const t = monta([voce(1, { tipo: 'segnalazione' }), voce(2, { tipo: 'richiesta' })]);
  const righe = descendants(t.root).filter((e) => e.className.includes('fb-voce'));
  assert.deepStrictEqual(righe.map((r) => r.className.includes('tipo-segnalazione')), [true, false]);
  assert.deepStrictEqual(righe.map((r) => r.className.includes('tipo-richiesta')), [false, true]);
  t.uninstall();
});

ok('bacheca vuota: lo dice invece di restare bianca', () => {
  const t = monta([]);
  assert.ok(t.testo().length > 0, 'una finestra vuota sembra rotta');
  t.uninstall();
});

ok('bacheca: un errore di rete si legge, e le voci vecchie restano', () => {
  const t = monta([voce(1, { titolo: 'vecchia' })], { errore: 'rete non raggiungibile' });
  assert.match(t.testo(), /rete non raggiungibile/);
  assert.match(t.testo(), /vecchia/, 'meglio dati vecchi che niente');
  t.uninstall();
});

ok('bacheca: il testo arriva da estranei e non passa da innerHTML', () => {
  const t = monta([voce(1, { titolo: '<img src=x onerror=alert(1)>', autore: '<b>x</b>' })]);
  const html = descendants(t.root).map((e) => e.innerHTML).join('');
  assert.strictEqual(html, '', 'nessun innerHTML');
  assert.match(t.testo(), /<img src=x/, 'il testo resta testo');
  t.uninstall();
});

ok('bacheca: due render non accumulano voci', () => {
  const uninstall = installDocument();
  const root = createElement('div');
  renderFeedback(root, { voci: [voce(1), voce(2)] });
  renderFeedback(root, { voci: [voce(3)] });
  const titoli = descendants(root).map((e) => e.textContent).filter((x) => /^voce /.test(x));
  assert.deepStrictEqual(titoli, ['voce 3']);
  uninstall();
});

ok('di tendenza: piu votate in cima, a parita la piu recente', () => {
  const r = filterBy([
    voce(1, { voti: 2, creata: '2026-10-01T00:00:00Z' }),
    voce(2, { voti: 9 }),
    voce(3, { voti: 2, creata: '2026-10-05T00:00:00Z' }),
  ], 'tendenza');
  assert.deepStrictEqual(r.map((v) => v.numero), [2, 3, 1]);
});

ok('recenti: per data, indipendentemente dai voti', () => {
  const r = filterBy([
    voce(1, { voti: 99, creata: '2026-10-01T00:00:00Z' }),
    voce(2, { voti: 0, creata: '2026-10-08T00:00:00Z' }),
  ], 'recenti');
  assert.deepStrictEqual(r.map((v) => v.numero), [2, 1]);
});

ok('pianificato e rilasciate mostrano solo il loro stato', () => {
  const tutte = [voce(1), voce(2, { stato: 'pianificato' }), voce(3, { stato: 'in-corso' }), voce(4, { stato: 'completato' })];
  assert.deepStrictEqual(filterBy(tutte, 'pianificato').map((v) => v.numero), [2, 3], 'in corso e gia pianificato');
  assert.deepStrictEqual(filterBy(tutte, 'rilasciate').map((v) => v.numero), [4]);
  assert.deepStrictEqual(filterBy(tutte, 'tendenza').map((v) => v.numero).sort(), [1, 2, 3, 4]);
});

ok('una linguetta sconosciuta non nasconde tutto', () => {
  const tutte = [voce(1), voce(2)];
  assert.strictEqual(filterBy(tutte, 'inventata').length, 2, 'meglio mostrare tutto che una lista vuota');
  assert.strictEqual(filterBy(null, 'tendenza').length, 0);
});
