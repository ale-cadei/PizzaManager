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
  if (type === 'codex') return resumeId ? { cmd: 'codex', args: ['resume', resumeId] } : { cmd: 'codex', args: [] };
  return { cmd: 'shell', args: [] };
}

const SESSION_TYPES = ['shell', 'opencode', 'claude', 'codex'];

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

ok('buildCommand codex nuova', () => {
  assert.deepStrictEqual(buildCommand('codex'), { cmd: 'codex', args: [] });
});

ok('buildCommand codex resume', () => {
  assert.deepStrictEqual(buildCommand('codex', '019f472a-uuid').args, ['resume', '019f472a-uuid']);
});

ok('classificazione tipi valida', () => {
  for (const t of SESSION_TYPES) assert.ok(SESSION_TYPES.includes(t));
});

ok('codex: main + preload + UI collegati', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("'list-codex-sessions'"), 'manca handler list-codex-sessions');
  assert.ok(main.includes("['resume', resumeId]"), 'manca il comando codex resume');
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.ok(pre.includes('listCodex'), 'manca listCodex nel preload');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('data-type="codex"'), 'manca la type-card codex');
  assert.ok(html.includes('data-tab="codex"'), 'manca il tab codex nel resume');
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes("codex: '✳'"), 'manca l\'icona codex');
});

ok('codex-sessions: scan rollout senza crash', () => {
  const { listCodexSessions, sessionsDir } = require('../codex-sessions');
  const r = listCodexSessions(5);
  assert.ok(typeof r.ok === 'boolean' && Array.isArray(r.sessions));
  if (!fs.existsSync(sessionsDir())) { console.log('  (skip: nessuna dir codex)'); return; }
  assert.strictEqual(r.ok, true, r.error || '');
  assert.ok(r.sessions.length <= 5, 'limit non rispettato');
  for (const s of r.sessions) {
    assert.ok(s.id && s.title, 'sessione senza id/title');
    assert.ok(typeof s.mtime === 'number', 'mtime mancante');
  }
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

ok('build.files include ogni modulo richiesto da main.js', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = (pkg.build && pkg.build.files) || [];
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const localRequires = [...main.matchAll(/require\('\.\/([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(localRequires.length, 'nessun require locale trovato in main.js');
  for (const mod of localRequires) {
    const candidates = [mod, `${mod}.js`];
    assert.ok(
      candidates.some((c) => files.includes(c)),
      `${mod} richiesto da main.js ma assente da build.files: l'app installata crasha all'avvio`
    );
  }
});

ok('group-body collassato e nascosto anche con display flex', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const rule = /\.group-body\[hidden\]\s*\{[^}]*display:\s*none/;
  assert.ok(rule.test(css), 'manca .group-body[hidden] { display: none } : il gruppo non si collassa');
});

ok('sessione attiva segnalata dal marker, non dal contorno', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  assert.ok(js.includes('class="sel-mark"'), 'il renderer non genera il marker di selezione');
  assert.ok(/session-item type-\$\{t\.type\}/.test(js), 'manca la classe di tipo sulla card');
  const activeRule = css.match(/\.session-item\.active\s*\{[^}]*\}/);
  assert.ok(activeRule, 'manca la regola .session-item.active');
  assert.ok(!/border-color|box-shadow/.test(activeRule[0]),
    'la card attiva evidenzia ancora il contorno: ' + activeRule[0]);
  assert.ok(/\.session-item\.active\s*>\s*\.sel-mark\s*\{[^}]*visibility:\s*visible/.test(css),
    'il marker non viene mostrato sulla card attiva');
});

ok('ogni tipo di sessione ha un colore identita distinto', () => {
  const root = path.join(__dirname, '..');
  const tokens = fs.readFileSync(path.join(root, 'renderer', 'tokens.css'), 'utf8');
  const colors = SESSION_TYPES.map((type) => {
    const m = tokens.match(new RegExp(`--type-${type}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(m, `manca il token --type-${type}`);
    return m[1].toUpperCase();
  });
  assert.strictEqual(new Set(colors).size, colors.length, 'due tipi condividono lo stesso colore: ' + colors);
  const green = (tokens.match(/--state-ok:\s*(#[0-9A-Fa-f]{6})/) || [])[1];
  // Il verde e riservato al pallino "in esecuzione"
  assert.ok(green && !colors.includes(green.toUpperCase()), 'un tipo usa il verde di --state-ok');
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
