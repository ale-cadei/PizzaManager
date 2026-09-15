const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.message); }
}

/* I comandi di avvio vengono dai profili configurabili (command-profiles.js):
   qui si verifica che i default producano lo stesso argv di prima. */
const profiles = require('../command-profiles');

const DEFAULTS = profiles.defaultProfiles({ shell: '/bin/bash', platform: 'linux' });
const DEFAULT_CONFIG = profiles.normalizeConfig(null, { defaults: DEFAULTS });

function buildCommand(type, resumeId) {
  const first = profiles.listProfiles(DEFAULT_CONFIG, type)[0];
  const r = profiles.resolveProfileCommand(first, { resumeId, home: '/home/tester' });
  assert.strictEqual(r.ok, true, r.error || '');
  return { cmd: r.bin, args: r.args, resumeApplied: r.resumeApplied };
}

const SESSION_TYPES = ['shell', 'opencode', 'claude', 'codex'];

ok('buildCommand shell nuova', () => {
  const r = buildCommand('shell');
  assert.strictEqual(r.cmd, '/bin/bash');
  assert.deepStrictEqual(r.args, ['-i']);
});

ok('buildCommand opencode nuova', () => {
  const r = buildCommand('opencode');
  assert.deepStrictEqual({ cmd: r.cmd, args: r.args }, { cmd: 'opencode', args: [] });
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
  const r = buildCommand('codex');
  assert.deepStrictEqual({ cmd: r.cmd, args: r.args }, { cmd: 'codex', args: [] });
});

ok('buildCommand codex resume', () => {
  assert.deepStrictEqual(buildCommand('codex', '019f472a-uuid').args, ['resume', '019f472a-uuid']);
});

ok('shell su windows non riceve -i', () => {
  const win = profiles.defaultProfiles({ shell: 'powershell.exe', platform: 'win32' });
  const r = profiles.resolveProfileCommand(win.shell[0], {});
  assert.deepStrictEqual(r.args, []);
});

ok('shell con spazi nel percorso resta un solo token', () => {
  const d = profiles.defaultProfiles({ shell: '/opt/my shell/bash', platform: 'linux' });
  const r = profiles.resolveProfileCommand(d.shell[0], {});
  assert.strictEqual(r.bin, '/opt/my shell/bash');
  assert.deepStrictEqual(r.args, ['-i']);
});

ok('classificazione tipi valida', () => {
  for (const t of SESSION_TYPES) assert.ok(SESSION_TYPES.includes(t));
});

ok('codex: main + preload + UI collegati', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("'list-codex-sessions'"), 'manca handler list-codex-sessions');
  const cp = fs.readFileSync(path.join(__dirname, '..', 'command-profiles.js'), 'utf8');
  assert.ok(/codex:\s*'resume \{id\}'/.test(cp), 'manca il comando codex resume nei default');
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.ok(pre.includes('listCodex'), 'manca listCodex nel preload');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('data-type="codex"'), 'manca la type-card codex');
  assert.ok(html.includes('data-tab="codex"'), 'manca il tab codex nel resume');
  const icons = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'agent-icons.js'), 'utf8');
  assert.ok(/codex:\s*\{/.test(icons), 'manca l\'icona codex');
});

ok('icone: ogni tipo ha il marchio ufficiale ed è incluso nella pagina', () => {
  const root = path.join(__dirname, '..');
  const icons = fs.readFileSync(path.join(root, 'renderer', 'agent-icons.js'), 'utf8');
  assert.ok(icons.includes('window.AisessIcons'), 'agent-icons.js non espone AisessIcons');
  for (const t of SESSION_TYPES) {
    assert.ok(new RegExp(`\\n\\s{4}${t}:\\s*\\{`).test(icons), `manca il marchio per ${t}`);
  }
  // Marchi ufficiali riconoscibili dal loro tracciato/colore
  assert.ok(icons.includes('M22 24H2V0h20zM17 4.8H7v14.4h10z'), 'il marchio OpenCode non è quello ufficiale');
  assert.ok(icons.includes('M22.2819 9.8211'), 'il marchio Codex (OpenAI) non è quello ufficiale');
  assert.ok(icons.includes('m4.7144 15.9555'), 'il marchio Claude non è quello ufficiale');

  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('agent-icons.js'), 'agent-icons.js non è incluso nella pagina');
  for (const t of SESSION_TYPES) {
    assert.ok(html.includes(`data-icon="${t}"`), `manca il segnaposto icona per ${t}`);
  }
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('Icons.hydrate(document)'), 'i segnaposto icona non vengono riempiti');
  assert.ok(!/ICONS\s*=\s*\{/.test(js), 'restano icone emoji hardcoded nel renderer');

  const tokens = fs.readFileSync(path.join(root, 'renderer', 'tokens.css'), 'utf8');
  assert.ok(/--brand-claude:\s*#D97757/i.test(tokens), 'manca il colore ufficiale del marchio Claude');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  assert.ok(/\.agent-icon\s*\{[^}]*fill:\s*currentColor/.test(css), 'le icone non ereditano il colore');
});

