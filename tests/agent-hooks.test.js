// lib/agent-hooks.js: hook iniettati per processo, mai nella config dell'utente (piano 46)
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('../lib/agent-hooks');

test('Claude: --settings con gli hook, comando costante verso la env', () => {
  const r = H.injectFor('claude', { platform: 'linux', args: [], env: {} });
  assert.equal(r.exact, true);
  assert.equal(r.args[0], '--settings');
  const s = JSON.parse(r.args[1]);
  const cmd = (ev) => s.hooks[ev][0].hooks[0].command;
  assert.equal(cmd('Stop'), 'printf waiting > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('UserPromptSubmit'), 'printf running > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('PreToolUse'), 'printf running > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('PostToolUse'), 'printf running > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('StopFailure'), 'printf waiting > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('SessionStart'), 'printf ready > "$AISESS_SIGNAL_FILE"');
  assert.equal(s.hooks.Notification[0].matcher, 'permission_prompt|elicitation_dialog');
  assert.equal(cmd('Notification'), 'printf permission > "$AISESS_SIGNAL_FILE"');
});

test('Claude su Windows: powershell esplicito', () => {
  const s = JSON.parse(H.claudeSettings({ platform: 'win32' }));
  const h = s.hooks.Stop[0].hooks[0];
  assert.equal(h.shell, 'powershell');
  assert.equal(h.command, 'Set-Content -NoNewline -LiteralPath $env:AISESS_SIGNAL_FILE -Value waiting');
});

test('Claude: se il profilo ha già --settings non si tocca niente', () => {
  for (const args of [['--settings', 'x.json'], ['--settings=x.json']]) {
    assert.deepEqual(H.injectFor('claude', { platform: 'linux', args, env: {} }), { args: [], env: {}, exact: false });
  }
});

test('opencode: plugin via OPENCODE_CONFIG_CONTENT, unito alla config utente', () => {
  const r = H.injectFor('opencode', { pluginPath: '/u/hooks/opencode-signal.mjs', platform: 'linux', args: [], env: {} });
  assert.equal(r.exact, true);
  assert.deepEqual(r.args, []);
  assert.deepEqual(JSON.parse(r.env.OPENCODE_CONFIG_CONTENT), { plugin: ['file:///u/hooks/opencode-signal.mjs'] });
});

test('opencode: il file:// di Windows ha la lettera di unità', () => {
  const r = H.injectFor('opencode', { pluginPath: 'C:\\Users\\a\\hooks\\opencode-signal.mjs', platform: 'win32', args: [], env: {} });
  assert.deepEqual(JSON.parse(r.env.OPENCODE_CONFIG_CONTENT).plugin, ['file:///C:/Users/a/hooks/opencode-signal.mjs']);
});

test('opencode: OPENCODE_CONFIG_CONTENT del profilo vince, niente plugin', () => {
  const r = H.injectFor('opencode', { pluginPath: '/p.mjs', platform: 'linux', args: [], env: { OPENCODE_CONFIG_CONTENT: '{}' } });
  assert.equal(r.exact, false);
  assert.deepEqual(r.env, {});
});

test('Codex: notifiche OSC 9 sempre, senza file', () => {
  const r = H.injectFor('codex', { platform: 'linux', args: [], env: {} });
  assert.deepEqual(r.args, ['-c', 'tui.notifications=true', '-c', 'tui.notification_method=osc9', '-c', 'tui.notification_condition=always']);
  assert.equal(r.exact, true);
});

test('shell, antigravity: niente', () => {
  for (const t of ['shell', 'antigravity', 'git']) {
    assert.deepEqual(H.injectFor(t, { platform: 'linux', args: [], env: {} }), { args: [], env: {}, exact: false });
  }
});

test('plugin opencode: scrive lo stato giusto per ogni evento', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-plugin-'));
  const file = path.join(dir, 'stato');
  const mod = path.join(dir, 'p.mjs');
  fs.writeFileSync(mod, H.opencodePluginSource());
  const prev = process.env.AISESS_SIGNAL_FILE;
  process.env.AISESS_SIGNAL_FILE = file;
  try {
    const plugin = (await import(pathToFileURL(mod).href)).default;
    const hooks = await plugin({});
    assert.equal(fs.readFileSync(file, 'utf8'), 'ready', 'al caricamento');
    const cases = [
      [{ type: 'session.status', properties: { status: { type: 'busy' } } }, 'running'],
      [{ type: 'permission.updated', properties: {} }, 'permission'],
      [{ type: 'permission.replied', properties: {} }, 'running'],
      [{ type: 'question.asked', properties: {} }, 'permission'],
      [{ type: 'question.rejected', properties: {} }, 'running'],
      [{ type: 'session.status', properties: { status: { type: 'retry' } } }, 'running'],
      [{ type: 'session.status', properties: { status: { type: 'idle' } } }, 'waiting'],
    ];
    for (const [event, want] of cases) {
      await hooks.event({ event });
      assert.equal(fs.readFileSync(file, 'utf8'), want, event.type);
    }
    await hooks.event({ event: { type: 'message.updated', properties: {} } });
    assert.equal(fs.readFileSync(file, 'utf8'), 'waiting', 'eventi ignoti non scrivono');
  } finally {
    if (prev === undefined) delete process.env.AISESS_SIGNAL_FILE; else process.env.AISESS_SIGNAL_FILE = prev;
  }
});

test('plugin opencode: senza env non scrive e non rompe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-plugin-'));
  const mod = path.join(dir, 'p2.mjs');
  fs.writeFileSync(mod, H.opencodePluginSource());
  const prev = process.env.AISESS_SIGNAL_FILE;
  delete process.env.AISESS_SIGNAL_FILE;
  try {
    const hooks = await (await import(pathToFileURL(mod).href)).default({});
    await hooks.event({ event: { type: 'session.status', properties: { status: { type: 'busy' } } } });
    assert.deepEqual(fs.readdirSync(dir), ['p2.mjs']);
  } finally {
    if (prev !== undefined) process.env.AISESS_SIGNAL_FILE = prev;
  }
});
