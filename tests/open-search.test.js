const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert');
const { test } = require('node:test');
const { createElement, createStorage } = require('./fake-dom');
const ConvSearch = require('../renderer/search-results');
const ShellSearch = require('../renderer/shell-search');

test('sidebar: risultati shell e Claude mostrano tipo e logo, e aprono la scheda giusta', async () => {
  const nodes = new Map(['#session-list', '#count', '#group-mode-type', '#group-mode-project', '#open-search', '#sidebar', '#open-search-results']
    .map((selector) => [selector, createElement('div')]));
  nodes.get('#open-search').value = 'git ';
  const tabs = new Map([
    ['shell-1', { id: 'shell-1', type: 'shell', name: 'Terminale progetto', startedAt: 2000,
      term: { buffer: { active: { length: 1, getLine: () => ({ translateToString: () => 'git status' }) } } } }],
    ['claude-1', { id: 'claude-1', type: 'claude', name: 'Chat di Claude', resumeId: 'uuid-1', startedAt: 1000 }],
  ]);
  let selected = null;
  const calls = [];
  const ctx = {
    window: null, tabs, activeId: null, console, setTimeout, clearTimeout,
    document: { querySelector: (s) => nodes.get(s), createElement },
    $: (s) => nodes.get(s),
    Sidebar: { createSidebar: () => ({ render() {} }) },
    Groups: { TYPE_LABELS: { claude: 'Claude' } },
    Order: {}, ConvSearch, ShellSearch,
    Icons: { markup: (type) => `<svg data-type="${type}"></svg>` },
    escapeHtml: (s) => String(s),
    mutedNote: (message) => { const p = createElement('p'); p.textContent = message; return p; },
    setActive: (id) => { selected = id; },
  };
  ctx.window = ctx;
  ctx.localStorage = createStorage();
  ctx.AisessHints = null;
  ctx.aisess = {
    searchConversations: async (query, scope) => {
      calls.push({ query, scope });
      return { ok: true, results: [{ source: 'claude', id: 'uuid-1', mtime: 1000, hits: 1,
        snippets: [{ role: 'user', before: '', match: 'git ', after: 'status' }] }] };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'session-list.js'), 'utf8'), ctx);
  vm.runInContext('onOpenSearchInput()', ctx);
  await vm.runInContext("openSearch.run('git ')", ctx);

  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0].scope)), [{ source: 'claude', id: 'uuid-1' }]);
  const results = nodes.get('#open-search-results').children;
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].children[0].children[0].children[1].textContent, 'Shell');
  assert.ok(results[0].children[0].children[0].children[0].innerHTML.includes('shell'));
  assert.strictEqual(results[1].children[0].children[0].children[1].textContent, 'Claude');
  results[1].children[0].listeners.get('click')[0]();
  assert.strictEqual(selected, 'claude-1');
  assert.strictEqual(nodes.get('#open-search').value, '');
});
