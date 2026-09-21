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

ok('fascicolo: il CSS salda la linguetta al pannello e non chiude l angolo di innesto', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const header = css.match(/\n\.group-header \{[^}]*\}/);
  assert.ok(header, 'manca la regola della linguetta');
  assert.ok(/border-bottom:\s*0/.test(header[0]) && /margin-bottom:\s*-1px/.test(header[0]),
    'la linguetta non è saldata al pannello: resterebbe una card con una decorazione sopra');
  const body = css.match(/\n\.group-body \{[^}]*\}/);
  assert.ok(body, 'manca la regola del pannello');
  assert.ok(/border-radius:\s*0 /.test(body[0]),
    'il pannello arrotonda l angolo in alto a sinistra, dove si innesta la linguetta');
  assert.ok(/\.group-header\[aria-expanded="false"\][\s\S]{0,200}border-radius:\s*var\(--radius[^;]*\);/.test(css),
    'da collassato la linguetta non si chiude su tutti gli angoli');
});
