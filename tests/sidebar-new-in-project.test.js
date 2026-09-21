const assert = require('node:assert');
const { test: ok } = require('node:test');

/* In modalità progetto ogni gruppo ha un «+» sulla riga della linguetta: crea
   una sessione direttamente in quella radice, senza dover ridigitare la
   directory. La sidebar non sa come si crea una sessione: chiama
   `onNewInProject(root)` e il renderer apre il dialog con la directory già
   impostata. */
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar } = require('../renderer/sidebar');

function render(sessions, { mode, onNewInProject }) {
  const list = createElement('div');
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
    onNewInProject,
  });
  sidebar.setMode(mode);
  sidebar.render(sessions, null);
  const caps = descendants(list).filter((n) => n.classes.has('group-cap'));
  const headers = caps.map((c) => c.children.find((n) => n.classes.has('group-header')));
  return { caps, headers };
}

/* Il «+» è fratello della linguetta, non figlio: sta all'estremità destra della
   riga, dove non collide con la ✕ della prima sessione. */
const addOf = (cap) => cap.children.find((c) => c.classes.has('group-add'));
const inRepo = { id: 'a', type: 'claude', name: 'a', cwd: '/repo/src', projectRoot: '/repo', alive: true };
const noDir = { id: 'b', type: 'shell', name: 'b', cwd: '', projectRoot: null, alive: true };

ok('progetto: il «+» della linguetta chiede una sessione nuova in quella radice', () => {
  const restore = installDocument();
  try {
    const asked = [];
    const { caps, headers } = render([inRepo], { mode: 'project', onNewInProject: (root) => asked.push(root) });
    const add = addOf(caps[0]);
    assert.ok(add, 'manca il «+» sulla riga della linguetta del progetto');
    assert.match(add.title, /repo/, 'il tooltip non dice in quale progetto: ' + add.title);
    let toggled = false;
    headers[0].onclick = () => { toggled = true; };
    const ev = { propagationStopped: false, stopPropagation() { ev.propagationStopped = true; } };
    add.onclick(ev);
    assert.deepStrictEqual(asked, ['/repo'], 'il callback non ha ricevuto la radice del progetto');
    assert.ok(ev.propagationStopped, 'il click sul «+» deve fermarsi lì, non collassare il gruppo');
    assert.strictEqual(toggled, false);
  } finally { restore(); }
});

ok('progetto: «Senza directory» non ha il «+», non c è una radice in cui creare', () => {
  const restore = installDocument();
  try {
    const { caps } = render([inRepo, noDir], { mode: 'project', onNewInProject: () => {} });
    assert.strictEqual(caps.length, 2);
    assert.ok(addOf(caps[0]), 'il gruppo con radice deve avere il «+»');
    assert.strictEqual(addOf(caps[1]), undefined, 'il gruppo senza directory non deve avere il «+»');
  } finally { restore(); }
});

ok('tipo: nessun «+» sulle linguette, la directory non è nota', () => {
  const restore = installDocument();
  try {
    const { caps } = render([inRepo], { mode: 'type', onNewInProject: () => {} });
    assert.strictEqual(addOf(caps[0]), undefined);
  } finally { restore(); }
});

ok('progetto: senza il callback il «+» non compare', () => {
  const restore = installDocument();
  try {
    const { caps } = render([inRepo], { mode: 'project' });
    assert.strictEqual(addOf(caps[0]), undefined);
  } finally { restore(); }
});
