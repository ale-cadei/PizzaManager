const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ShellIcons = require('../renderer/shell-icons');

test('scelta manuale della shell prevale sui comandi e viene salvata', () => {
  const saved = [];
  let renders = 0;
  const ctx = {
    ShellIcons,
    renderSidebar: () => { renders++; },
    window: { aisess: { setMeta: (id, meta) => saved.push({ id, ...meta }) } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shell-icon-ui.js'), 'utf8'), ctx);
  const tab = { id: 'one', type: 'shell', session: 'ais-shell-one', alive: true,
    iconKey: 'shell', iconMode: 'auto', iconCapture: ShellIcons.createCommandCapture() };
  ctx.setShellIcon(tab, 'github', 'manual');
  ctx.observeShellIconInput(tab, 'docker compose up\r');
  assert.equal(tab.iconKey, 'github');
  assert.equal(tab.iconMode, 'manual');
  assert.deepEqual(saved, [{ id: 'one', iconKey: 'github', iconMode: 'manual' }]);
  assert.equal(renders, 1);

  ctx.setShellIcon(tab, 'shell', 'auto');
  ctx.observeShellIconInput(tab, 'docker compose up\r');
  assert.equal(tab.iconKey, 'docker');
  assert.equal(tab.iconMode, 'auto');
  assert.deepEqual(saved.at(-1), { id: 'one', iconKey: 'docker', iconMode: 'auto' });
});
