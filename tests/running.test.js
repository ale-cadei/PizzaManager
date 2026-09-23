/* «Sta lavorando adesso»: la card corre finché l'output scorre.
   Il rischio è il falso positivo — una TUI che si ridisegna da ferma farebbe
   partire l'animazione di una sessione che non sta facendo niente. */
const { test } = require('node:test');
const assert = require('node:assert');
const { createRunning } = require('../renderer/running.js');

function clock(start = 1000) {
  let t = start;
  return { now: () => t, avanza: (ms) => { t += ms; } };
}

test('flusso che dura: la sessione risulta in esecuzione', () => {
  const c = clock();
  const r = createRunning({ now: c.now });
  assert.equal(r.data('a'), false, 'il primo chunk da solo non dice niente');
  c.avanza(400);
  assert.equal(r.data('a'), true, 'ora sta lavorando');
  assert.equal(r.isRunning('a'), true);
});

test('un ridisegno isolato non fa partire niente', () => {
  const c = clock();
  const r = createRunning({ now: c.now });
  r.data('a');
  c.avanza(50);
  r.data('a');           // due frame ravvicinati: è la TUI che si rinfresca
  assert.equal(r.isRunning('a'), false);
  assert.equal(r.stop('a'), false, 'non stava lavorando: niente da ridisegnare');
});

test('il cambio di stato si annuncia una volta sola', () => {
  const c = clock();
  const r = createRunning({ now: c.now });
  r.data('a'); c.avanza(400);
  assert.equal(r.data('a'), true);
  c.avanza(100);
  assert.equal(r.data('a'), false, 'già in esecuzione: nessun render nuovo');
});

test('silenzio: la sessione si ferma, e lo dice una volta sola', () => {
  const c = clock();
  const r = createRunning({ now: c.now });
  r.data('a'); c.avanza(400); r.data('a');
  assert.equal(r.stop('a'), true);
  assert.equal(r.isRunning('a'), false);
  assert.equal(r.stop('a'), false);
});

test('dopo una pausa il conteggio riparte da capo', () => {
  const c = clock();
  const r = createRunning({ now: c.now });
  r.data('a');      // un frame solo…
  r.stop('a');      // …poi silenzio
  c.avanza(10000);
  // Un frame isolato dieci secondi dopo non deve sembrare la coda del primo
  assert.equal(r.data('a'), false);
  assert.equal(r.isRunning('a'), false);
});

test('le sessioni non si influenzano', () => {
  const c = clock();
  const r = createRunning({ now: c.now });
  r.data('a'); c.avanza(400); r.data('a');
  assert.equal(r.isRunning('b'), false);
  r.forget('a');
  assert.equal(r.isRunning('a'), false);
});
