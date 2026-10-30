const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, createStorage, fire } = require('./fake-dom');
const P = require('../renderer/editor-panel');

/* Il pannello dell'albero della scheda editor (docs/plans/62): preferenze in
   localStorage, applicate al body come variabile CSS e classe. */

function fakeDoc() {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.body = createElement('body');
  return doc;
}
const widthOf = (doc) => doc.body.style['--editor-tree-w'];
const isHidden = (doc) => doc.body.classList.contains('editor-tree-hidden');
const brokenStorage = () => ({
  getItem() { throw new Error('negato'); },
  setItem() { throw new Error('pieno'); },
});

ok('clampWidth: fra 160 e la metà della scheda, con la scheda stretta vince il minimo', () => {
  assert.strictEqual(P.clampWidth(100, 500), 160);
  assert.strictEqual(P.clampWidth(900, 500), 500);
  assert.strictEqual(P.clampWidth(300.4, 500), 300);
  assert.strictEqual(P.clampWidth(300, 100), 160);
});

ok('readPanelPrefs: i default senza niente salvato o con valori rotti', () => {
  const def = { width: 256, hidden: false };
  assert.deepStrictEqual(P.readPanelPrefs(createStorage()), def);
  assert.deepStrictEqual(P.readPanelPrefs(createStorage({ 'aisess.editorTreeW': 'abc', 'aisess.editorTreeHidden': 'forse' })), def);
  assert.deepStrictEqual(P.readPanelPrefs(createStorage({ 'aisess.editorTreeW': '90' })), def);
  assert.deepStrictEqual(P.readPanelPrefs(createStorage({ 'aisess.editorTreeW': '320', 'aisess.editorTreeHidden': '1' })), { width: 320, hidden: true });
});

ok('readPanelPrefs e savePanelPrefs: uno storage che lancia non ferma niente', () => {
  assert.deepStrictEqual(P.readPanelPrefs(brokenStorage()), { width: 256, hidden: false });
  assert.doesNotThrow(() => P.savePanelPrefs(brokenStorage(), { width: 300, hidden: true }));
});

ok('savePanelPrefs: larghezza in px e nascosto come 1/0', () => {
  const storage = createStorage();
  P.savePanelPrefs(storage, { width: 300, hidden: true });
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), '300');
  assert.strictEqual(storage.getItem('aisess.editorTreeHidden'), '1');
});

ok('createPanel: applica subito alla pagina le preferenze salvate', () => {
  const doc = fakeDoc();
  const panel = P.createPanel({ doc, storage: createStorage({ 'aisess.editorTreeW': '320', 'aisess.editorTreeHidden': '1' }) });
  assert.strictEqual(widthOf(doc), '320px');
  assert.strictEqual(isHidden(doc), true);
  assert.deepStrictEqual(panel.prefs(), { width: 320, hidden: true });
});

ok('toggle: nasconde e rimostra, e se lo ricorda', () => {
  const doc = fakeDoc();
  const storage = createStorage();
  const panel = P.createPanel({ doc, storage });
  assert.strictEqual(isHidden(doc), false);
  panel.toggle();
  assert.strictEqual(isHidden(doc), true);
  assert.deepStrictEqual(P.readPanelPrefs(storage), { width: 256, hidden: true });
  panel.toggle();
  assert.strictEqual(isHidden(doc), false);
  assert.strictEqual(storage.getItem('aisess.editorTreeHidden'), '0');
});

ok('toggle: con uno storage che lancia apre e chiude lo stesso', () => {
  const doc = fakeDoc();
  const panel = P.createPanel({ doc, storage: brokenStorage() });
  panel.toggle();
  assert.strictEqual(isHidden(doc), true);
  panel.toggle();
  assert.strictEqual(isHidden(doc), false);
});

/** Striscia agganciata a un albero largo 240 in una scheda larga 1000. */
function resizable(storage = createStorage()) {
  const doc = fakeDoc();
  const win = createElement('window');
  const resizer = createElement('div');
  const side = createElement('aside');
  const wrap = createElement('div');
  side.rect = { ...side.rect, width: 240 };
  wrap.rect = { ...wrap.rect, width: 1000 };
  const panel = P.createPanel({ doc, storage });
  panel.attachResizer(resizer, { side, wrap, win });
  return { doc, win, resizer, storage, panel };
}

