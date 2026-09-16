const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Riordino delle card della sidebar per trascinamento. Qui si chiama il codice
   vero di renderer/sidebar.js su un DOM finto (tests/fake-dom.js): l'unica cosa
   che conta è il comportamento — quale coppia (spostato, bersaglio) arriva a
   onReorder, e quando il rilascio NON viene accettato. */
const { installDocument, createElement, descendants, createStorage, fire } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar } = require('../renderer/sidebar');

const Icons = { markup: () => '' };
const escapeHtml = (s) => String(s);

function setup(sessions) {
  const restore = installDocument();
  const list = createElement('div');
  const reorders = [];
  const selected = [];
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons, Groups, escapeHtml,
    onSelect: (id) => selected.push(id),
    onClose: () => {},
    onRename: () => {},
    onReorder: (movedId, targetId, opts) => reorders.push([movedId, targetId, opts.before]),
  });
  sidebar.render(sessions, null);
  const cards = new Map();
  for (const node of descendants(list)) {
    if (!node.classes.has('session-item')) continue;
    // Card alte 40px impilate: il centro della n-esima sta a 20 + 40n
    node.rect = { top: cards.size * 40, left: 0, width: 200, height: 40 };
    cards.set(node, node);
  }
  return { restore, list, sidebar, reorders, selected, cards: [...cards.keys()] };
}

const tab = (id, type, extra = {}) => ({ id, type, name: id, cwd: '/x', alive: true, ...extra });

/** Trascina la card `from` e la rilascia su `to`, nella metà indicata. */
function drag(cards, from, to, half) {
  fire(cards[from], 'dragstart');
  const rect = cards[to].getBoundingClientRect();
  const clientY = half === 'top' ? rect.top + 5 : rect.top + rect.height - 5;
  const over = fire(cards[to], 'dragover', { clientY });
  const drop = fire(cards[to], 'drop', { clientY });
  fire(cards[from], 'dragend');
  return { over, drop };
}

ok('drag: rilasciare sulla metà alta mette la card sopra il bersaglio', () => {
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('b', 'shell'), tab('c', 'shell')]);
  try {
    drag(cards, 2, 0, 'top');
    assert.deepStrictEqual(reorders, [['c', 'a', true]]);
  } finally { restore(); }
});

ok('drag: rilasciare sulla metà bassa mette la card sotto il bersaglio', () => {
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('b', 'shell'), tab('c', 'shell')]);
  try {
    drag(cards, 0, 2, 'bottom');
    assert.deepStrictEqual(reorders, [['a', 'c', false]]);
  } finally { restore(); }
});

ok('drag: il rilascio fuori dal gruppo di partenza non viene accettato', () => {
  // Gruppo per tipo: 'a' è shell, 'z' è claude. Spostare 'a' sotto 'z' non
  // avrebbe effetto (il gruppo dipende dal tipo), quindi il drop va rifiutato.
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('z', 'claude')]);
  try {
    const { over, drop } = drag(cards, 0, 1, 'top');
    assert.deepStrictEqual(reorders, [], 'ha riordinato tra gruppi diversi');
    assert.strictEqual(over.defaultPrevented, false, 'il gruppo estraneo si offre come bersaglio');
    assert.strictEqual(drop.defaultPrevented, false);
  } finally { restore(); }
});

ok('drag: rilasciare una card su se stessa non è un riordino', () => {
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('b', 'shell')]);
  try {
    drag(cards, 1, 1, 'top');
    assert.deepStrictEqual(reorders, []);
  } finally { restore(); }
});

ok('drag: il click che chiude il trascinamento non seleziona la card', () => {
  const { restore, cards, selected } = setup([tab('a', 'shell'), tab('b', 'shell')]);
  try {
    drag(cards, 1, 0, 'top');
    cards[1].onclick();
    assert.deepStrictEqual(selected, [], 'il rilascio del drag ha selezionato una scheda');
  } finally { restore(); }
});

ok('drag: senza trascinamento il click continua a selezionare', () => {
  const { restore, cards, selected } = setup([tab('a', 'shell'), tab('b', 'shell')]);
  try {
    cards[1].onclick();
    assert.deepStrictEqual(selected, ['b']);
  } finally { restore(); }
});

ok('drag: la card segnala il punto di rilascio mentre ci si passa sopra', () => {
  const { restore, cards } = setup([tab('a', 'shell'), tab('b', 'shell')]);
  try {
    fire(cards[1], 'dragstart');
    assert.ok(cards[1].classes.has('dragging'), 'la card trascinata non è segnalata');
    const rect = cards[0].getBoundingClientRect();
    fire(cards[0], 'dragover', { clientY: rect.top + 5 });
    assert.ok(cards[0].classes.has('drop-before'), 'manca la riga sopra il bersaglio');
    fire(cards[0], 'dragover', { clientY: rect.top + rect.height - 5 });
    assert.ok(cards[0].classes.has('drop-after') && !cards[0].classes.has('drop-before'),
      'la riga non si sposta sotto il bersaglio');
    fire(cards[0], 'dragleave');
    fire(cards[1], 'dragend');
    assert.ok(!cards[0].classes.has('drop-after') && !cards[1].classes.has('dragging'),
      'i segni del trascinamento restano dopo la fine');
  } finally { restore(); }
});

ok('drag: in modalità progetto il gruppo è il progetto, non il tipo', () => {
  const sessions = [
    tab('a', 'shell', { projectRoot: '/repo' }),
    tab('b', 'claude', { projectRoot: '/repo' }),
    tab('c', 'claude', { projectRoot: '/altro' }),
  ];
  const restore = installDocument();
  try {
    const list = createElement('div');
    const reorders = [];
    const sidebar = createSidebar({
      list, count: createElement('span'), storage: createStorage(),
      Icons, Groups, escapeHtml,
      onSelect: () => {}, onClose: () => {}, onRename: () => {},
      onReorder: (movedId, targetId, opts) => reorders.push([movedId, targetId, opts.before]),
    });
    sidebar.setMode('project');
    sidebar.render(sessions, null);
    const cards = descendants(list).filter((n) => n.classes.has('session-item'));
    cards.forEach((n, i) => { n.rect = { top: i * 40, left: 0, width: 200, height: 40 }; });
    assert.strictEqual(cards.length, 3);
    // Le card seguono l'ordine dei gruppi, non quello della lista in ingresso
    const order = Groups.groupSessions(sessions, { mode: 'project' }).flatMap((g) => g.items.map((s) => s.id));
    // 'a' e 'b' sono di tipo diverso ma stesso progetto: qui il drop deve passare
    drag(cards, order.indexOf('a'), order.indexOf('b'), 'top');
    assert.deepStrictEqual(reorders, [['a', 'b', true]]);
    // 'c' sta in un altro progetto: il suo drop su 'b' no
    drag(cards, order.indexOf('c'), order.indexOf('b'), 'top');
    assert.strictEqual(reorders.length, 1, 'ha riordinato tra progetti diversi');
  } finally { restore(); }
});
