const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Esportare in Markdown dalla card (piano 23): l'icona ⤓ c'è solo dove c'è una
   conversazione da leggere, cioè Claude Code e Codex con l'id già noto. La
   sidebar non esporta: passa sessione e card al renderer, che se qualcosa va
   storto ci appoggia il fumetto. */
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar, EXPORTABLE_TYPES } = require('../renderer/sidebar');

function render(sessions, { withExport = true } = {}) {
  const list = createElement('div');
  const calls = { exported: [], selected: [] };
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s),
    onSelect: (id) => calls.selected.push(id), onRename: () => {}, onClose: () => {},
    ...(withExport ? { onExport: (t, anchor) => calls.exported.push({ t, anchor }) } : {}),
  });
  sidebar.render(sessions, null);
  const cards = descendants(list).filter((n) => n.classes.has('session-item'));
  const exportOf = (card) => card.children.find((c) => c.classes.has('export-md')) || null;
  return { cards, exportOf, calls };
}

const session = (over) => ({ id: 'a', type: 'claude', name: 'a', cwd: '/x', alive: true, resumeId: '3b1cafe4-0000-4000-8000-000000000001', ...over });

ok('card: ⤓ su Claude e Codex con l\'id della conversazione', () => {
  const restore = installDocument();
  try {
    const { cards, exportOf } = render([session({ id: 'c' }), session({ id: 'x', type: 'codex' })]);
    assert.strictEqual(cards.length, 2);
    for (const card of cards) {
      const btn = exportOf(card);
      assert.ok(btn, `manca ⤓ sulla card ${card.dataset.id}`);
      assert.match(btn.title, /Markdown/);
    }
  } finally { restore(); }
});

ok('card: niente ⤓ senza id, per shell, opencode e Antigravity, o se il renderer non esporta', () => {
  const restore = installDocument();
  try {
    const none = [
      session({ id: 'n', resumeId: null }),
      session({ id: 's', type: 'shell' }),
      session({ id: 'o', type: 'opencode' }),
      session({ id: 'g', type: 'antigravity' }),
    ];
    const { cards, exportOf } = render(none);
    assert.deepStrictEqual(cards.filter(exportOf).map((c) => c.dataset.id), []);
    const off = render([session()], { withExport: false });
    assert.strictEqual(off.exportOf(off.cards[0]), null);
  } finally { restore(); }
});

ok('card: ⤓ passa sessione e card, e non seleziona la scheda', () => {
  const restore = installDocument();
  try {
    const { cards, exportOf, calls } = render([session()]);
    let stopped = false;
    exportOf(cards[0]).onclick({ stopPropagation() { stopped = true; } });
    assert.strictEqual(stopped, true, 'il click arriverebbe alla card e la selezionerebbe');
    assert.deepStrictEqual(calls.exported.map((c) => [c.t.type, c.t.resumeId]), [['claude', session().resumeId]]);
    assert.strictEqual(calls.exported[0].anchor, cards[0]);
    assert.deepStrictEqual(calls.selected, []);
  } finally { restore(); }
});

ok('sidebar: i tipi esportabili sono quelli di cui si legge il testo', () => {
  assert.deepStrictEqual([...EXPORTABLE_TYPES], ['claude', 'codex']);
});