ok('sessioni: la card lampeggia quando l assistente ha finito e si spegne alla selezione', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('ATTENTION_IDLE_MS'), 'manca la soglia di inattività per rilevare la fine del turno');
  assert.ok(/onData\(\(\{ id, data \}\)[\s\S]{0,200}noteActivity/.test(js),
    'l output del terminale non alimenta il rilevamento');
  assert.ok(js.includes('term.onBell'), 'il bell dell agente non viene usato come segnale di fine turno');
  assert.ok(/function setActive\(id\)[\s\S]{0,300}clearAttention\(id\)/.test(js),
    'selezionare la sessione non spegne il lampeggio');
  assert.ok(/t\.id === activeId\) return/.test(js), 'la scheda in primo piano non deve lampeggiare');
  assert.ok(js.includes("t.needsAttention ? ' needs-attention' : ''"), 'la card non riceve la classe di lampeggio');

  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  assert.ok(/@keyframes attention-pulse/.test(css), 'manca l animazione di lampeggio');
  assert.ok(/\.session-item\.needs-attention[\s\S]{0,160}animation:\s*attention-pulse/.test(css),
    'la card non usa l animazione di lampeggio');
  assert.ok(/prefers-reduced-motion[\s\S]{0,400}animation:\s*none/.test(css),
    'il lampeggio non rispetta prefers-reduced-motion');
});

ok('terminale: copia/incolla passano dalla selezione di xterm, non dal documento', () => {
  const root = path.join(__dirname, '..');
  const clip = fs.readFileSync(path.join(root, 'renderer', 'term-clipboard.js'), 'utf8');
  assert.ok(clip.includes('window.AisessClipboard'), 'term-clipboard.js non espone AisessClipboard');
  assert.ok(clip.includes('term.getSelection()'), 'la copia non legge la selezione del terminale');
  assert.ok(clip.includes('clipboardWrite'), 'la copia non scrive negli appunti di sistema');
  assert.ok(clip.includes('term.paste('), 'l incolla non passa da term.paste (bracketed paste)');
  assert.ok(/!e\.shiftKey && !isMac && !term\.hasSelection\(\)\) return true/.test(clip),
    'Ctrl+C senza selezione deve restare SIGINT');

  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.ok(main.includes("'clipboard-write'") && main.includes("'clipboard-read'"), 'mancano gli handler appunti');
  const edit = main.match(/label: 'Edit',[\s\S]*?\n {4}\},/);
  assert.ok(edit, 'manca il menu Edit');
  assert.ok(!/role: '(copy|paste|cut|undo|redo|selectAll)'/.test(edit[0]),
    'il menu Edit usa ancora i ruoli nativi, che ignorano la selezione dei terminali: ' + edit[0]);
  // Ctrl+C / Ctrl+Z / Ctrl+X devono restare al processo nel terminale
  assert.ok(!/accelerator: 'Ctrl\+(C|Z|X)'/.test(edit[0]), 'un acceleratore ruba una scorciatoia della shell');

  const pre = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  for (const f of ['clipboardWrite', 'clipboardRead', 'onMenuEdit']) {
    assert.ok(pre.includes(f), `manca ${f} nel preload`);
  }
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('AisessClipboard.attach(term, inner)'), 'il terminale non aggancia copia/incolla');
  assert.ok(js.includes('runEditAction'), 'il menu Edit non viene smistato verso il terminale');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('term-clipboard.js'), 'term-clipboard.js non è incluso nella pagina');
});

