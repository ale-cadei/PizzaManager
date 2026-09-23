const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Riordino dei gruppi PROGETTO trascinandone la linguetta. Codice vero di
   renderer/sidebar.js sul DOM finto: conta quale ordine di progetti si vede
   dopo il rilascio e che cosa resta salvato nello storage. */
const { installDocument, createElement, descendants, createStorage, fire } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const Order = require('../renderer/session-order');
const { createSidebar } = require('../renderer/sidebar');

const PROJECT_ORDER_KEY = 'aisess.projectOrder';
const tab = (id, projectRoot) => ({ id, type: 'shell', name: id, cwd: projectRoot || '', projectRoot, alive: true });

function setup(sessions, { mode = 'project', storage = createStorage() } = {}) {
  const restore = installDocument();
  const list = createElement('div');
  const sidebar = createSidebar({
    list, count: createElement('span'), storage,
    Icons: { markup: () => '' }, Slice: { markup: () => '' }, Groups, Order,
    escapeHtml: (s) => String(s),
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
    onReorder: () => {},
  });
  sidebar.setMode(mode);
  sidebar.render(sessions, null);
  return { restore, list, sidebar, storage };
}

/** Gruppi nel DOM, ognuno alto 100px, impilati: servono i rettangoli per la metà. */
function groupsOf(list) {
  const groups = list.children.filter((n) => n.classes.has('session-group'));
  groups.forEach((g, i) => { g.rect = { top: i * 100, left: 0, width: 200, height: 100 }; });
  return groups;
}
const headerOf = (group) => descendants(group).find((n) => n.classes.has('group-header'));
const labels = (list) => list.children
  .filter((n) => n.classes.has('session-group'))
  .map((g) => headerOf(g).dataset.key);

function dragGroup(list, from, to, half) {
  const groups = groupsOf(list);
  const header = headerOf(groups[from]);
  fire(header, 'dragstart');
  const r = groups[to].getBoundingClientRect();
  const clientY = half === 'top' ? r.top + 5 : r.bottom - 5;
  const over = fire(groups[to], 'dragover', { clientY });
  const drop = fire(groups[to], 'drop', { clientY });
  fire(header, 'dragend');
  return { over, drop };
}

const three = [tab('a', '/p/alfa'), tab('b', '/p/beta'), tab('c', '/p/gamma')];

ok('gruppi: trascinare la linguetta di un progetto sopra un altro lo sposta li', () => {
  const { restore, list } = setup(three);
  try {
    assert.deepStrictEqual(labels(list), ['/p/alfa', '/p/beta', '/p/gamma']);
    dragGroup(list, 2, 0, 'top');
    assert.deepStrictEqual(labels(list), ['/p/gamma', '/p/alfa', '/p/beta']);
  } finally { restore(); }
});

ok('gruppi: la metà bassa del bersaglio mette il progetto sotto', () => {
  const { restore, list } = setup(three);
  try {
    dragGroup(list, 0, 1, 'bottom');
    assert.deepStrictEqual(labels(list), ['/p/beta', '/p/alfa', '/p/gamma']);
  } finally { restore(); }
});

ok('gruppi: l ordine dei progetti si salva e sopravvive a una sidebar nuova', () => {
  const storage = createStorage();
  const first = setup(three, { storage });
  try { dragGroup(first.list, 2, 0, 'top'); } finally { first.restore(); }
  assert.deepStrictEqual(JSON.parse(storage.getItem(PROJECT_ORDER_KEY)), ['/p/gamma', '/p/alfa', '/p/beta']);
  const second = setup(three, { storage });
  try {
    assert.deepStrictEqual(labels(second.list), ['/p/gamma', '/p/alfa', '/p/beta']);
  } finally { second.restore(); }
});

ok('gruppi: un progetto chiuso non perde il suo posto salvato', () => {
  const storage = createStorage({ [PROJECT_ORDER_KEY]: JSON.stringify(['/p/gamma', '/p/zeta', '/p/alfa']) });
  const { restore, list } = setup(three, { storage });
  try {
    dragGroup(list, 2, 0, 'top'); // beta in cima
    const saved = JSON.parse(storage.getItem(PROJECT_ORDER_KEY));
    assert.ok(saved.includes('/p/zeta'), 'il progetto non aperto e stato dimenticato');
    assert.deepStrictEqual(saved.filter((k) => k !== '/p/zeta'), ['/p/beta', '/p/gamma', '/p/alfa']);
  } finally { restore(); }
});

ok('gruppi: «Senza directory» non si trascina e non accetta rilasci', () => {
  const { restore, list } = setup([tab('a', '/p/alfa'), tab('x', null)]);
  try {
    const groups = groupsOf(list);
    assert.strictEqual(headerOf(groups[1]).draggable, false, '«Senza directory» sta sempre in fondo');
    const { over, drop } = dragGroup(list, 0, 1, 'bottom');
    assert.strictEqual(over.defaultPrevented, false);
    assert.strictEqual(drop.defaultPrevented, false);
    assert.deepStrictEqual(labels(list), ['/p/alfa', '']);
  } finally { restore(); }
});

ok('gruppi: per tipo le linguette non si trascinano (l ordine dei tipi e fisso)', () => {
  const { restore, list } = setup([tab('a', '/p/alfa')], { mode: 'type' });
  try {
    assert.strictEqual(headerOf(groupsOf(list)[0]).draggable, false);
  } finally { restore(); }
});

ok('gruppi: durante il trascinamento il bersaglio segna dove andra il progetto', () => {
  const { restore, list } = setup(three);
  try {
    const groups = groupsOf(list);
    fire(headerOf(groups[0]), 'dragstart');
    fire(groups[2], 'dragover', { clientY: groups[2].getBoundingClientRect().top + 5 });
    assert.ok(groups[2].classes.has('drop-before'));
    fire(groups[2], 'dragover', { clientY: groups[2].getBoundingClientRect().bottom - 5 });
    assert.ok(groups[2].classes.has('drop-after') && !groups[2].classes.has('drop-before'));
    fire(headerOf(groups[0]), 'dragend');
    assert.ok(!groups[2].classes.has('drop-after'), 'il segno resta dopo il rilascio');
  } finally { restore(); }
});

ok('gruppi: il click che chiude il trascinamento non collassa il gruppo', () => {
  const { restore, list } = setup(three);
  try {
    const groups = groupsOf(list);
    const header = headerOf(groups[1]);
    fire(header, 'dragstart');
    fire(header, 'dragend');
    header.onclick();
    const again = headerOf(groupsOf(list)[1]);
    assert.strictEqual(again.getAttribute('aria-expanded'), 'true');
  } finally { restore(); }
});

ok('gruppi: trascinare una card non muove i gruppi', () => {
  const { restore, list } = setup([tab('a', '/p/alfa'), tab('a2', '/p/alfa'), tab('b', '/p/beta')]);
  try {
    const groups = groupsOf(list);
    const card = descendants(groups[0]).find((n) => n.classes.has('session-item'));
    fire(card, 'dragstart');
    const over = fire(groups[1], 'dragover', { clientY: 105 });
    fire(card, 'dragend');
    assert.strictEqual(over.defaultPrevented, false, 'il gruppo accetta una card come se fosse un gruppo');
    assert.deepStrictEqual(labels(list), ['/p/alfa', '/p/beta']);
  } finally { restore(); }
});
