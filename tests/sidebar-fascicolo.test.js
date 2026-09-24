const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Il gruppo di sessioni è un fascicolo: linguetta a cartellina sopra, pannello
   sotto. Da chiuso il pannello non c'è e al suo posto si vede lo spessore, uno
   o due fogli: sono l'unica traccia di che cosa contiene. I fogli sono
   pseudo-elementi del CSS, ma QUANTI se ne vedono lo decide la sidebar: senza
   `data-sheets` il CSS non saprebbe distinguere un fascicolo da una sessione da
   uno da dieci. */
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar, sheetCount } = require('../renderer/sidebar');

function render(sessions, activeId, { collapsed = [] } = {}) {
  const list = createElement('div');
  const storage = createStorage({ 'aisess.collapsedGroups': JSON.stringify(collapsed) });
  const sidebar = createSidebar({
    list, count: createElement('span'), storage,
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
  });
  sidebar.render(sessions, activeId);
  return descendants(list).filter((n) => n.classes.has('session-group'));
}

const session = (id, type = 'claude') => ({ id, type, name: id, cwd: '/repo', alive: true });

ok('fascicolo: aperto non ha fogli, le sessioni si vedono già', () => {
  for (const n of [0, 1, 2, 3, 40]) {
    assert.strictEqual(sheetCount(n, false), 0, `aperto con ${n} sessioni non deve avere fogli`);
  }
});

ok('fascicolo: chiuso lo spessore dice quanto contiene, al massimo due fogli', () => {
  assert.strictEqual(sheetCount(0, true), 0, 'senza sessioni non c è spessore da mostrare');
  assert.strictEqual(sheetCount(1, true), 1);
  assert.strictEqual(sheetCount(2, true), 1);
  assert.strictEqual(sheetCount(3, true), 2);
  assert.strictEqual(sheetCount(40, true), 2, 'oltre i due fogli il fondo diventa una frangia');
});

ok('fascicolo: il gruppo dichiara al CSS quanti fogli disegnare', () => {
  const restore = installDocument();
  try {
    const tre = [session('a'), session('b'), session('c')];
    const [aperto] = render(tre, null);
    assert.strictEqual(aperto.dataset.sheets, '0', 'da aperto i fogli non si devono vedere');
    const [chiusoTre] = render(tre, null, { collapsed: ['claude'] });
    assert.strictEqual(chiusoTre.dataset.sheets, '2');
    const [chiusoUno] = render([session('a')], null, { collapsed: ['claude'] });
    assert.strictEqual(chiusoUno.dataset.sheets, '1');
  } finally { restore(); }
});

ok('fascicolo: la linguetta e il «+» stanno sulla stessa riga, il pannello sotto', () => {
  const restore = installDocument();
  try {
    const [group] = render([session('a')], null);
    const [cap, body] = group.children;
    assert.ok(cap.classes.has('group-cap'), 'la riga della linguetta non c è');
    assert.ok(cap.children.some((c) => c.classes.has('group-header')), 'la linguetta non sta nella sua riga');
    assert.ok(body.classes.has('group-body'), 'il pannello non segue la linguetta');
  } finally { restore(); }
});

ok('fascicolo: quello con la sessione in primo piano alza i bordi, aperto o chiuso', () => {
  const restore = installDocument();
  try {
    const sessions = [session('a'), session('b', 'shell')];
    // I gruppi escono in TYPE_ORDER: il terminale prima di Claude
    const [shell, claude] = render(sessions, 'a');
    assert.ok(claude.classes.has('is-focused'), 'il gruppo della sessione attiva non è segnalato');
    assert.ok(!shell.classes.has('is-focused'), 'un gruppo senza la sessione attiva non va segnalato');
    const [, chiuso] = render(sessions, 'a', { collapsed: ['claude'] });
    assert.ok(chiuso.classes.has('is-focused'), 'da collassato il fascicolo attivo perde il bordo');
  } finally { restore(); }
});

/* La Pila: la testata è la prima riga del pannello, non una linguetta che
   sporge. Il pannello sono testata e corpo attaccati; chiuso resta la testata. */
ok('pila: la testata sta dentro il pannello, niente linguetta', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const header = css.match(/\n\.group-header \{[^}]*\}/);
  assert.ok(header, 'manca la regola della testata');
  assert.ok(/background:\s*transparent/.test(header[0]) && /border:\s*0/.test(header[0]),
    'la testata ha un fondo o un bordo suo: torna a essere una linguetta');
  const cap = css.match(/\n\.group-cap \{[^}]*\}/);
  assert.ok(cap && /background:\s*var\(--surface-group\)/.test(cap[0]),
    'la riga della testata non è del materiale del pannello');
  const body = css.match(/\n\.group-body \{[^}]*\}/);
  assert.ok(body && /border-top:\s*0/.test(body[0]) && /border-radius:\s*0 0 /.test(body[0]),
    'il corpo non si attacca alla testata: si vedrebbero due card');
  const closed = css.match(/\n\.group-cap:has\(> \.group-header\[aria-expanded="false"\]\) \{[^}]*\}/);
  assert.ok(closed && /border-radius:\s*var\(--radius-lg\);/.test(closed[0]),
    'da chiuso la testata non si chiude su tutti gli angoli');
});

ok('pila: i fogli usano la geometria dei token e vanno a scalare', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const tokens = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'tokens-gruppo-pila.css'), 'utf8');
  const px = (name) => Number(tokens.match(new RegExp(`--${name}:\\s*([\\d.]+)`))[1]);
  const first = css.match(/\n\.session-group::after\s+\{[^\n}]*\}/);
  const second = css.match(/\n\.session-group::before\s+\{[^\n}]*\}/);
  assert.ok(first && /--sheet-inset-1/.test(first[0]) && /--sheet-offset-1/.test(first[0]), 'il primo foglio non usa i suoi token');
  assert.ok(second && /--sheet-inset-2/.test(second[0]) && /--sheet-offset-2/.test(second[0]), 'il secondo foglio non usa i suoi token');
  assert.ok(px('sheet-inset-2') > px('sheet-inset-1'), 'i fogli non vanno a scalare: la pila non si legge');
  assert.ok(px('sheet-offset-2') > px('sheet-offset-1'), 'il secondo foglio non sta sotto il primo');
  const solo = px('sheet-inset-solo');
  assert.ok(solo > px('sheet-inset-1') && solo < px('sheet-inset-2'), 'il foglio unico non sta in mezzo ai due');
  const h = px('sheet-height');
  assert.ok(h >= 10 && h <= 14, `foglio alto ${h}px: sotto 10 sembra una riga, sopra 14 una seconda card`);
  assert.ok(px('sheet-fade') >= 0.45, 'il foglio più profondo sparisce');
  assert.ok(px('space-group-stack') >= 24, 'il gruppo successivo appoggia sui fogli del precedente');
  assert.ok(/#session-list \{[^}]*gap:\s*var\(--space-group-stack\)/.test(css), 'lo stacco fra gruppi non viene dal token');
});