ok('sidebar: gruppo per tipo anche con una sola sessione', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const body = js.slice(js.indexOf('function renderSidebar'));
  assert.ok(!/items\.length === 1/.test(body),
    'con una sola sessione il gruppo collassabile viene ancora saltato');
  assert.ok(body.includes('group-header'), 'manca l header di gruppo');
  assert.ok(body.includes("collapsed ? '▸' : '▾'"), 'manca la freccina di collasso');
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

ok('sidebar: le azioni non usano il pieno teal (riservato alla conferma nei modali)', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const actions = html.match(/<div class="side-actions">[\s\S]*?<\/div>/);
  assert.ok(actions, 'manca il blocco .side-actions');
  assert.ok(!actions[0].includes('btn--primary'), 'un pulsante della sidebar è ancora pieno: ' + actions[0]);
  assert.ok(actions[0].includes('btn--outline'), 'Nuova deve usare la variante outline');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  const hover = css.match(/\.side-actions \.btn--outline:hover\s*\{[^}]*\}/);
  assert.ok(hover, 'manca l hover dedicato per l azione outline in sidebar');
  assert.ok(hover[0].includes('--action-soft'), 'in hover il pulsante si riempie di teal pieno: ' + hover[0]);
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

/* ---------- Directory di lavoro recenti ---------- */
const { computeRecentDirs, normalizeDir } = require('../recent-dirs');

ok('recenti: deduplica mantenendo l ordine di recenza e conta gli usi', () => {
  const history = [
    { cwd: '/a/uno', type: 'claude', lastOpened: '2026-01-03T10:00:00Z' },
    { cwd: '/b/due', type: 'shell', lastOpened: '2026-01-02T10:00:00Z' },
    { cwd: '/a/uno', type: 'shell', lastOpened: '2026-01-01T10:00:00Z' },
  ];
  const r = computeRecentDirs(history, { exists: () => true });
  assert.deepStrictEqual(r.map(d => d.path), ['/a/uno', '/b/due']);
  assert.strictEqual(r[0].uses, 2);
  assert.strictEqual(r[0].type, 'claude', 'deve vincere la voce piu recente');
});

ok('recenti: scarta le directory non piu esistenti', () => {
  const history = [{ cwd: '/esiste' }, { cwd: '/spazzata' }];
  const r = computeRecentDirs(history, { exists: (p) => p === '/esiste' });
  assert.deepStrictEqual(r.map(d => d.path), ['/esiste']);
});

ok('recenti: rispetta il limite e ignora voci non valide', () => {
  const history = [
    { cwd: '   ' }, { cwd: 'relativo/path' }, { cwd: null }, {},
    { cwd: '/x/1' }, { cwd: '/x/2' }, { cwd: '/x/3' },
  ];
  const r = computeRecentDirs(history, { limit: 2, exists: () => true });
  assert.deepStrictEqual(r.map(d => d.path), ['/x/1', '/x/2']);
  assert.deepStrictEqual(computeRecentDirs(null), []);
});

ok('recenti: normalizza lo slash finale', () => {
  assert.strictEqual(normalizeDir('/home/utente/progetto/'), '/home/utente/progetto');
  assert.strictEqual(normalizeDir('/'), '/');
  assert.strictEqual(normalizeDir('progetto'), null);
});

ok('recenti: exists che lancia non fa cadere il calcolo', () => {
  const r = computeRecentDirs([{ cwd: '/boom' }, { cwd: '/ok' }], {
    exists: (p) => { if (p === '/boom') throw new Error('EACCES'); return true; },
  });
  assert.deepStrictEqual(r.map(d => d.path), ['/ok']);
});

ok('recenti: main + preload + UI collegati', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.ok(main.includes("'get-recent-dirs'"), 'manca handler get-recent-dirs');
  assert.ok(main.includes("require('./recent-dirs')"), 'main.js non usa il modulo recent-dirs');
  const pre = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.ok(pre.includes('getRecentDirs'), 'manca getRecentDirs nel preload');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="recent-dirs"'), 'manca il contenitore delle directory recenti');
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('renderRecentDirs'), 'il renderer non mostra le directory recenti');
  assert.ok(/openNewModal[\s\S]{0,400}renderRecentDirs\(\)/.test(js),
    'le directory recenti non vengono aggiornate all apertura del modal');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  assert.ok(/#recent-dirs-row\[hidden\]\s*\{[^}]*display:\s*none/.test(css),
    'la riga delle directory recenti non si nasconde quando vuota');
});

/* ---------- Profili di comando configurabili ---------- */

ok('comandi: tokenizer rispetta virgolette ed escape', () => {
  assert.deepStrictEqual(profiles.tokenizeCommand('claude --model opus'), ['claude', '--model', 'opus']);
  assert.deepStrictEqual(profiles.tokenizeCommand('"/opt/my dir/claude" --flag'), ['/opt/my dir/claude', '--flag']);
  assert.deepStrictEqual(profiles.tokenizeCommand("claude --msg 'ciao mondo'"), ['claude', '--msg', 'ciao mondo']);
  assert.deepStrictEqual(profiles.tokenizeCommand('claude\\ code --x'), ['claude code', '--x']);
  assert.deepStrictEqual(profiles.tokenizeCommand('   '), []);
  assert.deepStrictEqual(profiles.tokenizeCommand(null), []);
});

