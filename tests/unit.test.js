const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');

const { buildCommand, installHint, AI_COMMANDS } = require('../lib/commands');

const SESSION_TYPES = ['shell', 'opencode', 'claude', 'codex'];
const FIXTURES = path.join(__dirname, 'fixtures', 'claude-sessions');

// I test invocano la buildCommand vera. Il binario risolto e' un percorso
// assoluto e dipende dalla macchina, quindi si verifica cio' che e'
// deterministico: gli argomenti, e che il comando punti al tool giusto.
function expectResolvedTo(result, tool) {
  if (result.cmd === null) {
    assert.strictEqual(result.missing, tool, `${tool} non installato: deve dirlo`);
    return;
  }
  assert.ok(path.basename(result.cmd) === tool, `atteso un percorso a ${tool}, ricevuto ${result.cmd}`);
}

ok('opencode: sessione nuova senza argomenti', () => {
  const r = buildCommand('opencode');
  expectResolvedTo(r, 'opencode');
  assert.deepStrictEqual(r.args, []);
});

ok('opencode: il resume passa --session <id>', () => {
  assert.deepStrictEqual(buildCommand('opencode', 'ses_abc123').args, ['--session', 'ses_abc123']);
});

ok('claude: il resume passa --resume <id>', () => {
  assert.deepStrictEqual(buildCommand('claude', 'uuid-123').args, ['--resume', 'uuid-123']);
});

ok('codex: il resume passa il sottocomando resume <id>', () => {
  assert.deepStrictEqual(buildCommand('codex', '019f472a').args, ['resume', '019f472a']);
});

ok('shell: sessione interattiva, mai un resume', () => {
  const r = buildCommand('shell', 'un-id-ignorato');
  assert.deepStrictEqual(r.args, ['-i'], 'la shell non ha resume: -i e basta');
  assert.ok(r.cmd, 'la shell deve sempre risolversi');
});

ok('un tipo sconosciuto ricade sulla shell invece di fallire', () => {
  assert.deepStrictEqual(buildCommand('tipo-inventato').args, ['-i']);
});

ok('su Windows la shell non riceve -i', () => {
  assert.deepStrictEqual(buildCommand('shell', null, { platform: 'win32' }).args, []);
});

ok('ogni tipo AI ha un suggerimento di installazione dedicato', () => {
  for (const tool of Object.keys(AI_COMMANDS)) {
    const hint = installHint(tool);
    assert.ok(hint && hint.length > 20, `suggerimento assente o generico per ${tool}`);
    assert.notStrictEqual(hint, installHint('tool-inesistente'), `${tool} usa il messaggio generico`);
  }
});

ok('i tipi di sessione supportati sono shell piu i tre tool AI', () => {
  assert.deepStrictEqual(['shell', ...Object.keys(AI_COMMANDS)].sort(), [...SESSION_TYPES].sort());
});

ok('i file e i moduli caricati dall app esistono tutti', () => {
  const attesi = [
    'main.js', 'preload.js', 'package.json',
    'app/menu.js', 'app/window.js',
    'lib/accounts.js', 'lib/binaries.js', 'lib/claude-sessions.js', 'lib/codex-sessions.js',
    'lib/commands.js', 'lib/history.js', 'lib/login-path.js', 'lib/opencode-sessions.js', 'lib/shell.js',
    'renderer/index.html', 'renderer/renderer.js', 'renderer/styles.css', 'renderer/tokens.css',
    'assets/icon.png',
  ];
  for (const f of attesi) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), 'manca ' + f);
  }
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

ok('account claude: la lista non espone mai le API key', () => {
  // Arrange: uno store su directory temporanea, con dentro una chiave
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-acc-'));
  const { createAccountStore } = require('../lib/accounts');
  const store = createAccountStore({ dir });
  assert.deepStrictEqual(store.add({ name: 'lavoro', apiKey: 'sk-ant-segreto' }), { ok: true });

  // Act
  const exposed = store.list();

  // Assert: ne' la chiave ne' il campo che la contiene devono uscire
  assert.strictEqual(exposed.length, 1);
  assert.deepStrictEqual(Object.keys(exposed[0]).sort(), ['createdAt', 'id', 'name']);
  assert.ok(!JSON.stringify(exposed).includes('sk-ant-segreto'), 'la API key e finita nella proiezione per la UI');

  fs.rmSync(dir, { recursive: true, force: true });
});

