const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Azioni sulla card: con tmux la ✕ stacca (la sessione resta viva) e un secondo
   pulsante ⏻ termina il processo per davvero. Quale delle due si mostra lo
   decide il renderer, che conosce tmux: la sidebar chiede e basta. */
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar } = require('../renderer/sidebar');

function render(sessions, { canDetach }) {
  const list = createElement('div');
  const closed = [];
  const terminated = [];
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onRename: () => {},
    onClose: (id) => closed.push(id),
    canDetach,
    onTerminate: (id) => terminated.push(id),
  });
  sidebar.render(sessions, null);
  const card = descendants(list).find((n) => n.classes.has('session-item'));
  return { card, closed, terminated };
}

const alive = { id: 'a', type: 'shell', name: 'a', cwd: '/x', alive: true, session: 'aisess-a' };
const child = (card, cls) => card.children.find((c) => c.classes.has(cls));

ok('card: con tmux la ✕ stacca e un secondo pulsante termina', () => {
  const restore = installDocument();
  try {
    const { card, closed, terminated } = render([alive], { canDetach: () => true });
    const kill = child(card, 'terminate-x');
    assert.ok(kill, 'manca il pulsante per terminare');
    const close = card.children.find((c) => c.classes.has('close-x') && !c.classes.has('terminate-x'));
    assert.match(close.title, /^Stacca/, 'la ✕ non dice che stacca: ' + close.title);
    kill.onclick({ stopPropagation() {} });
    close.onclick({ stopPropagation() {} });
    assert.deepStrictEqual(terminated, ['a']);
    assert.deepStrictEqual(closed, ['a']);
  } finally { restore(); }
});

ok('card: senza tmux resta solo la ✕ e chiude', () => {
  const restore = installDocument();
  try {
    const { card, closed, terminated } = render([alive], { canDetach: () => false });
    assert.strictEqual(child(card, 'terminate-x'), undefined, 'pulsante di termine mostrato senza tmux');
    const close = child(card, 'close-x');
    assert.strictEqual(close.title, 'Chiudi');
    close.onclick({ stopPropagation() {} });
    assert.deepStrictEqual(closed, ['a']);
    assert.deepStrictEqual(terminated, []);
  } finally { restore(); }
});