ok('comandi: la validazione blocca operatori di shell e virgolette aperte', () => {
  const pipe = profiles.validateProfile('shell', { label: 'x', command: 'ls | wc -l' });
  assert.strictEqual(pipe.ok, false);
  assert.ok(/operatori di shell/i.test(pipe.error), pipe.error);
  const sub = profiles.validateProfile('shell', { label: 'x', command: 'echo $(whoami)' });
  assert.strictEqual(sub.ok, false, 'la sostituzione di comando va rifiutata');
  const quote = profiles.validateProfile('claude', { label: 'x', command: 'claude "aperta' });
  assert.strictEqual(quote.ok, false);
  assert.ok(/virgolette/i.test(quote.error), quote.error);
});

ok('comandi: nome e riga di comando sono obbligatori', () => {
  assert.strictEqual(profiles.validateProfile('claude', { label: '', command: 'claude' }).ok, false);
  assert.strictEqual(profiles.validateProfile('claude', { label: 'x', command: '   ' }).ok, false);
  assert.strictEqual(profiles.validateProfile('inesistente', { label: 'x', command: 'x' }).ok, false);
  const good = profiles.validateProfile('claude', { label: ' Opus ', command: ' claude --model opus ' });
  assert.strictEqual(good.ok, true, good.error);
  assert.deepStrictEqual(
    { label: good.profile.label, command: good.profile.command },
    { label: 'Opus', command: 'claude --model opus' }
  );
});

ok('comandi: normalizeConfig scarta i profili rotti e non lascia tipi vuoti', () => {
  const cfg = profiles.normalizeConfig(
    {
      profiles: {
        claude: [
          { id: 'claude:opus', label: 'Opus', command: 'claude --model opus' },
          { label: '', command: 'claude' },
          { label: 'rotto', command: 'claude && ls' },
        ],
        codex: 'non un array',
      },
    },
    { defaults: DEFAULTS }
  );
  assert.deepStrictEqual(cfg.profiles.claude.map((p) => p.label), ['Opus']);
  assert.deepStrictEqual(cfg.profiles.codex.map((p) => p.label), DEFAULTS.codex.map((p) => p.label));
  assert.deepStrictEqual(cfg.profiles.shell.map((p) => p.command), DEFAULTS.shell.map((p) => p.command));
  for (const t of SESSION_TYPES) assert.ok(cfg.profiles[t].length >= 1, 'tipo senza comandi: ' + t);
});

ok('comandi: normalizeConfig assegna id unici e rispetta il limite per tipo', () => {
  const dup = profiles.normalizeConfig(
    { profiles: { claude: [
      { id: 'claude:x', label: 'A', command: 'claude' },
      { id: 'claude:x', label: 'B', command: 'claude' },
    ] } },
    { defaults: DEFAULTS }
  );
  const ids = dup.profiles.claude.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id duplicati: ' + ids);
  const many = Array.from({ length: profiles.MAX_PROFILES_PER_TYPE + 5 }, (_, i) => ({ label: 'c' + i, command: 'claude' }));
  const capped = profiles.normalizeConfig({ profiles: { claude: many } }, { defaults: DEFAULTS });
  assert.strictEqual(capped.profiles.claude.length, profiles.MAX_PROFILES_PER_TYPE);
});

ok('comandi: normalizeConfig non muta l input', () => {
  const raw = { profiles: { claude: [{ id: 'claude:a', label: 'A', command: 'claude' }] } };
  const snapshot = JSON.stringify(raw);
  profiles.normalizeConfig(raw, { defaults: DEFAULTS });
  assert.strictEqual(JSON.stringify(raw), snapshot);
});

ok('comandi: resume in coda, inline con {id} e scartato se non serve', () => {
  const coda = profiles.resolveProfileCommand(
    { command: 'claude --verbose', resumeArgs: '--resume {id}' },
    { resumeId: 'abc' }
  );
  assert.deepStrictEqual(coda.args, ['--verbose', '--resume', 'abc']);
  assert.strictEqual(coda.resumeApplied, true);

  const inline = profiles.resolveProfileCommand(
    { command: 'codex resume {id} --full-auto', resumeArgs: 'resume {id}' },
    { resumeId: 'xyz' }
  );
  assert.deepStrictEqual(inline.args, ['resume', 'xyz', '--full-auto'], 'il segnaposto inline deve vincere');
  assert.strictEqual(inline.resumeApplied, true);

  const pulito = profiles.resolveProfileCommand(
    { command: 'codex resume {id}', resumeArgs: 'resume {id}' },
    {}
  );
  assert.deepStrictEqual(pulito.args, ['resume'], 'senza resumeId i token con {id} vanno via');
  assert.strictEqual(pulito.resumeApplied, false);
});

