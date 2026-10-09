/* I segnali che si accendono da soli (sta lavorando, ha finito) non devono
   passare da render(): render() svuota la lista e ricrea le card, e con gli
   elementi ripartono da capo le animazioni CSS. Siccome «sta lavorando» si
   accende e si spegne a ogni pausa di ogni sessione, il lampeggio di una card
   che aveva finito tornava al fotogramma zero di continuo: si vedeva a scatti
   invece che graduale. Qui si verifica che il segnale tocchi la card che c'è
   già, senza rifare la lista. */
const assert = require('node:assert');
const { test: ok } = require('node:test');

const monta = (sessions, activeId, collassati = []) => {
  const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
  const Groups = require('../renderer/session-groups');
  const { createSidebar } = require('../renderer/sidebar');
  const restore = installDocument();
  const list = createElement('div');
  const sidebar = createSidebar({
    list, count: createElement('span'),
    storage: createStorage({
      'aisess.collapsedGroups': JSON.stringify(collassati),
      'aisess.collapsedProjects': JSON.stringify(collassati),
    }),
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
  });
  sidebar.render(sessions, activeId);
  const cards = () => descendants(list).filter((n) => n.classes.has('session-item'));
  const headers = () => descendants(list).filter((n) => n.classes.has('group-header'));
  return { sidebar, cards, headers, restore };
};

ok('segnali: accendere «sta lavorando» non ricostruisce le card', () => {
  const { sidebar, cards, restore } = monta([
    { id: 'a', type: 'claude', name: 'a', cwd: '/repo', alive: true, needsAttention: true },
    { id: 'b', type: 'claude', name: 'b', cwd: '/repo', alive: true },
  ], null);
  try {
    const prima = cards();
    assert.equal(sidebar.signal('b', { running: true }), true, 'la card disegnata non è stata trovata');
    const dopo = cards();
    // Stessi oggetti: se fossero elementi nuovi, l'animazione della card che
    // lampeggia sarebbe ripartita da capo.
    assert.strictEqual(dopo[0], prima[0], 'la card che lampeggia è stata ricreata');
    assert.strictEqual(dopo[1], prima[1], 'la card è stata ricreata invece che aggiornata');
    assert.ok(dopo[1].classes.has('is-running'), 'il segnale non è arrivato sulla card');
    assert.ok(dopo[0].classes.has('needs-attention'), 'il lampeggio dell altra card si è spento');
    assert.equal(sidebar.signal('b', { running: false }), true);
    assert.ok(!cards()[1].classes.has('is-running'), 'il segnale non si spegne');
  } finally { restore(); }
});

ok('segnali: «ha finito» si accende sulla card senza toccare le altre', () => {
  const { sidebar, cards, restore } = monta([
    { id: 'a', type: 'claude', name: 'a', cwd: '/repo', alive: true },
    { id: 'b', type: 'claude', name: 'b', cwd: '/repo', alive: true },
  ], null);
  try {
    const prima = cards();
    assert.equal(sidebar.signal('a', { needsAttention: true }), true);
    assert.strictEqual(cards()[0], prima[0], 'la card è stata ricreata');
    assert.ok(cards()[0].classes.has('needs-attention'), 'il lampeggio non si accende');
    assert.ok(!cards()[1].classes.has('needs-attention'), 'lampeggia anche chi non ha finito');
    assert.match(cards()[0].title, /ha finito/, 'la card non dice perché lampeggia');
    sidebar.signal('a', { needsAttention: false });
    assert.ok(!cards()[0].classes.has('needs-attention'), 'il lampeggio non si spegne');
    assert.match(cards()[0].title, /rinominare/, 'resta la scritta del lampeggio spento');
  } finally { restore(); }
});

/* A gruppo chiuso la card non si vede: il segnale sta sulla linguetta, e ci
   resta finché dentro c'è almeno una sessione che ha finito. */
ok('segnali: a gruppo chiuso il lampeggio passa sulla linguetta', () => {
  const { sidebar, headers, restore } = monta([
    { id: 'a', type: 'claude', name: 'a', cwd: '/repo', alive: true },
    { id: 'b', type: 'claude', name: 'b', cwd: '/repo', alive: true },
  ], null, ['claude']);
  try {
    const cap = headers()[0];
    assert.ok(!cap.classes.has('needs-attention'), 'la linguetta lampeggia senza motivo');
    sidebar.signal('a', { needsAttention: true });
    assert.ok(cap.classes.has('needs-attention'), 'il gruppo chiuso nasconde il lampeggio');
    sidebar.signal('b', { needsAttention: true });
    sidebar.signal('a', { needsAttention: false });
    assert.ok(cap.classes.has('needs-attention'), 'la linguetta si spegne con una sessione ancora in attesa');
    sidebar.signal('b', { needsAttention: false });
    assert.ok(!cap.classes.has('needs-attention'), 'la linguetta resta accesa a lampeggi spenti');
  } finally { restore(); }
});

ok('segnali: una sessione non disegnata lo dice, non fallisce in silenzio', () => {
  const { sidebar, restore } = monta([
    { id: 'a', type: 'claude', name: 'a', cwd: '/repo', alive: true },
  ], null);
  try {
    assert.equal(sidebar.signal('mai-vista', { running: true }), false,
      'una card che non c è risulta aggiornata: il segnale andrebbe perso');
  } finally { restore(); }
});

/* Piano 46: il permesso lampeggia più rapido, stesso colore. È una classe in
   più sulla card; spegnere il lampeggio la toglie sempre. */
ok('segnali: il permesso ha la sua classe e il suo titolo, e si spegne col lampeggio', () => {
  const { sidebar, cards, restore } = monta([
    { id: 'a', type: 'claude', name: 'a', cwd: '/repo', alive: true },
  ], null);
  try {
    sidebar.signal('a', { needsAttention: true, permission: true });
    assert.ok(cards()[0].classes.has('needs-attention'));
    assert.ok(cards()[0].classes.has('needs-permission'));
    assert.match(cards()[0].title, /permesso/);
    sidebar.signal('a', { needsAttention: false });
    assert.ok(!cards()[0].classes.has('needs-permission'), 'il ritmo rapido resta acceso');
    sidebar.signal('a', { needsAttention: true });
    assert.ok(!cards()[0].classes.has('needs-permission'), '«ha finito» non è un permesso');
  } finally { restore(); }
});

ok('segnali: una card disegnata con il permesso nasce col ritmo rapido', () => {
  const { cards, restore } = monta([
    { id: 'a', type: 'claude', name: 'a', cwd: '/repo', alive: true, needsAttention: true, attentionKind: 'permission' },
  ], null);
  try {
    assert.ok(cards()[0].classes.has('needs-permission'));
    assert.match(cards()[0].title, /permesso/);
  } finally { restore(); }
});

ok('segnali: a gruppo chiuso anche il permesso passa sulla linguetta', () => {
  const { sidebar, headers, restore } = monta([
    { id: 'a', type: 'claude', name: 'a', cwd: '/repo', alive: true },
    { id: 'b', type: 'claude', name: 'b', cwd: '/repo', alive: true },
  ], null, ['claude']);
  try {
    sidebar.signal('a', { needsAttention: true, permission: true });
    assert.ok(headers()[0].classes.has('needs-permission'));
    sidebar.signal('a', { needsAttention: false });
    assert.ok(!headers()[0].classes.has('needs-permission'));
  } finally { restore(); }
});
