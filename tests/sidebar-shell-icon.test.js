const assert = require('node:assert/strict');
const { test } = require('node:test');
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar } = require('../renderer/sidebar');

test('clic sul logo di una shell apre il catalogo senza selezionare la card', () => {
  const restore = installDocument();
  try {
    const list = createElement('div');
    const chosen = [];
    const selected = [];
    const sidebar = createSidebar({
      list, count: createElement('span'), storage: createStorage(), Groups,
      Icons: { has: (key) => key === 'docker', markup: (key) => `<svg data-icon="${key}"></svg>` },
      Slice: { markup: () => '' }, escapeHtml: String,
      onSelect: (id) => selected.push(id), onClose: () => {}, onRename: () => {},
      onIcon: (tab) => chosen.push(tab.id),
    });
    sidebar.render([{ id: 'one', type: 'shell', iconKey: 'docker', name: 'Docker', cwd: '/p', alive: true }], null);
    const card = descendants(list).find((el) => el.classList.contains('session-item'));
    assert.match(card.innerHTML, /shell-icon-trigger/);
    assert.match(card.innerHTML, /data-icon="docker"/);
    card.onclick({ target: { closest: () => ({}) }, stopPropagation() {} });
    assert.deepEqual(chosen, ['one']);
    assert.deepEqual(selected, []);
  } finally { restore(); }
});
