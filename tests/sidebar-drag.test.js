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

ok('drag: la card presa in mano si sposta nel DOM dove finirebbe, mentre ci si passa sopra', () => {
  const { restore, cards } = setup([tab('a', 'shell'), tab('b', 'shell'), tab('c', 'shell')]);
  try {
    const body = cards[0].parentNode;
    const order = () => body.children.filter((n) => n.classes.has('session-item')).map((n) => n.dataset.id);
    fire(cards[2], 'dragstart');
    assert.ok(cards[2].classes.has('dragging'), 'la card trascinata non e segnalata: e il segnaposto');
    assert.ok(body.classes.has('reordering'), 'il gruppo non sa che e in riordino');
    // meta alta di 'a': c va prima di a
    fire(cards[0], 'dragover', { clientY: cards[0].getBoundingClientRect().top + 5 });
    assert.deepStrictEqual(order(), ['c', 'a', 'b'], 'il segnaposto non e salito sopra a');
    // meta bassa di 'a': c va fra a e b
    fire(cards[0], 'dragover', { clientY: cards[0].getBoundingClientRect().top + 35 });
    assert.deepStrictEqual(order(), ['a', 'c', 'b'], 'il segnaposto non si e messo sotto a');
    // ripassare sullo stesso punto non muove niente (nessuno sfarfallio)
    fire(cards[0], 'dragover', { clientY: cards[0].getBoundingClientRect().top + 35 });
    assert.deepStrictEqual(order(), ['a', 'c', 'b']);
    fire(cards[2], 'dragend');
    assert.ok(!cards[2].classes.has('dragging') && !body.classes.has('reordering'), 'a fine drag i segni devono sparire');
  } finally { restore(); }
});

ok('drag: il rilascio conferma quello che si vede — l ordine finale viene dal DOM', () => {
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('b', 'shell'), tab('c', 'shell')]);
  try {
    fire(cards[2], 'dragstart');
    fire(cards[0], 'dragover', { clientY: cards[0].getBoundingClientRect().top + 5 }); // c sopra a
    fire(cards[1], 'dragover', { clientY: cards[1].getBoundingClientRect().top + 5 }); // poi c sopra b: fra a e b
    fire(cards[2], 'dragend');
    assert.deepStrictEqual(reorders, [['c', 'b', true]], 'deve valere l ULTIMA posizione del segnaposto');
  } finally { restore(); }
});

ok('drag: rilasciata dove era partita non e un riordino', () => {
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('b', 'shell')]);
  try {
    fire(cards[0], 'dragstart');
    // meta alta di b: a e gia subito sopra b, non si muove
    fire(cards[1], 'dragover', { clientY: cards[1].getBoundingClientRect().top + 5 });
    fire(cards[0], 'dragend');
    assert.deepStrictEqual(reorders, [], 'un riordino a vuoto farebbe ridisegnare la sidebar per niente');
  } finally { restore(); }
});

ok('drag: sotto l ultima card, nello spazio vuoto del gruppo, la card va in coda', () => {
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('b', 'shell'), tab('c', 'shell')]);
  try {
    const body = cards[0].parentNode;
    fire(cards[0], 'dragstart');
    const last = cards[2].getBoundingClientRect();
    fire(body, 'dragover', { clientY: last.bottom + 20 });
    fire(cards[0], 'dragend');
    assert.deepStrictEqual(reorders, [['a', 'c', false]]);
  } finally { restore(); }
});

ok('drag: passare sopra una card di un altro gruppo non muove il segnaposto', () => {
  const { restore, cards, reorders } = setup([tab('a', 'shell'), tab('b', 'shell'), tab('c', 'claude')]);
  try {
    const body = cards[0].parentNode;
    const order = () => body.children.filter((n) => n.classes.has('session-item')).map((n) => n.dataset.id);
    fire(cards[1], 'dragstart');
    fire(cards[2], 'dragover', { clientY: cards[2].getBoundingClientRect().top + 5 });
    assert.deepStrictEqual(order(), ['a', 'b'], 'b non deve essere uscita dal suo gruppo');
    fire(cards[1], 'dragend');
    assert.deepStrictEqual(reorders, []);
  } finally { restore(); }
});

ok('drag: un render a meta trascinamento viene rimandato a fine drag, non distrugge la card in mano', () => {
  const sessions = [tab('a', 'shell'), tab('b', 'shell')];
  const { restore, cards, sidebar, list } = setup(sessions);
  try {
    fire(cards[1], 'dragstart');
    const before = descendants(list).filter((n) => n.classes.has('session-item'));
    sidebar.render(sessions, 'a'); // es. il giro dei titoli automatici
    const during = descendants(list).filter((n) => n.classes.has('session-item'));
    assert.deepStrictEqual(during, before, 'il render durante il drag ha ricostruito le card');
    fire(cards[1], 'dragend');
    const after = descendants(list).filter((n) => n.classes.has('session-item'));
    assert.ok(after.length === 2 && after[0] !== before[0], 'il render rimandato non e stato eseguito a fine drag');
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
    // (meta bassa: a era gia sopra b, sulla meta alta resterebbe dov'e)
    drag(cards, order.indexOf('a'), order.indexOf('b'), 'bottom');
    assert.deepStrictEqual(reorders, [['a', 'b', false]]);
    // 'c' sta in un altro progetto: il suo drop su 'b' no
    drag(cards, order.indexOf('c'), order.indexOf('b'), 'top');
    assert.strictEqual(reorders.length, 1, 'ha riordinato tra progetti diversi');
  } finally { restore(); }
});
