// app/pty.js + lib/agent-signals.js: la sessione riceve gli hook e il segnale
// torna alla sua scheda (piano 46). pty vero, senza tmux, con un finto agente.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPtyManager, isPtyAvailable } = require('../app/pty');
const { createAgentSignalStore } = require('../lib/agent-signals');
const { createProfileStore } = require('../lib/profiles');
const { createHistoryStore } = require('../lib/history');
const { createAccountStore } = require('../lib/accounts');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  for (let t = 0; t < ms; t += 25) { if (fn()) return true; await wait(25); }
  return false;
}

/* Il finto agente: salva i suoi argomenti e scrive uno stato dove l'hook lo scriverebbe. */
function fakeAgent(dir) {
  const script = path.join(dir, 'fake-agent.js');
  fs.writeFileSync(script, `
    const fs = require('fs');
    fs.writeFileSync(${JSON.stringify(path.join(dir, 'argv.json'))}, JSON.stringify({ argv: process.argv.slice(2), env: process.env.OPENCODE_CONFIG_CONTENT || null }));
    if (process.env.AISESS_SIGNAL_FILE) fs.writeFileSync(process.env.AISESS_SIGNAL_FILE, 'permission');
    setTimeout(() => {}, 1500);
  `);
  return script;
}

function setup(t, type, extraProfile = {}) {
  if (!isPtyAvailable()) { t.skip('node-pty non compilato'); return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-wiring-'));
  const profiles = createProfileStore({ dir });
  const cfg = profiles.load();
  cfg.profiles[type] = [{ id: `${type}:t`, label: 'Finto', command: `${process.execPath} ${fakeAgent(dir)}`, resumeArgs: '', ...extraProfile }];
  profiles.save(cfg);
  const store = createAgentSignalStore({ dir });
  const sent = [];
  const mgr = createPtyManager({
    accounts: () => createAccountStore({ dir }), history: () => createHistoryStore({ dir }), profiles,
    sendToRenderer: (ch, v) => sent.push([ch, v]), signalStore: () => store,
  });
  const stop = store.watch((key, state) => mgr.onSignal(key, state));
  const argv = () => JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8'));
  return { dir, mgr, sent, store, stop, argv };
}

test('claude: --settings in coda agli args e il permesso arriva alla scheda', async (t) => {
  const s = setup(t, 'claude');
  if (!s) return;
  try {
    const r = await s.mgr.spawn({ id: 'tab1', type: 'claude', cwd: s.dir, commandProfileId: 'claude:t', cols: 80, rows: 24 });
    assert.strictEqual(r.ok, true, r.error);
    const got = () => s.sent.find(([ch, v]) => ch === 'agent-signal' && v.id === 'tab1');
    assert.ok(await until(got), 'nessun agent-signal');
    assert.deepStrictEqual(got()[1], { id: 'tab1', state: 'permission' });
    assert.ok(s.argv().argv.includes('--settings'), 'hook di Claude non passati');
  } finally { s.stop(); s.mgr.closeAll(); }
});

test('opencode: il plugin passa per OPENCODE_CONFIG_CONTENT ed è scritto in userData', async (t) => {
  const s = setup(t, 'opencode');
  if (!s) return;
  try {
    const r = await s.mgr.spawn({ id: 'tab2', type: 'opencode', cwd: s.dir, commandProfileId: 'opencode:t', cols: 80, rows: 24 });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(await until(() => fs.existsSync(path.join(s.dir, 'argv.json'))));
    const plugin = JSON.parse(s.argv().env).plugin[0];
    assert.ok(plugin.startsWith('file://') && plugin.endsWith('/hooks/opencode-signal.mjs'), plugin);
    assert.ok(fs.existsSync(new URL(plugin)), 'il plugin deve esistere su disco');
  } finally { s.stop(); s.mgr.closeAll(); }
});

test('shell: niente iniezione, niente segnale', async (t) => {
  const s = setup(t, 'shell');
  if (!s) return;
  try {
    const r = await s.mgr.spawn({ id: 'tab3', type: 'shell', cwd: s.dir, commandProfileId: 'shell:t', cols: 80, rows: 24 });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(await until(() => fs.existsSync(path.join(s.dir, 'argv.json'))));
    await wait(200);
    assert.deepStrictEqual(s.argv().argv, []);
    assert.ok(!s.sent.some(([ch]) => ch === 'agent-signal'));
  } finally { s.stop(); s.mgr.closeAll(); }
});

test('chiusura senza tmux: il file del segnale se ne va con la sessione', async (t) => {
  const s = setup(t, 'claude');
  if (!s) return;
  try {
    await s.mgr.spawn({ id: 'tab4', type: 'claude', cwd: s.dir, commandProfileId: 'claude:t', cols: 80, rows: 24 });
    const file = s.store.pathFor('tab-tab4');
    assert.ok(await until(() => fs.existsSync(file)));
    s.mgr.close('tab4');
    assert.strictEqual(fs.existsSync(file), false);
  } finally { s.stop(); s.mgr.closeAll(); }
});