ok('account claude: il file delle chiavi non e leggibile da altri utenti', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-acc-'));
  const { createAccountStore } = require('../lib/accounts');
  const store = createAccountStore({ dir });
  store.add({ name: 'a', apiKey: 'sk-ant-x' });
  const mode = fs.statSync(store.file).mode & 0o777;
  assert.strictEqual(mode, 0o600, `permessi ${mode.toString(8)} invece di 600`);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('account claude: la chiave arriva al pty solo via ANTHROPIC_API_KEY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-acc-'));
  const { createAccountStore } = require('../lib/accounts');
  const store = createAccountStore({ dir });
  store.add({ name: 'lavoro', apiKey: 'sk-ant-segreto' });
  const id = store.list()[0].id;

  assert.deepStrictEqual(store.envFor(id).vars, { ANTHROPIC_API_KEY: 'sk-ant-segreto' });
  assert.deepStrictEqual(store.envFor('oauth').vars, {}, 'con OAuth non si deve iniettare nessuna chiave');
  assert.ok(store.envFor('acc_inesistente').error, 'un account eliminato deve dare errore, non env vuoto');

  fs.rmSync(dir, { recursive: true, force: true });
});

ok('account claude: nomi duplicati rifiutati senza distinzione di maiuscole', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-acc-'));
  const { createAccountStore } = require('../lib/accounts');
  const store = createAccountStore({ dir });
  store.add({ name: 'Lavoro', apiKey: 'sk-1' });
  const dup = store.add({ name: 'lavoro', apiKey: 'sk-2' });
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(store.list().length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('account claude: rimozione', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-acc-'));
  const { createAccountStore } = require('../lib/accounts');
  const store = createAccountStore({ dir });
  store.add({ name: 'a', apiKey: 'sk-1' });
  store.add({ name: 'b', apiKey: 'sk-2' });
  store.remove(store.list().find((a) => a.name === 'a').id);
  assert.deepStrictEqual(store.list().map((a) => a.name), ['b']);
  fs.rmSync(dir, { recursive: true, force: true });
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
  // build.files ammette i glob di electron-builder: un'uguaglianza fra stringhe
  // segnalerebbe come mancante un modulo coperto da "lib/**/*".
  const globToRegExp = (g) => new RegExp('^' + g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?') + '$');
  const patterns = files.filter((f) => !f.startsWith('!')).map(globToRegExp);
  for (const mod of localRequires) {
    const candidates = [mod, `${mod}.js`];
    assert.ok(
      candidates.some((c) => patterns.some((re) => re.test(c))),
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

// ---------- Parser delle sessioni Claude, su fixture ----------
const { parseSessionHead } = require('../lib/claude-sessions');

function parseFixture(name, projectDirName = '-Users-tizio-fallback') {
  return parseSessionHead(fs.readFileSync(path.join(FIXTURES, name), 'utf8'), {
    sessionId: 'abcdef1234-0000',
    projectDirName,
  });
}

ok('sessione valida: titolo dal primo messaggio utente, cwd dal file', () => {
  assert.deepStrictEqual(parseFixture('valida.jsonl'), {
    title: 'Sistema il login che va in timeout',
    cwd: '/Users/tizio/progetti/backend',
  });
});

ok('file troncato a meta riga: ripiega senza sollevare eccezioni', () => {
  assert.deepStrictEqual(parseFixture('troncata.jsonl'), {
    title: 'abcdef12',
    cwd: '/Users/tizio/fallback',
  });
});

ok('nessun messaggio utente: titolo dall id, cwd dal nome della cartella', () => {
  assert.deepStrictEqual(parseFixture('senza-messaggi.jsonl'), {
    title: 'abcdef12',
    cwd: '/Users/tizio/fallback',
  });
});

ok('un summary fa da titolo quando manca il messaggio utente', () => {
  assert.deepStrictEqual(parseFixture('con-summary.jsonl'), {
    title: 'Rifattorizzazione del modulo di autenticazione',
    cwd: '/srv/app',
  });
});

ok('righe non-JSON vengono saltate senza fermare la lettura', () => {
  assert.deepStrictEqual(parseFixture('sporca.jsonl'), {
    title: 'prima riga valida',
    cwd: '/tmp/z',
  });
});

ok('il titolo viene troncato invece di riempire la sidebar', () => {
  const { TITLE_MAX } = require('../lib/claude-sessions');
  const lungo = JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(500) }] } });
  assert.strictEqual(parseSessionHead(lungo, { sessionId: 'z', projectDirName: 'p' }).title.length, TITLE_MAX);
});