ok('striscia: trascinare allarga e stringe fra i limiti, e salva al rilascio', () => {
  const { doc, win, resizer, storage, panel } = resizable();
  const down = fire(resizer, 'pointerdown', { clientX: 240, button: 0 });
  assert.strictEqual(down.defaultPrevented, true);
  assert.ok(doc.body.classList.contains('editor-resizing'));
  fire(win, 'pointermove', { clientX: 340 });
  assert.strictEqual(widthOf(doc), '340px');
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), null, 'durante il trascinamento non si salva');
  fire(win, 'pointermove', { clientX: 2000 });
  assert.strictEqual(widthOf(doc), '500px', 'al massimo metà della scheda');
  fire(win, 'pointermove', { clientX: 0 });
  assert.strictEqual(widthOf(doc), '160px', 'al minimo 160');
  fire(win, 'pointerup', {});
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), '160');
  assert.ok(!doc.body.classList.contains('editor-resizing'));
  assert.strictEqual(win.listeners.get('pointermove').length, 0, 'il rilascio stacca i listener');
  assert.strictEqual(win.listeners.get('pointerup').length, 0);
  assert.strictEqual(panel.prefs().width, 160);
});

ok('striscia: cattura il puntatore, e se la cattura si perde il trascinamento finisce e salva', () => {
  const { doc, win, resizer, storage } = resizable();
  const captured = [];
  resizer.setPointerCapture = (id) => captured.push(id);
  fire(resizer, 'pointerdown', { clientX: 240, button: 0, pointerId: 7 });
  assert.deepStrictEqual(captured, [7]);
  fire(win, 'pointermove', { clientX: 300 });
  fire(resizer, 'lostpointercapture', {});
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), '300');
  assert.ok(!doc.body.classList.contains('editor-resizing'));
  assert.strictEqual(win.listeners.get('pointermove').length, 0);
  assert.strictEqual(resizer.listeners.get('lostpointercapture').length, 0);
});

ok('striscia: il tasto destro non comincia un trascinamento', () => {
  const { win, resizer } = resizable();
  const down = fire(resizer, 'pointerdown', { clientX: 240, button: 2 });
  assert.strictEqual(down.defaultPrevented, false);
  assert.strictEqual(win.listeners.has('pointermove'), false);
});

ok('striscia: il doppio click torna a 256 e salva', () => {
  const { doc, resizer, storage } = resizable(createStorage({ 'aisess.editorTreeW': '400' }));
  assert.strictEqual(widthOf(doc), '400px');
  fire(resizer, 'dblclick', {});
  assert.strictEqual(widthOf(doc), '256px');
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), '256');
});

ok('isToggleKey: solo Ctrl+B, senza altri modificatori', () => {
  const k = (p) => P.isToggleKey({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...p });
  assert.strictEqual(k({ ctrlKey: true, key: 'b' }), true);
  assert.strictEqual(k({ ctrlKey: true, key: 'B' }), true, 'anche col blocco maiuscole');
  assert.strictEqual(k({ key: 'b' }), false);
  assert.strictEqual(k({ ctrlKey: true, shiftKey: true, key: 'B' }), false);
  assert.strictEqual(k({ ctrlKey: true, altKey: true, key: 'b' }), false);
  assert.strictEqual(k({ ctrlKey: true, key: 'v' }), false);
});

/* ---------- file aperti da tastiera (docs/plans/70) ---------- */

ok('openIndexKey: Alt+1…9 fuori dal Mac, Ctrl+1…9 sul Mac (Opzione+cifra scrive ~, #…)', () => {
  const key = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  assert.strictEqual(P.openIndexKey(key('Digit1', { altKey: true }), false), 0);
  assert.strictEqual(P.openIndexKey(key('Digit9', { altKey: true }), false), 8);
  assert.strictEqual(P.openIndexKey(key('Digit0', { altKey: true }), false), -1);
  assert.strictEqual(P.openIndexKey(key('Digit1'), false), -1);
  assert.strictEqual(P.openIndexKey(key('Digit1', { altKey: true, ctrlKey: true }), false), -1, 'AltGr su Windows è Ctrl+Alt');
  assert.strictEqual(P.openIndexKey(key('Digit1', { altKey: true, shiftKey: true }), false), -1);
  assert.strictEqual(P.openIndexKey(key('Digit5', { altKey: true }), true), -1, 'sul Mac Opzione+5 è ~');
  assert.strictEqual(P.openIndexKey(key('Digit5', { ctrlKey: true }), true), 4);
  assert.strictEqual(P.openIndexKey(key('Digit5', { ctrlKey: true }), false), -1);
  assert.strictEqual(P.openKeyLabel(3, false), 'Alt 3');
  assert.strictEqual(P.openKeyLabel(3, true), '⌃3');
});
