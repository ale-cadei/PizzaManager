// app/pty.js: sessioni su un ambiente remoto (docs/plans/93-sessioni-remote.md).
// pty vero, senza tmux; al posto di ssh un finto client che salva i suoi
// argomenti, e poi esegue la riga remota con un sh locale come farebbe il server.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPtyManager, isPtyAvailable } = require('../app/pty');
const { createProfileStore } = require('../lib/profiles');
const { createHistoryStore } = require('../lib/history');
const { createAccountStore } = require('../lib/accounts');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  for (let t = 0; t < ms; t += 25) { if (fn()) return true; await wait(25); }
  return false;
}

/* Finto ssh: `ssh -t -- host "sh -c '…'"`. Salva gli argomenti (uno per riga,
   in JSON) e lancia l'ultimo con sh, come la shell di login del server. */
function fakeSsh(dir) {
  const script = path.join(dir, 'ssh');
  const out = path.join(dir, 'argv.json');
  fs.writeFileSync(script, `#!/bin/sh
"${process.execPath}" -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' "${out}.tmp" "$@"
mv "${out}.tmp" "${out}"
for last; do :; done
exec sh -c "$last"
`, { mode: 0o755 });
  return { script, argv: () => JSON.parse(fs.readFileSync(out, 'utf8')), ready: () => fs.existsSync(out) };
}

function setup(t, { client = true } = {}) {
  if (process.platform === 'win32') { t.skip('il finto ssh e\' uno script sh'); return null; }
  if (!isPtyAvailable()) { t.skip('node-pty non compilato'); return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-remote-'));
  const ssh = fakeSsh(dir);
  const profiles = createProfileStore({ dir });
  const sent = [];
  const mgr = createPtyManager({
    accounts: () => createAccountStore({ dir }), history: () => createHistoryStore({ dir }), profiles,
    sendToRenderer: (ch, v) => sent.push([ch, v]),
    resolveClient: (name) => ({ path: client && name === 'ssh' ? ssh.script : null }),
  });
  t.after(() => mgr.closeAll());
  return { dir, mgr, sent, ssh, profiles, history: () => createHistoryStore({ dir }).load() };
}

const base = { id: 'r1', cols: 80, rows: 24, env: 'ssh:nas' };

test('remoto: chiave d\'ambiente non valida rifiutata prima di lanciare qualcosa', async (t) => {
  const s = setup(t);
  if (!s) return;
  const r = await s.mgr.spawn({ ...base, type: 'shell', cwd: '~', env: 'ssh:-oProxyCommand=sh' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Ambiente non valido/);
  assert.strictEqual(s.ssh.ready(), false);
});

test('remoto: Git ed Editor non si aprono sul server', async (t) => {
  const s = setup(t);
  if (!s) return;
  for (const type of ['git', 'editor']) {
    const r = await s.mgr.spawn({ ...base, type, cwd: '~' });
    assert.strictEqual(r.ok, false, type);
    assert.match(r.error, /solo terminali/);
  }
});

test('remoto: directory relativa rifiutata', async (t) => {
  const s = setup(t);
  if (!s) return;
  const r = await s.mgr.spawn({ ...base, type: 'shell', cwd: 'progetto' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /~\/… oppure/);
});

test('remoto: account a chiave API rifiutato', async (t) => {
  const s = setup(t);
  if (!s) return;
  const r = await s.mgr.spawn({ ...base, type: 'claude', cwd: '~', claudeAccountId: 'acc-1' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /chiave API/);
});

test('remoto: variabili del profilo che sembrano segreti rifiutate', async (t) => {
  const s = setup(t);
  if (!s) return;
  const cfg = s.profiles.load();
  cfg.profiles.claude = [{ id: 'claude:k', label: 'Con chiave', command: 'ANTHROPIC_API_KEY=x claude', resumeArgs: '' }];
  s.profiles.save(cfg);
  const r = await s.mgr.spawn({ ...base, type: 'claude', cwd: '~', commandProfileId: 'claude:k' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ANTHROPIC_API_KEY/);
  assert.strictEqual(s.ssh.ready(), false);
});

test('remoto: client mancante → errore con suggerimento', async (t) => {
  const s = setup(t, { client: false });
  if (!s) return;
  const r = await s.mgr.spawn({ ...base, type: 'shell', cwd: '~' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /'ssh' non trovato/);
});

test('remoto: ssh -t -- host, il comando gira nella directory e la cronologia ricorda l\'ambiente', async (t) => {
  const s = setup(t);
  if (!s) return;
  const cfg = s.profiles.load();
  // `pwd` come "agente": la riga remota entra nella directory e lo esegue
  cfg.profiles.claude = [{ id: 'claude:pwd', label: 'pwd', command: 'pwd', resumeArgs: '' }];
  s.profiles.save(cfg);
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ais remote '")));
  const r = await s.mgr.spawn({ ...base, type: 'claude', cwd: `${work}/`, commandProfileId: 'claude:pwd' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.env, 'ssh:nas');
  assert.strictEqual(r.cwd, work, 'la barra finale va via');

  assert.ok(await until(s.ssh.ready), 'il finto ssh deve partire');
  const argv = s.ssh.argv();
  assert.deepStrictEqual(argv.slice(0, 3), ['-t', '--', 'nas']);
  assert.strictEqual(argv.length, 4);
  const output = () => s.sent.filter(([ch]) => ch === 'pty-data').map(([, v]) => v.data).join('');
  assert.ok(await until(() => output().includes(work)), `il comando deve girare in ${work}: ${output()}`);

  const last = s.history().at(-1);
  assert.strictEqual(last.env, 'ssh:nas');
  assert.strictEqual(last.cwd, work);
  assert.strictEqual(last.type, 'claude');
});