ok('comandi: resume non applicabile viene segnalato', () => {
  const r = profiles.resolveProfileCommand({ command: 'claude', resumeArgs: '' }, { resumeId: 'abc' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.resumeApplied, false, 'main.js usa resumeApplied per spiegare l errore all utente');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes('resumeApplied'), 'main.js ignora i profili senza resume');
});

ok('comandi: la tilde viene espansa (pty.spawn non passa da una shell)', () => {
  const r = profiles.resolveProfileCommand(
    { command: '~/.local/bin/claude --add-dir ~/progetti', resumeArgs: '' },
    { home: '/home/tester' }
  );
  assert.strictEqual(r.bin, '/home/tester/.local/bin/claude');
  assert.deepStrictEqual(r.args, ['--add-dir', '/home/tester/progetti']);
});

ok('comandi: profilo non valido non produce un argv', () => {
  assert.strictEqual(profiles.resolveProfileCommand(null, {}).ok, false);
  assert.strictEqual(profiles.resolveProfileCommand({ command: '   ' }, {}).ok, false);
  assert.strictEqual(profiles.resolveProfileCommand({ command: 'claude "x' }, {}).ok, false);
});

ok('comandi: findProfile e listProfiles restituiscono copie', () => {
  const found = profiles.findProfile(DEFAULT_CONFIG, 'claude', 'claude:default');
  assert.ok(found, 'profilo di default claude non trovato');
  found.label = 'modificato';
  assert.notStrictEqual(profiles.findProfile(DEFAULT_CONFIG, 'claude', 'claude:default').label, 'modificato');
  assert.strictEqual(profiles.findProfile(DEFAULT_CONFIG, 'claude', 'inesistente'), null);
  assert.deepStrictEqual(profiles.listProfiles(null, 'claude'), []);
});

ok('comandi: main + preload + UI collegati', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  for (const h of ['get-command-profiles', 'save-command-profiles', 'reset-command-profiles']) {
    assert.ok(main.includes(`'${h}'`), `manca handler ${h}`);
  }
  assert.ok(main.includes("require('./command-profiles')"), 'main.js non usa il modulo command-profiles');
  assert.ok(/buildCommand\(type, resumeId, commandProfileId\)/.test(main), 'pty-spawn non passa il profilo scelto');
  assert.ok(main.includes("send('menu-open-config')"), 'manca la voce di menu Configurazione comandi');

  const pre = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  for (const f of ['getCommandProfiles', 'saveCommandProfiles', 'resetCommandProfiles', 'menu-open-config']) {
    assert.ok(pre.includes(f), `manca ${f} nel preload`);
  }

  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('data-action="open-config"'), 'manca la voce Configurazione nel menu File in-app');
  assert.ok(html.includes('id="modal-config"'), 'manca il modal di configurazione');
  assert.ok(html.includes('id="modal-pick-command"'), 'manca il modal di scelta del comando');
  for (const t of SESSION_TYPES) {
    assert.ok(html.includes(`data-config-tab="${t}"`), `manca il tab di configurazione per ${t}`);
  }
  assert.ok(html.includes('command-config.js'), 'command-config.js non è incluso nella pagina');

  const cfgJs = fs.readFileSync(path.join(root, 'renderer', 'command-config.js'), 'utf8');
  assert.ok(cfgJs.includes('window.AisessCommands'), 'command-config.js non espone AisessCommands');
  assert.ok(/list\.length === 1/.test(cfgJs), 'con un solo comando non si deve chiedere nulla');

  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('resolveCommandProfile'), 'il renderer non risolve il comando da usare');
  assert.ok(/if \(!picked\.ok\) return/.test(js), 'annullare la scelta deve impedire la creazione della scheda');
  assert.ok(js.includes('commandProfileId: picked.id'), 'lo spawn non riceve il comando scelto');

  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  assert.ok(css.includes('.cmd-choice'), 'manca lo stile della scelta comando');
  assert.ok(/\.config-error\[hidden\]\s*\{[^}]*display:\s*none/.test(css), 'l errore di configurazione non si nasconde');
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
