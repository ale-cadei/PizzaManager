// renderer/type-color-themes.js: i temi pronti del dialogo «Colori», e il
// dialogo che li propone (renderer/type-colors-ui.js) sul DOM finto.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test: ok } = require('node:test');
const TC = require('../renderer/type-colors');
const { THEMES, themeColors, themeOverrides, matchTheme } = require('../renderer/type-color-themes');
const { TYPE_ORDER } = require('../renderer/session-groups');
const { createTypeColorsDialog } = require('../renderer/type-colors-ui');
const { createElement, fire } = require('./fake-dom');

const KEYS = [TC.ACTION, ...TYPE_ORDER];
const BG = '#070505'; // --bg di tokens.css: il fondo su cui si leggono i colori

ok('temi: ognuno colora il principale e tutti i tipi di sessione, con nomi e id unici', () => {
  assert.ok(THEMES.length >= 4);
  assert.strictEqual(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  assert.strictEqual(new Set(THEMES.map((t) => t.name)).size, THEMES.length);
  for (const t of THEMES) {
    assert.deepStrictEqual(Object.keys(t.colors).sort(), [...KEYS].sort(), t.id);
    assert.deepStrictEqual(TC.normalize(t.colors, KEYS), t.colors, `${t.id}: solo #rrggbb minuscoli`);
  }
});

ok('temi: ogni colore si legge sul fondo scuro e il pulsante primario ha la sua scritta', () => {
  for (const t of THEMES) {
    for (const k of KEYS) assert.ok(TC.contrast(t.colors[k], BG) >= 4.5, `${t.id}.${k} su --bg`);
    const v = TC.actionVars(t.colors.action);
    assert.ok(TC.contrast(v['--action'], v['--action-ink']) >= 4.5, `${t.id}: inchiostro del primario`);
  }
});

ok('temi: congelati, non si modificano per sbaglio', () => {
  assert.ok(Object.isFrozen(THEMES));
  for (const t of THEMES) assert.ok(Object.isFrozen(t) && Object.isFrozen(t.colors), t.id);
});

ok('Forno: è il primo, il predefinito, e i suoi campioni sono quelli di tokens.css', () => {
  const forno = THEMES[0];
  assert.strictEqual(forno.isDefault, true);
  assert.strictEqual(THEMES.filter((t) => t.isDefault).length, 1);
  const css = fs.readFileSync(path.join(__dirname, '../renderer/tokens.css'), 'utf8');
  for (const k of KEYS) {
    const m = new RegExp(`${TC.cssVar(k)}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    assert.ok(m, `${TC.cssVar(k)} in tokens.css`);
    assert.strictEqual(forno.colors[k], m[1].toLowerCase(), k);
  }
});

ok('themeOverrides: un tema salva i suoi colori, il predefinito niente', () => {
  assert.deepStrictEqual(themeOverrides(THEMES[1], KEYS), { ...THEMES[1].colors });
  assert.deepStrictEqual(themeOverrides(THEMES[0], KEYS), {});
});

ok('themeColors: solo le chiavi che il dialogo conosce', () => {
  assert.deepStrictEqual(themeColors(THEMES[0], ['action', 'claude', 'ignoto']),
    { action: THEMES[0].colors.action, claude: THEMES[0].colors.claude });
});

ok('matchTheme: riconosce il tema intero, non uno ritoccato; nessun colore cambiato è Forno', () => {
  const t = THEMES[1];
  assert.strictEqual(matchTheme({ ...t.colors }, THEMES, KEYS), t);
  assert.strictEqual(matchTheme({ ...t.colors, claude: '#000000' }, THEMES, KEYS), null);
  assert.strictEqual(matchTheme({}, THEMES, KEYS), THEMES[0]);
  assert.strictEqual(matchTheme({ codex: THEMES[0].colors.codex }, THEMES, KEYS), THEMES[0]);
  assert.strictEqual(matchTheme({ codex: '#000000' }, THEMES, KEYS), null);
  assert.strictEqual(matchTheme({ ...t.colors, action: t.colors.action.toUpperCase() }, THEMES, KEYS), t);
});

function memoryStorage() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

function setup() {
  const doc = createElement('html');
  doc.createElement = createElement;
  const els = Object.fromEntries(['backdrop', 'list', 'themesEl', 'saveBtn', 'cancelBtn', 'resetBtn'].map((k) => [k, createElement('div')]));
  const inline = {};
  const style = { setProperty: (k, v) => { inline[k] = v; }, removeProperty: (k) => { delete inline[k]; } };
  const readVar = (k) => (k in inline ? inline[k] : '#123456');
  const store = TC.createTypeColorStore(memoryStorage(), KEYS);
  const dialog = createTypeColorsDialog({ doc, ...els, store, types: KEYS, labels: {}, style, readVar, themes: THEMES });
  const chip = (i) => els.themesEl.children[i];
  const input = (k) => els.list.children[KEYS.indexOf(k)].children[2];
  return { els, inline, store, dialog, chip, input };
}

ok('dialogo: un pulsante per tema, col nome e i suoi colori', () => {
  const s = setup();
  s.dialog.open();
  assert.strictEqual(s.els.themesEl.children.length, THEMES.length);
  const first = s.chip(0);
  assert.strictEqual(first.tag, 'button');
  assert.strictEqual(first.children.find((c) => c.className === 'color-theme-name').textContent, THEMES[0].name);
  const swatches = first.children.find((c) => c.className === 'color-theme-swatches').children;
  assert.strictEqual(swatches.length, KEYS.length);
  assert.strictEqual(swatches[0].style.background, THEMES[0].colors.action);
  assert.strictEqual(first.getAttribute('aria-pressed'), 'true', 'nessun colore cambiato: Forno acceso');
  assert.strictEqual(s.chip(1).getAttribute('aria-pressed'), 'false');
});

ok('dialogo: il tema riempie i selettori e si vede subito; Salva lo ricorda', () => {
  const s = setup();
  s.dialog.open();
  fire(s.chip(2), 'click', {});
  assert.strictEqual(s.inline['--action'], THEMES[2].colors.action);
  assert.strictEqual(s.inline['--type-codex'], THEMES[2].colors.codex);
  assert.strictEqual(s.input('claude').value, THEMES[2].colors.claude);
  assert.strictEqual(s.chip(2).getAttribute('aria-pressed'), 'true');
  assert.strictEqual(s.chip(0).getAttribute('aria-pressed'), 'false');
  fire(s.els.saveBtn, 'click', {});
  assert.deepStrictEqual(s.store.get(), { ...THEMES[2].colors });
});

ok('dialogo: un ritocco dopo il tema spegne il tema; Annulla torna a prima del tema', () => {
  const s = setup();
  s.dialog.open();
  fire(s.chip(1), 'click', {});
  s.input('shell').value = '#ffffff';
  fire(s.input('shell'), 'input', {});
  assert.strictEqual(s.chip(1).getAttribute('aria-pressed'), 'false');
  fire(s.els.cancelBtn, 'click', {});
  assert.deepStrictEqual(s.inline, {});
  assert.deepStrictEqual(s.store.get(), {});
});

ok('dialogo: riaperto col tema salvato, il suo pulsante è acceso; Ripristina accende Forno', () => {
  const s = setup();
  s.store.save({ ...THEMES[3].colors });
  s.dialog.open();
  assert.strictEqual(s.chip(3).getAttribute('aria-pressed'), 'true');
  fire(s.els.resetBtn, 'click', {});
  assert.strictEqual(s.chip(3).getAttribute('aria-pressed'), 'false');
  assert.strictEqual(s.chip(0).getAttribute('aria-pressed'), 'true');
});

ok('dialogo: Forno toglie ogni colore cambiato e salva niente, come Ripristina', () => {
  const s = setup();
  s.store.save({ ...THEMES[2].colors });
  s.dialog.open();
  fire(s.chip(0), 'click', {});
  assert.deepStrictEqual(s.inline, {}, 'tornano le variabili di tokens.css');
  assert.strictEqual(s.input('claude').value, '#123456', 'il selettore mostra il valore calcolato');
  assert.strictEqual(s.chip(0).getAttribute('aria-pressed'), 'true');
  fire(s.els.saveBtn, 'click', {});
  assert.deepStrictEqual(s.store.get(), {});
});
