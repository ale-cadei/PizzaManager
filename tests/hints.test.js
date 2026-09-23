const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Suggerimenti una volta sola (renderer/hints.js): quale mostrare dato lo
   stato della sidebar, e il ricordo di quelli già visti. */
const { nextHint, createHintStore, HINTS } = require('../renderer/hints');
const Groups = require('../renderer/session-groups');
const { createStorage } = require('./fake-dom');

const s = (id, type, projectRoot) => ({ id, type, projectRoot });
const groups = (sessions, mode = 'type') => Groups.groupSessions(sessions, { mode });

ok('suggerimenti: nessuno con una chat sola', () => {
  assert.strictEqual(nextHint({ seen: new Set(), groups: groups([s('a', 'claude')]), mode: 'type' }), null);
});

ok('suggerimenti: due chat nello stesso gruppo → trascinare e rinominare, sulla seconda card', () => {
  const h = nextHint({ seen: new Set(), groups: groups([s('a', 'claude'), s('b', 'shell'), s('c', 'claude')]), mode: 'type' });
  assert.strictEqual(h.id, HINTS.cards);
  assert.deepStrictEqual(h.anchor, { kind: 'card', key: 'c' });
  assert.ok(/trascin/i.test(h.title + h.text) && /doppio click/i.test(h.text));
});

ok('suggerimenti: due progetti in modalità Progetto → la linguetta, sul secondo', () => {
  const g = groups([s('a', 'claude', '/p/alfa'), s('b', 'claude', '/p/beta')], 'project');
  const h = nextHint({ seen: new Set(), groups: g, mode: 'project' });
  assert.strictEqual(h.id, HINTS.projects);
  assert.deepStrictEqual(h.anchor, { kind: 'group', key: '/p/beta' });
});

ok('suggerimenti: «Senza directory» non conta come progetto', () => {
  const g = groups([s('a', 'claude', '/p/alfa'), s('b', 'claude', null)], 'project');
  assert.strictEqual(nextHint({ seen: new Set(), groups: g, mode: 'project' }), null);
});

ok('suggerimenti: uno già visto non torna, e si passa al successivo', () => {
  const g = groups([s('a', 'claude', '/p/alfa'), s('a2', 'shell', '/p/alfa'), s('b', 'claude', '/p/beta')], 'project');
  assert.strictEqual(nextHint({ seen: new Set(), groups: g, mode: 'project' }).id, HINTS.cards);
  assert.strictEqual(nextHint({ seen: new Set([HINTS.cards]), groups: g, mode: 'project' }).id, HINTS.projects);
  assert.strictEqual(nextHint({ seen: new Set([HINTS.cards, HINTS.projects]), groups: g, mode: 'project' }), null);
});

ok('suggerimenti: il ricordo di quelli visti sopravvive a uno store nuovo e a dati rotti', () => {
  const storage = createStorage();
  createHintStore(storage).markSeen(HINTS.cards);
  assert.ok(createHintStore(storage).seen().has(HINTS.cards));
  assert.strictEqual(createHintStore(createStorage({ 'aisess.seenHints': '{rotto' })).seen().size, 0);
});
