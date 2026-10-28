// Le larghezze dei caratteri nel terminale devono essere quelle di chi sta
// dietro (psmux, tmux), o i ridisegni per differenze finiscono spostati.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { Unicode11Addon } = require('@xterm/addon-unicode11');
const TermUnicode = require('../renderer/term-unicode');

/** Il fornitore Unicode 11 vero, preso dall'addon come farebbe xterm. */
function unicode11() {
  let provider = null;
  new Unicode11Addon().activate({ unicode: { register: (p) => { provider = p; }, versions: [] } });
  return provider;
}

/** Larghezza di una stringa come la calcola xterm (UnicodeService.getStringCellWidth). */
function cellWidth(provider, text) {
  const { width, shouldJoin } = TermUnicode;
  let total = 0;
  let preceding = 0;
  for (const ch of text) {
    const props = provider.charProperties(ch.codePointAt(0), preceding);
    let w = width(props);
    if (shouldJoin(props)) w -= width(preceding);
    total += w;
    preceding = props;
  }
  return total;
}

ok('term-unicode: simbolo + VS16 vale 2 colonne, come in psmux e tmux', () => {
  const p = TermUnicode.createProvider(unicode11());
  assert.strictEqual(cellWidth(unicode11(), '⚔️'), 1, 'con Unicode 11 da solo era 1: era questo lo sfasamento');
  assert.strictEqual(cellWidth(p, '⚔️'), 2);
  assert.strictEqual(cellWidth(p, '🗺️'), 2);
  assert.strictEqual(cellWidth(p, '🖥️'), 2);
  assert.strictEqual(cellWidth(p, 'a⚔️b'), 4);
});

ok('term-unicode: un emoji gia largo con VS16 resta 2, non diventa 4', () => {
  const p = TermUnicode.createProvider(unicode11());
  assert.strictEqual(cellWidth(p, '📛️'), 2);
  assert.strictEqual(cellWidth(p, '👥'), 2);
});

ok('term-unicode: le emoji dopo Unicode 11 valgono 2 come in psmux, e 🤻 🥆 1', () => {
  const base = unicode11();
  const p = TermUnicode.createProvider(base);
  for (const text of ['🥲', '🫠', '🪖', '🫡', '🛜', '🟰', '🩷', '🫨', '🪿']) {
    assert.strictEqual(cellWidth(base, text), 1, `${text}: Unicode 11 lo contava 1`);
    assert.strictEqual(cellWidth(p, text), 2, text);
  }
  assert.strictEqual(cellWidth(p, '🤻'), 1);
  assert.strictEqual(cellWidth(p, '🥆'), 1);
  assert.strictEqual(p.wcwidth(0x1F972), 2);
  assert.strictEqual(cellWidth(p, '🫠️'), 2, 'gia larga: VS16 non la porta a 3');
  assert.strictEqual(cellWidth(p, 'a🥲b'), 4);
});

ok('term-unicode: bandiere, ZWJ e toni della pelle restano come in Unicode 11, come in psmux', () => {
  const base = unicode11();
  const p = TermUnicode.createProvider(base);
  // Misurati sulla griglia di psmux: 2, 4, 4.
  assert.strictEqual(cellWidth(p, '🇮🇹'), 2);
  assert.strictEqual(cellWidth(p, '👨‍💻'), 4);
  assert.strictEqual(cellWidth(p, '👍🏽'), 4);
});

ok('term-unicode: il resto e Unicode 11 com e', () => {
  const base = unicode11();
  const p = TermUnicode.createProvider(base);
  for (const text of ['ciao', 'àèìòù €', '⚔', '●⎿✻⏵─', '漢字', 'é', '️']) {
    assert.strictEqual(cellWidth(p, text), cellWidth(base, text), text);
  }
  assert.strictEqual(p.wcwidth(0x1F465), base.wcwidth(0x1F465));
  assert.strictEqual(p.version, TermUnicode.VERSION);
});

function fakeTerm() {
  const t = { registered: {}, active: null };
  t.unicode = { register: (p) => { t.registered[p.version] = p; }, set activeVersion(v) { t.active = v; } };
  return t;
}

ok('term-unicode: con psmux install attiva Unicode 11 con la regola di VS16', () => {
  const term = fakeTerm();
  assert.strictEqual(TermUnicode.install(term, Unicode11Addon, { psmux: true }), true);
  assert.strictEqual(term.active, TermUnicode.VERSION);
  assert.strictEqual(cellWidth(term.registered[term.active], '⚔️'), 2);
  assert.strictEqual(cellWidth(term.registered[term.active], '🥲'), 2);
});

ok('term-unicode: con tmux solo Unicode 11, perche non ogni tmux allarga con VS16', () => {
  const term = fakeTerm();
  assert.strictEqual(TermUnicode.install(term, Unicode11Addon), true);
  assert.strictEqual(term.active, '11');
  assert.strictEqual(cellWidth(term.registered[term.active], '⚔️'), 1);
  assert.strictEqual(cellWidth(term.registered[term.active], '👥'), 2);
});
