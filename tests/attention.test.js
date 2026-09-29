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

/* Il lampeggio "a caso": claude e opencode chiedono il mouse (?1003h, ogni
 * movimento), e xterm manda i report da solo, via onData, appena il mouse
 * passa sopra il terminale. Contati come "l'utente ha scritto", facevano
 * lampeggiare la card al primo ritocco della TUI (~140 byte ogni 8 s). */
const { isTyping } = require('../renderer/attention.js');

test('isTyping: i report che xterm genera da solo non sono input dell utente', () => {
  for (const d of [
    '\x1b[<35;40;12M',                  // movimento del mouse, SGR
    '\x1b[<35;40;12M\x1b[<35;41;12M',   // più movimenti in un colpo
    '\x1b[<0;10;5m',                    // rilascio
    '\x1b[M #!',                        // mouse X10
    '\x1b[I', '\x1b[O',                 // focus dentro/fuori
    '\x1b[?62;22c', '\x1b[>0;276;0c',   // risposte DA
    '\x1b[12;40R',                      // posizione del cursore
    '\x1b]11;rgb:0707/0505/0505\x1b\\', // colore di fondo
    '',
  ]) assert.strictEqual(isTyping(d), false, JSON.stringify(d));
});

test('isTyping: tasti, frecce e incolla sono input', () => {
  for (const d of ['a', '\r', 'ciao\r', '\x1b[A', '\x1b', '\x03', '\x1b[200~testo\x1b[201~', '\x1b[<35;40;12Mx']) {
    assert.strictEqual(isTyping(d), true, JSON.stringify(d));
  }
});

test('il ripristino all\'avvio: il ridisegno della sessione riattaccata non la accende', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.born('a');                   // scheda appena nata o riattaccata a tmux
  // tmux ridisegna lo schermo, claude --resume riscrive la conversazione:
  // tanta roba e per secondi, ma nessun lavoro nuovo.
  assert.equal(raffica(att, 'a', c, { bytes: 20000, durata: 4000 }), false);
  assert.equal(att.isFlagged('a'), false);
});

test('il bell dell\'avvio non accende la scheda ripristinata', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.born('a');
  assert.equal(att.bell('a'), false);
});

test('dopo l\'avvio, un lavoro vero si segnala come sempre', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.born('a');
  raffica(att, 'a', c, { bytes: 20000, durata: 4000 });  // l'avvio
  c.avanza(10000);
  assert.equal(raffica(att, 'a', c), true);
});

test('se l\'utente scrive durante l\'avvio, la risposta si segnala', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.born('a');
  att.typed('a');
  assert.equal(raffica(att, 'a', c, { bytes: 200, durata: 100 }), true);
});

test('una pausa a metà turno: se riprende a lavorare la card si spegne', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  assert.equal(raffica(att, 'a', c), true);   // silenzio lungo: sembra finito
  assert.equal(att.resumed('a'), true);       // e invece riparte
  assert.equal(att.isFlagged('a'), false);
  c.avanza(5000);
  assert.equal(raffica(att, 'a', c), true);   // la fine vera si segnala
});

test('ripresa su una card spenta: niente da ritirare', () => {
  const att = createAttention();
  assert.equal(att.resumed('a'), false);
});

test('dopo la ripresa, la risposta chiesta dall\'utente si segnala anche se breve', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  att.typed('a');
  raffica(att, 'a', c);
  att.resumed('a');
  assert.equal(raffica(att, 'a', c, { bytes: 200, durata: 100 }), true);
});

test('dopo la ripresa, anche una coda breve del lavoro chiude il turno', () => {
  const c = clock();
  const att = createAttention({ now: c.now });
  raffica(att, 'a', c);
  att.resumed('a');
  assert.equal(raffica(att, 'a', c, { bytes: 500, durata: 400 }), true);
});
