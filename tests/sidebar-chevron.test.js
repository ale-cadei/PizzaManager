const assert = require('node:assert');
const { test: ok } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

/* Il glifo che apre e chiude i gruppi è una fetta di pizza (renderer/pizza-slice.js).
   Qui si chiama il codice vero della sidebar su un DOM finto: conta che la fetta
   finisca nell'header e che lo stato aperto/chiuso resti sull'attributo ARIA,
   perché è quello su cui la CSS attacca la rotazione. */
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const Slice = require('../renderer/pizza-slice');
const { createSidebar } = require('../renderer/sidebar');

const session = { id: 'a', type: 'shell', name: 'a', cwd: '/x', alive: true };

function renderSidebar() {
  const list = createElement('div');
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Slice, Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
  });
  sidebar.render([session], null);
  return { list, headerOf: () => descendants(list).find((n) => n.classes.has('group-header')) };
}

ok('gruppi: la fetta di pizza sta nell header, aperto o chiuso che sia', () => {
  const restore = installDocument();
  try {
    const { headerOf } = renderSidebar();
    const open = headerOf();
    assert.ok(open, "manca l'header di gruppo");
    assert.match(open.innerHTML, /<span class="chevron"><svg/, 'la fetta non è nel glifo di collasso');
    assert.strictEqual(open.attrs['aria-expanded'], 'true', 'un gruppo nuovo nasce aperto');

    open.onclick();
    const closed = headerOf();
    assert.strictEqual(closed.attrs['aria-expanded'], 'false', 'il click non ha chiuso il gruppo');
    // Una sola fetta per entrambi gli stati: il verso lo dà la rotazione CSS
    assert.match(closed.innerHTML, /<span class="chevron"><svg/, 'chiuso il glifo cambia invece di ruotare');
  } finally { restore(); }
});

ok('gruppi: la fetta ruota con lo stato ARIA, non con un secondo glifo', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.ok(/\.group-header\[aria-expanded="true"\] \.chevron svg[\s\S]{0,80}rotate\(90deg\)/.test(css),
    'manca la rotazione della fetta sul gruppo aperto');
});
