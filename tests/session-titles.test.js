const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("node:assert");
const { test: ok } = require("node:test");

/* Nomi delle sessioni: automatici dal contenuto della conversazione (i titoli
   che i CLI scrivono già su disco) con override manuale che vince sempre. */
const titles = require('../renderer/session-titles');

function memStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

ok('nomi: il nome manuale vince sul titolo automatico e sopravvive al riavvio', () => {
  const storage = memStorage();
  const store = titles.createTitleStore(storage);
  assert.strictEqual(store.nameFor('claude', 'abc'), null, 'senza rinomina non deve esserci un nome');
  store.setName('claude', 'abc', '  Fix login  ');
  assert.strictEqual(store.nameFor('claude', 'abc'), 'Fix login', 'il nome non viene ripulito dagli spazi');
  // stesso storage, store nuovo: è il caso del riavvio dell'app
  assert.strictEqual(titles.createTitleStore(storage).nameFor('claude', 'abc'), 'Fix login');
  assert.strictEqual(store.nameFor('codex', 'abc'), null, 'i nomi non devono attraversare i tipi');
  store.clearName('claude', 'abc');
  assert.strictEqual(store.nameFor('claude', 'abc'), null, 'la rinomina non si annulla');
});

ok('nomi: un nome vuoto cancella la rinomina invece di salvarla', () => {
  const store = titles.createTitleStore(memStorage());
  store.setName('codex', 'x', 'Qualcosa');
  store.setName('codex', 'x', '   ');
  assert.strictEqual(store.nameFor('codex', 'x'), null);
});

ok('nomi: storage corrotto o assente non fa esplodere la UI', () => {
  const broken = memStorage({ 'aisess.session-names.v1': '{non json' });
  const store = titles.createTitleStore(broken);
  assert.strictEqual(store.nameFor('claude', 'abc'), null);
  store.setName('claude', 'abc', 'Nuovo'); // deve ripartire da zero senza lanciare
  assert.strictEqual(store.nameFor('claude', 'abc'), 'Nuovo');
  assert.strictEqual(titles.createTitleStore(null).nameFor('claude', 'abc'), null, 'senza storage deve degradare');
});

ok('nomi: displayName preferisce la rinomina, poi il titolo del CLI', () => {
  const store = titles.createTitleStore(memStorage());
  assert.strictEqual(titles.displayName(store, 'claude', 'id1', 'Titolo dal CLI'), 'Titolo dal CLI');
  store.setName('claude', 'id1', 'Il mio nome');
  assert.strictEqual(titles.displayName(store, 'claude', 'id1', 'Titolo dal CLI'), 'Il mio nome');
  assert.strictEqual(titles.displayName(store, 'claude', null, 'Titolo dal CLI'), 'Titolo dal CLI');
});

ok('nomi: la conversazione di una scheda nuova si riconosce da cwd e istante di avvio', () => {
  const sessions = [
    { id: 'vecchia', cwd: '/home/u/progetto', title: 'Roba vecchia', mtime: 1000 },
    { id: 'altrove', cwd: '/home/u/altro', title: 'Altro progetto', mtime: 9000 },
    { id: 'giusta', cwd: '/home/u/progetto/', title: 'Appena aperta', mtime: 8000 },
  ];
  const s = titles.pickAutoSession(sessions, { cwd: '/home/u/progetto', since: 5000 });
  assert.ok(s, 'nessuna conversazione riconosciuta');
  assert.strictEqual(s.id, 'giusta', 'lo slash finale nel cwd non deve contare');
  // opencode usa `directory` al posto di `cwd`
  const oc = titles.pickAutoSession([{ id: 'oc', directory: '/home/u/progetto', title: 'T', mtime: 7000 }],
    { cwd: '/home/u/progetto', since: 5000 });
  assert.strictEqual(oc && oc.id, 'oc');
  // niente di nuovo dopo l'avvio: meglio nessun titolo che quello sbagliato
  assert.strictEqual(titles.pickAutoSession(sessions, { cwd: '/home/u/progetto', since: 9999 }), null);
  assert.strictEqual(titles.pickAutoSession(null, { cwd: '/x', since: 0 }), null);
});

/* ---------- Primo prompt digitato nel terminale ---------- */

ok('primo prompt: la riga inviata con Invio diventa il titolo', () => {
  const { createPromptCapture } = require('../renderer/prompt-capture');
  const cap = createPromptCapture();
  assert.strictEqual(cap.feed('ciao'), null);
  assert.strictEqual(cap.feed(' mondo'), null);
  assert.strictEqual(cap.feed('\r'), 'ciao mondo');
  // finito: quello che viene dopo non cambia più il titolo
  assert.strictEqual(cap.feed('altro\r'), null);
});

ok('primo prompt: backspace, sequenze di escape e tasti speciali restano fuori', () => {
  const { createPromptCapture } = require('../renderer/prompt-capture');
  const cap = createPromptCapture();
  cap.feed('sistena');
  cap.feed('\x7f\x7f'); // due backspace
  cap.feed('ma il login');
  cap.feed('\x1b[A'); // freccia su
  cap.feed('\x1b[200~'); // inizio incolla bracketed
  assert.strictEqual(cap.feed('\n'), 'sistema il login');
});

ok('primo prompt: righe vuote e comandi slash non sono titoli', () => {
  const { createPromptCapture } = require('../renderer/prompt-capture');
  const cap = createPromptCapture();
  assert.strictEqual(cap.feed('\r'), null, 'riga vuota accettata');
  assert.strictEqual(cap.feed('/model\r'), null, 'comando slash accettato');
  assert.strictEqual(cap.feed('  \t \r'), null, 'riga di soli spazi accettata');
  assert.strictEqual(cap.feed('il prompt vero\r'), 'il prompt vero');
});

/* I TUI chiedono al terminale colori e capacità: xterm risponde sullo stesso
   canale dell'input, e quelle risposte finivano dritte nel titolo. */
ok('primo prompt: le risposte del terminale ai TUI non sono prompt', () => {
  const { createPromptCapture } = require('../renderer/prompt-capture');
  const cap = createPromptCapture();
  assert.strictEqual(cap.feed('\x1b]10;rgb:f2f2/efef/f4f4\x07'), null, 'risposta colore di primo piano');
  assert.strictEqual(cap.feed('\x1b]11;rgb:0000/0000/0000\x1b\\'), null, 'risposta colore di sfondo');
  assert.strictEqual(cap.feed('\x1b[?62;c'), null, 'risposta device attributes');
  assert.strictEqual(cap.feed('\x1b[24;80R'), null, 'risposta posizione cursore');
  assert.strictEqual(cap.feed('sistema il parser dei log\r'), 'sistema il parser dei log');
});

ok('primo prompt: un prompt incollato vale come digitato', () => {
  const { createPromptCapture } = require('../renderer/prompt-capture');
  const cap = createPromptCapture();
  assert.strictEqual(cap.feed('\x1b[200~controlla i log di produzione\x1b[201~'), null);
  assert.strictEqual(cap.feed('\r'), 'controlla i log di produzione');
});

ok('primo prompt: un incolla lungo diventa un titolo corto', () => {
  const { createPromptCapture } = require('../renderer/prompt-capture');
  const cap = createPromptCapture({ max: 40 });
  const out = cap.feed('x'.repeat(200) + '\r');
  assert.strictEqual(out.length, 40);
});
