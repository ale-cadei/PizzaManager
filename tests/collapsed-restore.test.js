// Alla riapertura dell'app i gruppi collassati restano collassati. Il
// ripristino passa da createTab → setActive, che espande il gruppo della
// scheda: senza `reveal: false` ogni gruppo con una sessione si riapriva, e
// la sidebar salvava la riapertura in localStorage.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert');
const { test } = require('node:test');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

function load(file, ctx) {
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RENDERER_DIR, file), 'utf8'), ctx, { filename: file });
  return ctx;
}

function tabsContext() {
  const expanded = [];
  const tab = { id: 'tab-1', type: 'claude', wrap: { classList: { toggle() {} } } };
  const ctx = {
    console, setTimeout: () => 0, clearTimeout() {},
    window: {},
    ConfirmBubble: { createConfirmBubble: () => ({}) },
    tabs: new Map([[tab.id, tab]]),
    activeId: null,
    attention: { left() {} },
    clearAttention() {},
    sidebar: { expandGroupOf: (t) => { expanded.push(t.id); return true; } },
    renderSidebar() {},
    refreshUsage() {},
    refreshChanges: async () => {},
  };
  load('tabs.js', ctx);
  return { ctx, expanded };
}

test('setActive: selezionare una scheda espande il suo gruppo', () => {
  const { ctx, expanded } = tabsContext();
  ctx.setActive('tab-1');
  assert.deepStrictEqual(expanded, ['tab-1']);
});

test('setActive: con reveal false il gruppo collassato resta com era', () => {
  const { ctx, expanded } = tabsContext();
  ctx.setActive('tab-1', { reveal: false });
  assert.deepStrictEqual(expanded, []);
});

test('ripristino: le sessioni tmux riattaccate non riaprono i gruppi', async () => {
  const opened = [];
  const ctx = {
    console, tmuxAvailable: true, tabs: new Map(),
    window: { aisess: { listLive: async () => [{ name: 'ais-1', type: 'claude', cwd: '/p' }] } },
    createTab: async (type, opts) => { opened.push(opts); },
  };
  load('restore.js', ctx);
  await ctx.reattachLiveSessions();
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(opened[0].reveal, false);
});

test('ripristino: le sessioni ricreate dopo un riavvio non riaprono i gruppi', async () => {
  const opened = [];
  const ctx = {
    console, window: {},
    restorePlanFor: (s) => ({ type: s.type, name: s.label, cwd: s.cwd, mode: 'fresh' }),
    createTab: async (type, opts) => { opened.push(opts); },
    createGitTab: async (opts) => { opened.push(opts); },
  };
  load('restore.js', ctx);
  await ctx.sessionRestoreItem({ type: 'shell', label: 'x', cwd: '/p' }).restore();
  await ctx.gitRestoreItem({ cwd: '/p' }).restore();
  assert.deepStrictEqual(opened.map((o) => o.reveal), [false, false]);
});

test('ripristino: le schede git riaperte da sole non riaprono i gruppi', async () => {
  const opened = [];
  const ctx = {
    console, window: { aisess: { gitSessions: async () => ({ ok: true, sessions: [{ cwd: '/p' }] }) } },
  };
  load('git-tab.js', ctx);
  ctx.createGitTab = async (opts) => { opened.push(opts); };
  await ctx.restoreGitSessions();
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(opened[0].reveal, false);
});

test('createTab e createGitTab passano reveal a setActive', () => {
  const tabs = fs.readFileSync(path.join(RENDERER_DIR, 'tabs.js'), 'utf8');
  const git = fs.readFileSync(path.join(RENDERER_DIR, 'git-tab.js'), 'utf8');
  // createTab apre un terminale vero (xterm, pty): qui basta sapere che inoltra l'opzione
  assert.ok(/setActive\(id, \{ reveal \}\)/.test(tabs), 'createTab non inoltra reveal a setActive');
  assert.ok(/createGitTab\(\{ name, cwd, startedAt, reveal \}\)/.test(tabs), 'createTab non inoltra reveal alla scheda git');
  assert.ok(/setActive\(id, \{ reveal \}\)/.test(git), 'createGitTab non inoltra reveal a setActive');
});
