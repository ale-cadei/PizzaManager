// renderer/type-colors.js e type-colors-ui.js: colori dei tipi di sessione
// scelti dal menu View. Store su un localStorage finto, dialogo sul DOM finto.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const TC = require('../renderer/type-colors');
const { createTypeColorsDialog } = require('../renderer/type-colors-ui');
const { createElement, fire } = require('./fake-dom');

const TYPES = ['shell', 'opencode', 'claude', 'codex', 'antigravity'];
const DEFAULTS = { shell: '#F2C14E', opencode: '#4ADE80', claude: '#FF9147', codex: '#5AA2FF', antigravity: '#FF6B6B' };

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

/** Lo stile di :root con sotto il foglio: la variabile inline vince, tolta torna tokens.css. */
function rootStyle() {
  const inline = {};
  return {
    inline,
    setProperty: (k, v) => { inline[k] = v; },
    removeProperty: (k) => { delete inline[k]; },
    read: (k) => (k in inline ? inline[k] : DEFAULTS[k.replace('--type-', '')]),
  };
}

ok('store: di default nessun colore cambiato, e lo storage resta vuoto', () => {
  const storage = memoryStorage();
  const store = TC.createTypeColorStore(storage, TYPES);
  assert.deepStrictEqual(store.get(), {});
  store.save({ claude: '#123ABC' });
  assert.deepStrictEqual(JSON.parse(storage.data[TC.STORAGE_KEY]), { claude: '#123abc' });
  store.reset();
  assert.ok(!(TC.STORAGE_KEY in storage.data), 'ripristinare non lascia un {} in giro');
});

ok('store: i dati salvati sporchi o manomessi non passano', () => {
  const storage = memoryStorage({ [TC.STORAGE_KEY]: JSON.stringify({ shell: 'red', codex: '#00ff00', ignoto: '#ffffff', claude: '#12345' }) });
  assert.deepStrictEqual(TC.createTypeColorStore(storage, TYPES).get(), { codex: '#00ff00' });
  const broken = memoryStorage({ [TC.STORAGE_KEY]: '{non json' });
  assert.deepStrictEqual(TC.createTypeColorStore(broken, TYPES).get(), {});
  const store = TC.createTypeColorStore(memoryStorage(), TYPES);
  assert.deepStrictEqual(store.save({ shell: 'url(javascript:x)', opencode: '#abcdef' }), { opencode: '#abcdef' });
});

ok('applyTypeColors: scrive i colori cambiati e toglie gli altri, così torna il predefinito', () => {
  const style = rootStyle();
  TC.applyTypeColors(style, { claude: '#111111', codex: '#222222' }, TYPES);
  assert.deepStrictEqual(style.inline, { '--type-claude': '#111111', '--type-codex': '#222222' });
  TC.applyTypeColors(style, { codex: '#333333' }, TYPES);
  assert.deepStrictEqual(style.inline, { '--type-codex': '#333333' });
  assert.strictEqual(style.read('--type-claude'), DEFAULTS.claude);
});

ok('toInputColor: il valore calcolato diventa #rrggbb minuscolo', () => {
  assert.strictEqual(TC.toInputColor(' #F2C14E'), '#f2c14e');
  assert.strictEqual(TC.toInputColor('#AbC'), '#aabbcc');
  assert.strictEqual(TC.toInputColor('rgb(1,2,3)'), '#000000');
});

function setupDialog(storage = memoryStorage()) {
  const doc = createElement('html');
  doc.createElement = createElement;
  const els = Object.fromEntries(['backdrop', 'list', 'saveBtn', 'cancelBtn', 'resetBtn'].map((k) => [k, createElement('div')]));
  els.backdrop.hidden = true;
  const style = rootStyle();
  const store = TC.createTypeColorStore(storage, TYPES);
  const labels = { shell: 'Terminale', claude: 'Claude' };
  const dialog = createTypeColorsDialog({ doc, ...els, store, types: TYPES, labels, style, readVar: style.read });
  const inputOf = (i) => els.list.children[i].children[2];
  return { doc, els, style, store, storage, dialog, inputOf };
}

ok('dialogo: una riga per tipo coi colori attuali, i predefiniti di tokens.css', () => {
  const s = setupDialog();
  s.dialog.open();
  assert.strictEqual(s.els.backdrop.hidden, false);
  assert.strictEqual(s.els.list.children.length, TYPES.length);
  assert.strictEqual(s.els.list.children[0].children[1].textContent, 'Terminale');
  assert.strictEqual(s.els.list.children[1].children[1].textContent, 'opencode', 'senza etichetta, il nome del tipo');
  assert.deepStrictEqual(TYPES.map((_, i) => s.inputOf(i).value), TYPES.map((t) => DEFAULTS[t].toLowerCase()));
});

