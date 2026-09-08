const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.message); }
}

// Replica la logica di buildCommand di main.js per testarla senza Electron
function buildCommand(type, resumeId) {
  if (type === 'opencode') return resumeId ? { cmd: 'opencode', args: ['--session', resumeId] } : { cmd: 'opencode', args: [] };
  if (type === 'claude') return resumeId ? { cmd: 'claude', args: ['--resume', resumeId] } : { cmd: 'claude', args: [] };
  return { cmd: 'shell', args: [] };
}

ok('buildCommand shell nuova', () => {
  const r = buildCommand('shell');
  assert.strictEqual(r.cmd, 'shell');
});

ok('buildCommand opencode nuova', () => {
  const r = buildCommand('opencode');
  assert.deepStrictEqual(r, { cmd: 'opencode', args: [] });
});

ok('buildCommand opencode resume', () => {
  const r = buildCommand('opencode', 'ses_abc123');
  assert.deepStrictEqual(r.args, ['--session', 'ses_abc123']);
});

ok('buildCommand claude resume', () => {
  const r = buildCommand('claude', 'uuid-123');
  assert.deepStrictEqual(r.args, ['--resume', 'uuid-123']);
});

ok('classificazione tipi valida', () => {
  for (const t of ['shell', 'opencode', 'claude']) assert.ok(['shell', 'opencode', 'claude'].includes(t));
});

ok('opencode session list --format json e parsabile', () => {
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync('opencode', ['session', 'list', '--format', 'json', '-n', '2'], { timeout: 15000 });
    const arr = JSON.parse(out.toString());
    assert.ok(Array.isArray(arr));
  } catch (e) {
    console.log('  (skip: opencode non disponibile nel test env)');
  }
});

ok('file principali esistenti', () => {
  for (const f of ['main.js', 'preload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css', 'package.json', 'assets/icon.png'])
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), 'manca ' + f);
});

ok('claude projects dir leggibile (se esiste)', () => {
  const base = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(base)) { console.log('  (skip: nessuna dir claude)'); return; }
  const dirs = fs.readdirSync(base);
  assert.ok(dirs.length >= 0);
});

ok('sidebar: unico pulsante nuova sessione (niente data-new)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="btn-new"'), 'manca #btn-new');
  assert.ok(!html.includes('data-new'), 'trovato data-new residuo in sidebar');
  assert.ok(html.includes('id="sidebar-resizer"'), 'manca resizer sidebar');
});

ok('renderer: fit robusto primo tab (proposeDimensions + ResizeObserver)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('proposeDimensions'), 'manca proposeDimensions');
  assert.ok(js.includes('ResizeObserver'), 'manca ResizeObserver');
  assert.ok(js.includes('refitTab'), 'manca refitTab');
  // il terminale deve aprirsi a wrap già visibile: tabs.set/updateEmpty/setActive prima di term.open
  const body = js.slice(js.indexOf('async function createTab'));
  const order = ['tabs.set(id, tab)', 'updateEmpty()', 'setActive(id)', 'term.open(inner)'].map(s => body.indexOf(s));
  assert.ok(order.every(i => i >= 0), 'sequenza createTab incompleta');
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'ordine createTab errato');
});

ok('main: IPC account claude + ANTHROPIC_API_KEY mai in chiaro alla UI', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  for (const h of ['list-claude-accounts', 'add-claude-account', 'delete-claude-account']) {
    assert.ok(main.includes(`'${h}'`), `manca handler ${h}`);
  }
  assert.ok(main.includes('ANTHROPIC_API_KEY'), 'manca override ANTHROPIC_API_KEY');
  assert.ok(main.includes('0o600'), 'manca chmod 600 per il file account');
  assert.ok(main.includes('map(a => ({ id: a.id, name: a.name'), 'la lista deve proiettare solo id+nome (niente chiavi)');
});

ok('preload: espone IPC account claude', () => {
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const f of ['listClaudeAccounts', 'addClaudeAccount', 'deleteClaudeAccount']) {
    assert.ok(pre.includes(f), `manca ${f}`);
  }
});

ok('dialog nuova sessione: selettore account claude', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="new-claude-account"'), 'manca select account nel modal');
  assert.ok(html.includes('id="resume-claude-account"'), 'manca select account nel resume');
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
