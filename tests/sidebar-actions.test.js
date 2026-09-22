const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Azioni sulla card: una sola ✕, che chiude la sessione per davvero (termina il
   processo). I due pulsanti di prima — ✕ che staccava e ⏻ che terminava —
   chiedevano all'utente di conoscere tmux per scegliere. La conferma non la fa
   la sidebar: passa la card al renderer, che ci appoggia il fumetto. */
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar } = require('../renderer/sidebar');

function render(sessions) {
  const list = createElement('div');
  const closed = [];
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onRename: () => {},
    onClose: (id, anchor) => closed.push({ id, anchor }),
  });
  sidebar.render(sessions, null);
  const card = descendants(list).find((n) => n.classes.has('session-item'));
  return { card, closed };
}

const alive = { id: 'a', type: 'shell', name: 'a', cwd: '/x', alive: true, session: 'aisess-a' };

ok('card: una sola ✕, e chiude la sessione', () => {
  const restore = installDocument();
  try {
    const { card, closed } = render([alive]);
    const bottoni = card.children.filter((c) => c.classes.has('close-x'));
    assert.strictEqual(bottoni.length, 1, `la card ha ${bottoni.length} pulsanti di chiusura`);
    assert.ok(!descendants(card).some((c) => c.classes.has('terminate-x')),
      'il pulsante di spegnimento è ancora sulla card');
    assert.match(bottoni[0].title, /^Chiudi/, 'la ✕ non dice che chiude: ' + bottoni[0].title);
    bottoni[0].onclick({ stopPropagation() {} });
    assert.deepStrictEqual(closed.map((c) => c.id), ['a']);
  } finally { restore(); }
});

ok('card: la ✕ passa la card, che è dove si appoggia il fumetto di conferma', () => {
  const restore = installDocument();
  try {
    const { card, closed } = render([alive]);
    const x = card.children.find((c) => c.classes.has('close-x'));
    x.onclick({ stopPropagation() {} });
    assert.strictEqual(closed[0].anchor, card, 'la ✕ non passa la card a chi deve mostrare la conferma');
    // Dopo un render la card è un elemento nuovo: il fumetto la ritrova da qui
    assert.strictEqual(card.dataset.id, 'a', 'la card non porta l id della sessione');
  } finally { restore(); }
});
