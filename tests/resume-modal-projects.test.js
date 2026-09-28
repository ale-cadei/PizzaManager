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
    resumeTab: 'codex', resumeCache: {}, resumeProjectFilterRoot: null,
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

test('Resume aperto dal gruppo preseleziona progetto e raggruppamento; quello generale li azzera', async () => {
  const { ctx, ids, calls } = createPage();
  await vm.runInContext("openResumeModal({ projectRoot: '/repo' })", ctx);
  assert.equal(ids.get('modal-resume').hidden, false);
  assert.equal(ids.get('resume-group-projects').checked, true);
  assert.equal(ids.get('resume-project-label').textContent, 'Solo /repo');
  assert.deepEqual(calls, [500]);
  assert.deepEqual(ids.get('resume-list').children.map((node) => node.className),
    ['resume-project-heading', 'resume-item']);
  assert.match(ids.get('resume-list').children[0].textContent, /repo/);

  await vm.runInContext('openResumeModal()', ctx);
  assert.equal(ids.get('resume-group-projects').checked, false);
  assert.equal(ids.get('resume-project-scope').hidden, true);
  assert.deepEqual(ids.get('resume-list').children.map((node) => node.className),
    ['resume-item', 'resume-item']);
  assert.deepEqual(calls, [500], 'la lista lunga già letta si può riusare');
});
