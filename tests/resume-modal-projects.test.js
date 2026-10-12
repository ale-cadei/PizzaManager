const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createElement } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const ResumeProjects = require('../renderer/resume-projects');

function createPage() {
  const ids = new Map();
  for (const id of ['modal-resume', 'resume-search', 'resume-group-projects', 'resume-project-scope',
    'resume-project-label', 'resume-list']) ids.set(id, createElement('div'));
  const tabs = ['opencode', 'codex', 'search'].map((name) => {
    const tab = createElement('button');
    tab.dataset.tab = name;
    return tab;
  });
  const calls = [];
  const ctx = {
    document: { createElement, querySelector: (selector) => ids.get(selector.slice(1)) },
    $: (selector) => ids.get(selector.slice(1)),
    $$: () => tabs,
    resumeTab: 'codex', resumeCache: {}, resumeProjectFilterRoot: null, resumeDirFilter: null,
    updateResumeAccountRow: async () => {},
    resolveProjectRoot: async (cwd) => cwd.startsWith('/repo/') ? '/repo' : cwd,
    Groups, titleStore: { nameFor: () => null },
    Titles: { displayName: (_store, _source, _id, title) => title },
    Icons: { markup: () => '' }, Sidebar: { EXPORTABLE_TYPES: [] },
    escapeHtml: (s) => String(s),
    ConvSearch: { createSearchRunner: () => ({ run: async () => {}, cancel: () => {}, schedule: () => {} }) },
    console,
  };
  ctx.window = ctx;
  ctx.AisessResumeProjects = ResumeProjects;
  ctx.aisess = {
    listCodex: async (limit) => {
      calls.push(limit);
      return { ok: true, sessions: [
        { id: 'a', title: 'Nel progetto', cwd: '/repo/src' },
        { id: 'b', title: 'Altrove', cwd: '/altro' },
      ] };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'resume.js'), 'utf8'), ctx);
  return { ctx, ids, calls };
}

const toggleOf = (group) => group.children[0].children[0];

test('Resume aperto dal gruppo preseleziona progetto e raggruppamento; quello generale li azzera', async () => {
  const { ctx, ids, calls } = createPage();
  await vm.runInContext("openResumeModal({ projectRoot: '/repo' })", ctx);
  assert.equal(ids.get('modal-resume').hidden, false);
  assert.equal(ids.get('resume-group-projects').checked, true);
  assert.equal(ids.get('resume-project-label').textContent, 'Solo /repo');
  assert.deepEqual(calls, [500]);
  assert.deepEqual(ids.get('resume-list').children.map((node) => node.className),
    ['resume-project-group']);
  const group = ids.get('resume-list').children[0];
  assert.match(toggleOf(group).children[1].textContent, /repo/);
  assert.equal(group.children[1].children.length, 1);

  await vm.runInContext('openResumeModal()', ctx);
  assert.equal(ids.get('resume-group-projects').checked, false);
  assert.equal(ids.get('resume-project-scope').hidden, true);
  assert.deepEqual(ids.get('resume-list').children.map((node) => node.className),
    ['resume-item', 'resume-item']);
  assert.deepEqual(calls, [500], 'la lista lunga già letta si può riusare');
});

test('i gruppi del Resume si comprimono singolarmente e restano compressi dopo un aggiornamento', async () => {
  const { ctx, ids } = createPage();
  await vm.runInContext('openResumeModal()', ctx);
  ids.get('resume-group-projects').checked = true;
  await vm.runInContext('renderResumeList()', ctx);
  const list = ids.get('resume-list');
  assert.equal(list.children.length, 2);
  const first = list.children[0];
  const second = list.children[1];
  assert.equal(first.children[0].tag, 'h3');
  assert.equal(toggleOf(first).tag, 'button');
  assert.equal(toggleOf(first).getAttribute('aria-expanded'), 'true');
  assert.equal(toggleOf(first).getAttribute('aria-controls'), first.children[1].id);
  assert.equal(first.children[1].hidden, false);
  toggleOf(first).onclick();
  assert.equal(toggleOf(first).getAttribute('aria-expanded'), 'false');
  assert.equal(first.children[1].hidden, true);
  assert.equal(second.children[1].hidden, false, 'gli altri progetti restano aperti');

  await vm.runInContext('renderResumeList()', ctx);
  assert.equal(list.children[0].children[1].hidden, true, 'la scelta sopravvive al ridisegno');
  toggleOf(list.children[0]).onclick();
  assert.equal(list.children[0].children[1].hidden, false);
  assert.equal(toggleOf(list.children[0]).getAttribute('aria-expanded'), 'true');
});

test('Resume aperto da un worktree mostra solo le sue chat, senza raggruppare', async () => {
  const { ctx, ids } = createPage();
  ctx.aisess.listCodex = async () => ({ ok: true, sessions: [
    { id: 'a', title: 'Nel worktree', cwd: '/repo.worktrees/feat-x' },
    { id: 'b', title: 'Nella principale', cwd: '/repo/src' },
  ] });
  await vm.runInContext("openResumeModal({ dir: '/repo.worktrees/feat-x' })", ctx);
  assert.equal(ids.get('resume-group-projects').checked, false);
  assert.equal(ids.get('resume-project-scope').hidden, false);
  assert.equal(ids.get('resume-project-label').textContent, 'Solo /repo.worktrees/feat-x');
  const items = ids.get('resume-list').children;
  assert.deepEqual(items.map((node) => node.className), ['resume-item']);
  assert.match(items[0].innerHTML, /Nel worktree/);

  await vm.runInContext('openResumeModal()', ctx);
  assert.equal(ids.get('resume-project-scope').hidden, true);
  assert.equal(ids.get('resume-list').children.length, 2);
});
