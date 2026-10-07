// renderer/type-color-themes.js: i temi del dialogo «Colori», lo stato
// { theme, custom } coi ritocchi per tema e il suo store; il dialogo che li
// propone (renderer/type-colors-ui.js) sul DOM finto.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test: ok } = require('node:test');
const TC = require('../renderer/type-colors');
const Themes = require('../renderer/type-color-themes');
const { THEMES } = Themes;
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

ok('Forno: è il primo, il predefinito senza dirlo nel nome, e i suoi colori sono quelli di tokens.css', () => {
  const forno = THEMES[0];
  assert.strictEqual(forno.name, 'Forno');
  assert.strictEqual(forno.isDefault, true);
  assert.strictEqual(THEMES.filter((t) => t.isDefault).length, 1);
  const css = fs.readFileSync(path.join(__dirname, '../renderer/tokens.css'), 'utf8');
  for (const k of KEYS) {
    const m = new RegExp(`${TC.cssVar(k)}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    assert.ok(m, `${TC.cssVar(k)} in tokens.css`);
    assert.strictEqual(forno.colors[k], m[1].toLowerCase(), k);
  }
});

ok('themeColors: solo le chiavi che il dialogo conosce', () => {
  assert.deepStrictEqual(Themes.themeColors(THEMES[0], ['action', 'claude', 'ignoto']),
    { action: THEMES[0].colors.action, claude: THEMES[0].colors.claude });
});

const ghiaccio = THEMES.find((t) => t.id === 'ghiaccio');
const mare = THEMES.find((t) => t.id === 'mare');

ok('stato: si parte da Forno senza ritocchi, e su :root non si scrive niente', () => {
  const s = Themes.initialState(THEMES);
  assert.deepStrictEqual(s, { theme: 'forno', custom: {} });
  assert.deepStrictEqual(Themes.appliedColors(s, THEMES, KEYS), {});
  assert.deepStrictEqual(Themes.palette(s, THEMES, KEYS), { ...THEMES[0].colors });
});

ok('stato: un ritocco personalizza il tema in uso, e solo quello', () => {
  const s = Themes.setColor(Themes.selectTheme(Themes.initialState(THEMES), THEMES, 'ghiaccio'), THEMES, KEYS, 'codex', '#ABCDEF');
  assert.deepStrictEqual(s.custom, { ghiaccio: { codex: '#abcdef' } });
  assert.strictEqual(Themes.isCustomized(s), true);
  assert.strictEqual(Themes.themeLabel(s, ghiaccio), 'Ghiaccio (personalizzato)');
  assert.strictEqual(Themes.themeLabel(s, mare), 'Mare di notte');
  assert.deepStrictEqual(Themes.appliedColors(s, THEMES, KEYS), { ...ghiaccio.colors, codex: '#abcdef' });
});

ok('stato: il ritocco resta al suo tema anche passando a un altro e tornando', () => {
  let s = Themes.selectTheme(Themes.initialState(THEMES), THEMES, 'ghiaccio');
  s = Themes.setColor(s, THEMES, KEYS, 'codex', '#abcdef');
  s = Themes.selectTheme(s, THEMES, 'mare');
  assert.deepStrictEqual(Themes.appliedColors(s, THEMES, KEYS), { ...mare.colors });
  assert.strictEqual(Themes.isCustomized(s), false);
  s = Themes.selectTheme(s, THEMES, 'ghiaccio');
  assert.strictEqual(Themes.palette(s, THEMES, KEYS).codex, '#abcdef');
});

ok('stato: su Forno si scrivono solo i ritocchi, il resto lo dà tokens.css', () => {
  const s = Themes.setColor(Themes.initialState(THEMES), THEMES, KEYS, 'claude', '#010203');
  assert.deepStrictEqual(Themes.appliedColors(s, THEMES, KEYS), { claude: '#010203' });
  assert.strictEqual(Themes.themeLabel(s, THEMES[0]), 'Forno (personalizzato)');
});

ok('stato: un colore riportato a quello del tema non è più un ritocco', () => {
  let s = Themes.setColor(Themes.initialState(THEMES), THEMES, KEYS, 'shell', '#000000');
  s = Themes.setColor(s, THEMES, KEYS, 'shell', THEMES[0].colors.shell.toUpperCase());
  assert.deepStrictEqual(s.custom, {});
});

ok('stato: ripristina un colore, o tutti quelli del solo tema in uso', () => {
  let s = Themes.setColor(Themes.initialState(THEMES), THEMES, KEYS, 'shell', '#000000');
  s = Themes.selectTheme(s, THEMES, 'mare');
  s = Themes.setColor(s, THEMES, KEYS, 'codex', '#111111');
  s = Themes.setColor(s, THEMES, KEYS, 'git', '#222222');
  const one = Themes.resetColor(s, 'codex');
  assert.deepStrictEqual(one.custom, { forno: { shell: '#000000' }, mare: { git: '#222222' } });
  const all = Themes.resetTheme(s);
  assert.deepStrictEqual(all.custom, { forno: { shell: '#000000' } }, 'Forno tiene i suoi');
  assert.strictEqual(Themes.isCustomized(all), false);
});

ok('stato: le transizioni non toccano lo stato di partenza', () => {
  const s = Object.freeze({ theme: 'mare', custom: Object.freeze({ mare: Object.freeze({ git: '#222222' }) }) });
  Themes.setColor(s, THEMES, KEYS, 'codex', '#111111');
  Themes.resetColor(s, 'git');
  Themes.resetTheme(s);
  Themes.selectTheme(s, THEMES, 'bosco');
  assert.deepStrictEqual(s, { theme: 'mare', custom: { mare: { git: '#222222' } } });
});

ok('normalizeState: temi sconosciuti, colori sporchi e ritocchi uguali al tema non passano', () => {
  const raw = { theme: 'inesistente', custom: { mare: { codex: 'red', git: '#ABCDEF', claude: mare.colors.claude }, fantasma: { shell: '#000000' } } };
  assert.deepStrictEqual(Themes.normalizeState(raw, THEMES, KEYS), { theme: 'forno', custom: { mare: { git: '#abcdef' } } });
  assert.deepStrictEqual(Themes.normalizeState(null, THEMES, KEYS), Themes.initialState(THEMES));
  assert.deepStrictEqual(Themes.normalizeState({ custom: 'x' }, THEMES, KEYS), Themes.initialState(THEMES));
});

ok('fromLegacy: la scelta piatta diventa il tema più vicino coi ritocchi', () => {
  assert.deepStrictEqual(Themes.fromLegacy({}, THEMES, KEYS), Themes.initialState(THEMES));
  assert.deepStrictEqual(Themes.fromLegacy({ ...ghiaccio.colors }, THEMES, KEYS), { theme: 'ghiaccio', custom: {} });
  assert.deepStrictEqual(Themes.fromLegacy({ ...ghiaccio.colors, codex: '#ABCDEF' }, THEMES, KEYS),
    { theme: 'ghiaccio', custom: { ghiaccio: { codex: '#abcdef' } } });
  assert.deepStrictEqual(Themes.fromLegacy({ claude: '#010203' }, THEMES, KEYS),
    { theme: 'forno', custom: { forno: { claude: '#010203' } } }, 'un colore cambiato a mano: Forno ritoccato');
});

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

ok('store: di fabbrica lo storage resta vuoto; salva tema e ritocchi', () => {
  const storage = memoryStorage();
  const store = Themes.createThemeStore(storage, KEYS);
  assert.deepStrictEqual(store.get(), Themes.initialState(THEMES));
  const next = { theme: 'mare', custom: { ghiaccio: { codex: '#abcdef' } } };
  assert.deepStrictEqual(store.save(next), next);
  assert.deepStrictEqual(JSON.parse(storage.data[Themes.STORAGE_KEY]), next);
  assert.deepStrictEqual(Themes.createThemeStore(storage, KEYS).get(), next, 'riletto da capo');
  store.save(Themes.initialState(THEMES));
  assert.ok(!(Themes.STORAGE_KEY in storage.data), 'tornare di fabbrica non lascia niente in giro');
});

ok('store: i dati salvati rotti o manomessi non passano', () => {
  const broken = memoryStorage({ [Themes.STORAGE_KEY]: '{non json' });
  assert.deepStrictEqual(Themes.createThemeStore(broken, KEYS).get(), Themes.initialState(THEMES));
  const evil = memoryStorage({ [Themes.STORAGE_KEY]: JSON.stringify({ theme: 'mare', custom: { mare: { shell: 'url(javascript:x)' } } }) });
  assert.deepStrictEqual(Themes.createThemeStore(evil, KEYS).get(), { theme: 'mare', custom: {} });
});

ok('store: migra la scelta piatta del piano 39 e al salvataggio la toglie', () => {
  const storage = memoryStorage({ [Themes.LEGACY_KEY]: JSON.stringify({ ...ghiaccio.colors, codex: '#abcdef' }) });
  const store = Themes.createThemeStore(storage, KEYS);
  assert.deepStrictEqual(store.get(), { theme: 'ghiaccio', custom: { ghiaccio: { codex: '#abcdef' } } });
  store.save(store.get());
  assert.ok(!(Themes.LEGACY_KEY in storage.data));
  assert.ok(Themes.STORAGE_KEY in storage.data);
});

ok('store: la scelta nuova vince su una piatta rimasta indietro', () => {
  const storage = memoryStorage({
    [Themes.STORAGE_KEY]: JSON.stringify({ theme: 'bosco', custom: {} }),
    [Themes.LEGACY_KEY]: JSON.stringify({ ...ghiaccio.colors }),
  });
  assert.strictEqual(Themes.createThemeStore(storage, KEYS).get().theme, 'bosco');
});

function setup({ storage = memoryStorage(), onChange } = {}) {
  const doc = createElement('html');
  doc.createElement = createElement;
  const els = Object.fromEntries(['backdrop', 'list', 'themesEl', 'saveBtn', 'cancelBtn', 'resetBtn'].map((k) => [k, createElement('div')]));
  els.backdrop.hidden = true;
  const inline = {};
  const style = { setProperty: (k, v) => { inline[k] = v; }, removeProperty: (k) => { delete inline[k]; } };
  const store = Themes.createThemeStore(storage, KEYS);
  const labels = { action: 'Colore principale', shell: 'Terminale' };
  const dialog = createTypeColorsDialog({ doc, ...els, store, types: KEYS, labels, style, themes: THEMES, onChange });
  const chip = (id) => els.themesEl.children[THEMES.findIndex((t) => t.id === id)];
  const chipName = (id) => chip(id).children.find((c) => c.className === 'color-theme-name').textContent;
  const row = (k) => els.list.children[KEYS.indexOf(k)];
  const input = (k) => row(k).children.find((c) => c.tag === 'input');
  const rowReset = (k) => row(k).children.find((c) => c.className.includes('type-color-reset'));
  const pick = (k, v) => { input(k).value = v; fire(input(k), 'input', {}); };
  return { doc, els, inline, store, storage, dialog, chip, chipName, row, input, rowReset, pick };
}

ok('dialogo: un pulsante per tema, col nome e i suoi colori; una riga per colore', () => {
  const s = setup();
  s.dialog.open();
  assert.strictEqual(s.els.backdrop.hidden, false);
  assert.strictEqual(s.els.themesEl.children.length, THEMES.length);
  const first = s.chip('forno');
  assert.strictEqual(first.tag, 'button');
  assert.strictEqual(s.chipName('forno'), 'Forno');
  const swatches = first.children.find((c) => c.className === 'color-theme-swatches').children;
  assert.strictEqual(swatches.length, KEYS.length);
  assert.strictEqual(swatches[0].style.background, THEMES[0].colors.action);
  assert.strictEqual(first.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(s.chip('mare').getAttribute('aria-pressed'), 'false');
  assert.strictEqual(s.els.list.children.length, KEYS.length);
  assert.strictEqual(s.row('shell').children[1].textContent, 'Terminale');
  assert.strictEqual(s.row('codex').children[1].textContent, 'codex', 'senza etichetta, il nome del tipo');
  assert.deepStrictEqual(KEYS.map((k) => s.input(k).value), KEYS.map((k) => THEMES[0].colors[k]));
});

ok('dialogo: senza ritocchi nessun ripristino in vista', () => {
  const s = setup();
  s.dialog.open();
  assert.strictEqual(s.els.resetBtn.hidden, true);
  for (const k of KEYS) assert.strictEqual(s.rowReset(k).hidden, true, k);
});

ok('dialogo: il tema riempie i selettori e si vede subito; Salva lo ricorda', () => {
  const s = setup();
  s.dialog.open();
  fire(s.chip('bosco'), 'click', {});
  const bosco = THEMES.find((t) => t.id === 'bosco');
  assert.strictEqual(s.inline['--action'], bosco.colors.action);
  assert.strictEqual(s.inline['--type-codex'], bosco.colors.codex);
  assert.strictEqual(s.input('claude').value, bosco.colors.claude);
  assert.strictEqual(s.chip('bosco').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(s.chip('forno').getAttribute('aria-pressed'), 'false');
  fire(s.els.saveBtn, 'click', {});
  assert.strictEqual(s.els.backdrop.hidden, true);
  assert.deepStrictEqual(s.store.get(), { theme: 'bosco', custom: {} });
});

ok('dialogo: un ritocco rende il tema «personalizzato» e accende i ripristini', () => {
  const s = setup();
  s.dialog.open();
  fire(s.chip('ghiaccio'), 'click', {});
  s.pick('codex', '#abcdef');
  assert.strictEqual(s.inline['--type-codex'], '#abcdef', 'anteprima dal vivo');
  assert.strictEqual(s.chipName('ghiaccio'), 'Ghiaccio (personalizzato)');
  assert.strictEqual(s.chip('ghiaccio').getAttribute('aria-pressed'), 'true', 'resta il tema in uso');
  assert.strictEqual(s.els.resetBtn.hidden, false);
  assert.strictEqual(s.rowReset('codex').hidden, false);
  assert.strictEqual(s.rowReset('claude').hidden, true);
});

ok('dialogo: cambiare tema e tornare ritrova il ritocco, anche dopo aver salvato e riaperto', () => {
  const s = setup();
  s.dialog.open();
  fire(s.chip('ghiaccio'), 'click', {});
  s.pick('codex', '#abcdef');
  fire(s.chip('mare'), 'click', {});
  assert.strictEqual(s.input('codex').value, mare.colors.codex);
  assert.strictEqual(s.els.resetBtn.hidden, true, 'Mare non ha ritocchi');
  assert.strictEqual(s.chipName('ghiaccio'), 'Ghiaccio (personalizzato)', 'il nome lo dice anche da spento');
  fire(s.chip('ghiaccio'), 'click', {});
  assert.strictEqual(s.input('codex').value, '#abcdef');
  assert.strictEqual(s.inline['--type-codex'], '#abcdef');
  fire(s.chip('mare'), 'click', {});
  fire(s.els.saveBtn, 'click', {});
  s.dialog.open();
  fire(s.chip('ghiaccio'), 'click', {});
  assert.strictEqual(s.input('codex').value, '#abcdef');
});

ok('dialogo: il Ripristina di una riga torna al colore del tema', () => {
  const s = setup();
  s.dialog.open();
  fire(s.chip('ghiaccio'), 'click', {});
  s.pick('codex', '#abcdef');
  s.pick('shell', '#000000');
  fire(s.rowReset('codex'), 'click', {});
  assert.strictEqual(s.input('codex').value, ghiaccio.colors.codex);
  assert.strictEqual(s.inline['--type-codex'], ghiaccio.colors.codex);
  assert.strictEqual(s.rowReset('codex').hidden, true);
  assert.strictEqual(s.input('codex').focused, true, 'il pulsante sparisce, il fuoco va al selettore');
  assert.strictEqual(s.chipName('ghiaccio'), 'Ghiaccio (personalizzato)', 'shell è ancora ritoccato');
});

ok('dialogo: «Ripristina colori predefiniti» toglie i ritocchi del solo tema in uso e poi sparisce', () => {
  const s = setup();
  s.dialog.open();
  s.pick('claude', '#010203');
  fire(s.chip('ghiaccio'), 'click', {});
  s.pick('codex', '#abcdef');
  fire(s.els.resetBtn, 'click', {});
  assert.strictEqual(s.input('codex').value, ghiaccio.colors.codex);
  assert.strictEqual(s.chipName('ghiaccio'), 'Ghiaccio');
  assert.strictEqual(s.chipName('forno'), 'Forno (personalizzato)', 'Forno tiene il suo');
  assert.strictEqual(s.els.resetBtn.hidden, true);
  assert.strictEqual(s.chip('ghiaccio').focused, true, 'il fuoco va al tema in uso');
});

ok('dialogo: su Forno i ritocchi tolti riportano le variabili di tokens.css', () => {
  const s = setup();
  s.dialog.open();
  s.pick('claude', '#010203');
  assert.deepStrictEqual(s.inline, { '--type-claude': '#010203' });
  fire(s.els.resetBtn, 'click', {});
  assert.deepStrictEqual(s.inline, {});
  fire(s.els.saveBtn, 'click', {});
  assert.ok(!(Themes.STORAGE_KEY in s.storage.data));
});

ok('dialogo: Annulla ed Esc rimettono la scelta salvata, ritocchi compresi', () => {
  const s = setup();
  s.store.save({ theme: 'mare', custom: {} });
  s.dialog.open();
  fire(s.chip('ghiaccio'), 'click', {});
  s.pick('codex', '#abcdef');
  fire(s.els.cancelBtn, 'click', {});
  assert.strictEqual(s.inline['--type-codex'], mare.colors.codex);
  assert.deepStrictEqual(s.store.get(), { theme: 'mare', custom: {} });
  s.dialog.open();
  assert.strictEqual(s.chipName('ghiaccio'), 'Ghiaccio', 'il ritocco annullato non resta');
  s.pick('shell', '#ffffff');
  fire(s.doc, 'keydown', { key: 'Escape' });
  assert.strictEqual(s.dialog.isOpen(), false);
  assert.strictEqual(s.inline['--type-shell'], mare.colors.shell);
});

ok('dialogo: avvisa chi legge i colori da fuori (xterm), anche quando si annulla', () => {
  let changes = 0;
  const s = setup({ onChange: () => { changes += 1; } });
  s.dialog.open();
  s.pick('action', '#00aa88');
  assert.strictEqual(s.inline['--action'], '#00aa88');
  assert.strictEqual(changes, 1);
  fire(s.els.cancelBtn, 'click', {});
  assert.deepStrictEqual(s.inline, {});
  assert.strictEqual(changes, 2);
});