ok('dialogo: il ritocco si vede subito, Salva lo ricorda', () => {
  const s = setupDialog();
  s.dialog.open();
  s.inputOf(2).value = '#010203';
  fire(s.inputOf(2), 'input', {});
  assert.strictEqual(s.style.inline['--type-claude'], '#010203', 'anteprima dal vivo');
  fire(s.els.saveBtn, 'click', {});
  assert.strictEqual(s.els.backdrop.hidden, true);
  assert.deepStrictEqual(s.store.get(), { claude: '#010203' });
  assert.strictEqual(s.style.inline['--type-claude'], '#010203');
});

ok('dialogo: Annulla ed Esc rimettono i colori salvati', () => {
  const s = setupDialog();
  s.store.save({ codex: '#0000ff' });
  s.dialog.open();
  s.inputOf(3).value = '#ff0000';
  fire(s.inputOf(3), 'input', {});
  fire(s.els.cancelBtn, 'click', {});
  assert.deepStrictEqual(s.style.inline, { '--type-codex': '#0000ff' });
  s.dialog.open();
  s.inputOf(0).value = '#ffffff';
  fire(s.inputOf(0), 'input', {});
  fire(s.doc, 'keydown', { key: 'Escape' });
  assert.strictEqual(s.dialog.isOpen(), false);
  assert.deepStrictEqual(s.style.inline, { '--type-codex': '#0000ff' });
});

ok('dialogo: Ripristina predefiniti torna a tokens.css, e resta così solo se si salva', () => {
  const s = setupDialog();
  s.store.save({ shell: '#000000' });
  TC.applyTypeColors(s.style, s.store.get(), TYPES);
  s.dialog.open();
  assert.strictEqual(s.inputOf(0).value, '#000000');
  fire(s.els.resetBtn, 'click', {});
  assert.strictEqual(s.inputOf(0).value, DEFAULTS.shell.toLowerCase());
  assert.deepStrictEqual(s.style.inline, {});
  fire(s.els.saveBtn, 'click', {});
  assert.deepStrictEqual(s.store.get(), {});
  assert.ok(!(TC.STORAGE_KEY in s.storage.data));
});

ok('colore principale: una scelta sola scrive --action e tutte le sue varianti', () => {
  const style = rootStyle();
  const keys = [TC.ACTION, ...TYPES];
  TC.applyTypeColors(style, { action: '#3366CC' }, keys);
  assert.deepStrictEqual(Object.keys(style.inline).sort(), [...TC.ACTION_VARS].sort());
  assert.strictEqual(style.inline['--action'], '#3366cc');
  assert.strictEqual(style.inline['--action-ring'], 'rgba(51,102,204,0.22)');
  TC.applyTypeColors(style, {}, keys);
  assert.deepStrictEqual(style.inline, {}, 'tolto, tornano tutte le varianti di tokens.css');
});

ok('colore principale: le varianti hanno col colore gli stessi rapporti del pomodoro', () => {
  const v = TC.actionVars('#F04E23');
  assert.strictEqual(v['--action-soft'], '#2a100a', 'fondo tenue ≈ #2B120A di tokens.css');
  assert.strictEqual(v['--action-ink'], '#180804', 'inchiostro scuro ≈ #1A0A05');
  assert.ok(TC.contrast(v['--action'], v['--action-ink']) >= 4.5);
});

ok('colore principale: su un principale scuro la scritta del pulsante diventa chiara', () => {
  const v = TC.actionVars('#1a237e');
  assert.strictEqual(v['--action-ink'], '#f6f1ec');
  assert.ok(TC.contrast(v['--action'], v['--action-ink']) >= 4.5);
});

ok('dialogo: il colore principale apre l\'elenco e avvisa chi legge i colori da fuori (xterm)', () => {
  const doc = createElement('html');
  doc.createElement = createElement;
  const els = Object.fromEntries(['backdrop', 'list', 'saveBtn', 'cancelBtn', 'resetBtn'].map((k) => [k, createElement('div')]));
  const style = rootStyle();
  const keys = [TC.ACTION, ...TYPES];
  const store = TC.createTypeColorStore(memoryStorage(), keys);
  let changes = 0;
  const dialog = createTypeColorsDialog({ doc, ...els, store, types: keys, labels: { action: 'Colore principale' }, style,
    readVar: (k) => (k === '--action' ? '#F04E23' : style.read(k)), onChange: () => { changes += 1; } });
  dialog.open();
  const first = els.list.children[0];
  assert.strictEqual(first.children[1].textContent, 'Colore principale');
  assert.strictEqual(first.children[2].value, '#f04e23');
  first.children[2].value = '#00aa88';
  fire(first.children[2], 'input', {});
  assert.strictEqual(style.inline['--action'], '#00aa88');
  assert.strictEqual(changes, 1);
  fire(els.cancelBtn, 'click', {});
  assert.deepStrictEqual(style.inline, {});
  assert.strictEqual(changes, 2, 'anche l\'annullamento riallinea il terminale');
});
