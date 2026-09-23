/* Quando una card deve (e soprattutto: quando NON deve) lampeggiare.
 * Il difetto che ha fatto nascere il modulo: una sessione già guardata
 * ricominciava a lampeggiare appena l'utente passava a un'altra scheda. */
const { test } = require('node:test');
const assert = require('node:assert');
const { createAttention } = require('../renderer/attention.js');

/** Orologio finto: i tempi sono la sostanza della regola, non un dettaglio. */
function clock(start = 1000) {
  let t = start;
  return { now: () => t, avanza: (ms) => { t += ms; } };
}

/** Una raffica di output lunga `durata`, poi il flusso si ferma. */
function raffica(att, id, c, { bytes = 4000, durata = 3000 } = {}) {
  att.data(id, bytes / 2);
  c.avanza(durata);
  att.data(id, bytes / 2);
  c.avanza(1500); // l'idle timer del renderer
  return att.idle(id);
}

test('lavoro vero su una scheda in secondo piano: la card si accende', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  assert.equal(raffica(att, 'a', c), true);
  assert.equal(att.isFlagged('a'), true);
});

test('un frammento breve non è un lavoro: nessun lampeggio', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  // 6 KB tutti insieme: tanti byte, ma in 200 ms — è la TUI che si ridisegna
  assert.equal(raffica(att, 'a', c, { bytes: 6000, durata: 200 }), false);
  assert.equal(att.isFlagged('a'), false);
});

test('poco output non basta comunque', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  assert.equal(raffica(att, 'a', c, { bytes: 10, durata: 5000 }), false);
});

test('il difetto: vista e poi lasciata, il ridisegno non la riaccende', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  raffica(att, 'a', c);            // ha finito, lampeggia
  att.seen('a');                   // l'utente ci clicca sopra e legge
  c.avanza(8000);
  att.left('a');                   // passa a un'altra sessione
  // La coda del ridisegno provocato dal refit arriva ora: kilobyte, ma è roba
  // che l'utente ha appena guardato.
  assert.equal(raffica(att, 'a', c, { bytes: 9000, durata: 300 }), false);
  assert.equal(att.isFlagged('a'), false);
});

test('anche molto dopo, un frammento isolato non riaccende una scheda già vista', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.seen('a');
  att.left('a');
  c.avanza(60000); // la finestra di silenzio è finita da un pezzo
  assert.equal(raffica(att, 'a', c, { bytes: 5000, durata: 400 }), false);
});

test('se l’utente ha scritto lì, anche una risposta breve va segnalata', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.seen('a');
  att.typed('a');   // ha battuto un prompt
  att.left('a');    // e si è spostato subito
  assert.equal(raffica(att, 'a', c, { bytes: 200, durata: 100 }), true);
});

test('una sessione lasciata mentre lavora si accende quando finisce', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.seen('a');
  att.left('a');    // l'utente sbircia e se ne va: la sessione sta lavorando
  // il flusso continua ben oltre la finestra di silenzio
  assert.equal(raffica(att, 'a', c, { bytes: 20000, durata: 12000 }), true);
});

test('il bell vale subito, ma non dentro la finestra di silenzio', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.seen('a');
  att.left('a');
  assert.equal(att.bell('a'), false, 'il bell del ridisegno non conta');
  c.avanza(5000);
  assert.equal(att.bell('a'), true);
  assert.equal(att.isFlagged('a'), true);
});

test('già accesa: non si riaccende (niente render inutili)', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  assert.equal(raffica(att, 'a', c), true);
  assert.equal(raffica(att, 'a', c), false);
});

test('seen spegne, forget dimentica', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  raffica(att, 'a', c);
  att.seen('a');
  assert.equal(att.isFlagged('a'), false);
  att.forget('a');
  assert.equal(att.isFlagged('a'), false);
});

test('le sessioni sono indipendenti: quella vista resta spenta se un’altra finisce', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.seen('a');
  att.left('a');
  c.avanza(10000);
  assert.equal(raffica(att, 'b', c), true, 'la sessione b ha finito davvero');
  assert.equal(att.isFlagged('a'), false, 'a non deve accendersi per colpa di b');
});
