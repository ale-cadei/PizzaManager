/* La scheda attiva con l'app in secondo piano (piano 38, passo 5).
 *
 * renderer/signals.js tratta il blur della finestra come «l'utente ha lasciato
 * la scheda attiva» (attention.left) e il focus come «l'ha rivista»
 * (attention.seen, via clearAttention). Le regole sono quelle di
 * attention.js, non cambiano: qui si prova che usate così rispondono come
 * serve alle notifiche. */
const { test } = require('node:test');
const assert = require('node:assert');
const { createAttention } = require('../renderer/attention.js');

function clock(start = 1000) {
  let t = start;
  return { now: () => t, avanza: (ms) => { t += ms; } };
}

function raffica(att, id, c, { bytes = 4000, durata = 3000 } = {}) {
  att.data(id, bytes / 2);
  c.avanza(durata);
  att.data(id, bytes / 2);
  c.avanza(1500);
  return att.idle(id);
}

test('chiedo qualcosa nella scheda attiva, passo al browser: a fine turno si accende', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.typed('a');
  att.left('a'); // blur della finestra
  c.avanza(10000);
  assert.equal(raffica(att, 'a', c), true);
});

test('anche una risposta breve si accende, se l ha chiesta l utente', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.typed('a');
  att.left('a');
  att.data('a', 200);
  c.avanza(1500);
  assert.equal(att.idle('a'), true);
});

test('il ridisegno provocato dal cambio di focus non accende la card', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.left('a'); // xterm manda il focus-out, la TUI si ridisegna subito
  att.data('a', 3000);
  c.avanza(300);
  assert.equal(att.idle('a'), false);
});

test('tornando sulla finestra la card si spegne e il lavoro visto non riaccende', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.typed('a');
  att.left('a');
  c.avanza(5000);
  assert.equal(raffica(att, 'a', c), true);
  att.seen('a'); // focus della finestra
  assert.equal(att.isFlagged('a'), false);
  att.left('a'); // di nuovo dietro, ma senza aver chiesto niente
  att.data('a', 500);
  c.avanza(300);
  assert.equal(att.idle('a'), false, 'un frammento dopo una visita non è un lavoro');
});
