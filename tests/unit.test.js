const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { readRendererApp } = require('./renderer-source');

const { buildCommand, installHint, aliasHint, INSTALL_HINTS } = require('../lib/commands');
const { createProfileStore } = require('../lib/profiles');
const { SESSION_TYPES, defaultProfiles, resolveProfileCommand } = require('../lib/command-profiles');
const { AI_BINARIES } = require('../lib/binaries');

const FIXTURES = path.join(__dirname, 'fixtures', 'claude-sessions');

/** Store dei profili su tmpdir con i soli default: e' la configurazione del primo avvio. */
function freshProfiles(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-prof-'));
  return createProfileStore({ dir, ...opts });
}

// I test invocano la buildCommand vera. Il binario risolto e' un percorso
// assoluto e dipende dalla macchina, quindi si verifica cio' che e'
// deterministico: gli argomenti, e che il comando punti al tool giusto.
function expectResolvedTo(result, tool) {
  if (result.cmd === null) {
    assert.strictEqual(result.missing, tool, `${tool} non installato: deve dirlo (${result.error || ''})`);
    return;
  }
  assert.ok(path.basename(result.cmd) === tool, `atteso un percorso a ${tool}, ricevuto ${result.cmd}`);
}

ok('opencode: sessione nuova senza argomenti', () => {
  const r = buildCommand('opencode', null, null, { profiles: freshProfiles() });
  expectResolvedTo(r, 'opencode');
  if (r.cmd) assert.deepStrictEqual(r.args, []);
});

ok('opencode: il resume passa --session <id>', () => {
  const r = buildCommand('opencode', 'ses_abc123', null, { profiles: freshProfiles() });
  if (r.cmd) assert.deepStrictEqual(r.args, ['--session', 'ses_abc123']);
  else assert.strictEqual(r.missing, 'opencode');
});

ok('claude: il resume passa --resume <id>', () => {
  const r = buildCommand('claude', 'uuid-123', null, { profiles: freshProfiles() });
  if (r.cmd) assert.deepStrictEqual(r.args, ['--resume', 'uuid-123']);
  else assert.strictEqual(r.missing, 'claude');
});

ok('codex: il resume passa il sottocomando resume <id>', () => {
  const r = buildCommand('codex', '019f472a', null, { profiles: freshProfiles() });
  if (r.cmd) assert.deepStrictEqual(r.args, ['resume', '019f472a', '--no-alt-screen']);
  else assert.strictEqual(r.missing, 'codex');
});

// Nell'alternate screen la rotella diventa freccia su/giù e codex sfoglia i
// prompt inviati invece della chat (docs/plans/28-rotella-codex.md).
const fakeCodex = () => ({ path: '/opt/bin/codex', via: 'test' });

ok('codex: parte inline, senza alternate screen, anche col profilo salvato prima', () => {
  const r = buildCommand('codex', null, null, { profiles: freshProfiles(), resolve: fakeCodex });
  assert.deepStrictEqual(r.args, ['--no-alt-screen']);
});

ok('codex: un profilo che chiede già --no-alt-screen non lo riceve due volte', () => {
  const profiles = freshProfiles();
  const cfg = profiles.load();
  profiles.save({ ...cfg, profiles: { ...cfg.profiles, codex: [{ id: 'codex:x', label: 'X', command: 'codex --no-alt-screen -m o3', resumeArgs: 'resume {id}' }] } });
  const r = buildCommand('codex', 'abc', 'codex:x', { profiles, resolve: fakeCodex });
  assert.deepStrictEqual(r.args, ['--no-alt-screen', '-m', 'o3', 'resume', 'abc']);
});

ok('il flag inline è solo di codex: claude e opencode restano come sono', () => {
  const resolve = (bin) => ({ path: '/opt/bin/' + bin, via: 'test' });
  assert.deepStrictEqual(buildCommand('claude', null, null, { profiles: freshProfiles(), resolve }).args, []);
  assert.deepStrictEqual(buildCommand('opencode', null, null, { profiles: freshProfiles(), resolve }).args, []);
});

// /bin/sh e' un percorso esplicito e deve esistere: il caso Windows e' il test «su Windows la shell…»
ok('shell: sessione interattiva; il resume non e supportato e viene rifiutato', { skip: process.platform === 'win32' && 'niente /bin/sh su Windows' }, () => {
  const profiles = freshProfiles({ shell: '/bin/sh', platform: 'linux' });
  const nuova = buildCommand('shell', null, null, { profiles, platform: 'linux' });
  assert.deepStrictEqual(nuova.args, ['-i']);
  assert.ok(nuova.cmd, 'la shell deve sempre risolversi');
  const resume = buildCommand('shell', 'un-id', null, { profiles, platform: 'linux' });
  assert.strictEqual(resume.cmd, null);
  assert.ok(/non supporta il resume/.test(resume.error), resume.error);
});

ok('un tipo sconosciuto da un errore leggibile, non un crash', () => {
  const r = buildCommand('tipo-inventato', null, null, { profiles: freshProfiles() });
  assert.strictEqual(r.cmd, null);
  assert.ok(/Nessun comando configurato/.test(r.error), r.error);
});

ok('su Windows la shell di default non riceve -i', () => {
  const profiles = freshProfiles({ shell: 'powershell.exe', platform: 'win32' });
  assert.deepStrictEqual(profiles.defaults().shell[0].command, 'powershell.exe');
});

ok('un profilo scelto per id che non esiste piu viene segnalato', () => {
  const r = buildCommand('claude', null, 'claude:sparito', { profiles: freshProfiles() });
  assert.strictEqual(r.cmd, null);
  assert.ok(/non esiste più/.test(r.error), r.error);
});

ok('le variabili in testa al profilo tornano come env, non come argomenti', () => {
  const profiles = freshProfiles();
  const cfg = profiles.load();
  cfg.profiles.claude = [{ id: 'claude:x', label: 'X', command: 'CLAUDE_CONFIG_DIR=~/.claude-x claude', resumeArgs: '--resume {id}' }];
  profiles.save(cfg);
  const r = buildCommand('claude', null, 'claude:x', { profiles, home: '/home/tizio' });
  if (r.cmd) {
    assert.deepStrictEqual(r.args, []);
    assert.deepStrictEqual(r.profileEnv, { CLAUDE_CONFIG_DIR: '/home/tizio/.claude-x' });
  } else assert.strictEqual(r.missing, 'claude');
});

ok('ogni tipo AI ha un suggerimento di installazione dedicato, piu la nota sugli alias', () => {
  for (const tool of Object.keys(INSTALL_HINTS)) {
    const hint = installHint(tool);
    assert.ok(hint.startsWith(INSTALL_HINTS[tool]), `suggerimento generico per ${tool}`);
    assert.ok(hint.endsWith(aliasHint(tool)), `manca la nota sugli alias per ${tool}`);
  }
  assert.ok(installHint('tool-inesistente').includes('sia installato e nel PATH'));
});

ok('i tipi di sessione supportati sono shell piu i quattro tool AI', () => {
  assert.deepStrictEqual([...SESSION_TYPES].sort(), ['antigravity', 'claude', 'codex', 'opencode', 'shell']);
  // I suggerimenti sono per binario, non per tipo: la CLI di Antigravity e' `agy`
  assert.deepStrictEqual(Object.keys(INSTALL_HINTS).sort(), ['agy', 'claude', 'codex', 'opencode']);
});

/* `antigravity` e' l'IDE (fork di VS Code, apre una finestra grafica): nel pty
 * serve `agy`, la CLI vera. Tipo di sessione e nome del binario quindi non
 * coincidono, ed e' un errore facile da reintrodurre. */
ok('il tipo antigravity usa il binario agy, non l eseguibile dell IDE', () => {
  assert.strictEqual(AI_BINARIES.antigravity, 'agy');
  const prof = defaultProfiles({ shell: '/bin/bash', platform: 'linux' }).antigravity[0];
  const r = resolveProfileCommand(prof, { resumeId: 'abc123', home: '/home/tizio' });
  assert.ok(r.ok, r.error || '');
  assert.strictEqual(r.bin, 'agy');
  assert.deepStrictEqual(r.args, ['--conversation', 'abc123']);
});

ok('i file e i moduli caricati dall app esistono tutti', () => {
  const attesi = [
    'main.js', 'preload.js', 'package.json',
    'app/menu.js', 'app/window.js',
    'app/pty.js',
    'lib/accounts.js', 'lib/antigravity-sessions.js', 'lib/binaries.js', 'lib/claude-sessions.js',
    'lib/codex-sessions.js', 'lib/commands.js', 'lib/history.js', 'lib/login-path.js',
    'lib/opencode-sessions.js', 'lib/shell.js', 'lib/workdir.js',
    'renderer/index.html', 'renderer/renderer.js', 'renderer/app-state.js', 'renderer/pizza-logo.js', 'renderer/pizza-slice.js',
    'renderer/prompt-capture.js',
    'renderer/session-titles.js', 'renderer/styles.css', 'renderer/tokens.css',
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
  const js = readRendererApp();
  assert.ok(js.includes('proposeDimensions'), 'manca proposeDimensions');
  assert.ok(js.includes('ResizeObserver'), 'manca ResizeObserver');
  assert.ok(js.includes('refitTab'), 'manca refitTab');
  // il terminale deve aprirsi a wrap già visibile: tabs.set/updateEmpty/setActive prima di term.open
  const body = js.slice(js.indexOf('async function createTab'));
  const order = ['tabs.set(id, tab)', 'updateEmpty()', 'setActive(id, { reveal })', 'term.open(inner)'].map(s => body.indexOf(s));
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

ok('account claude: il file delle chiavi non e leggibile da altri utenti', { skip: process.platform === 'win32' && 'Windows non ha i permessi POSIX: li proteggono le ACL di %APPDATA%' }, () => {
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

ok('la card porta la classe del suo tipo', () => {
  const root = path.join(__dirname, '..');
  // Le card le disegna la sidebar, non renderer.js (branch raggruppamento).
  // Lo stile della card attiva lo verifica tests/sidebar-selezione.test.js.
  const js = fs.readFileSync(path.join(root, 'renderer', 'sidebar.js'), 'utf8');
  assert.ok(/session-item type-\$\{t\.type\}/.test(js), 'manca la classe di tipo sulla card');
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
const { sessionFromLines, cwdFromProjectDir, TITLE_MAX } = require('../lib/claude-sessions');

function parseFixture(name, projectDirName = '-Users-tizio-fallback') {
  return sessionFromLines(fs.readFileSync(path.join(FIXTURES, name), 'utf8').split('\n'), {
    id: 'abcdef1234-0000',
    fallbackCwd: cwdFromProjectDir(projectDirName, { platform: 'linux' }),
  });
}

ok('sessione valida: titolo dal primo messaggio utente, cwd dal file', () => {
  assert.deepStrictEqual(parseFixture('valida.jsonl'), {
    title: 'Sistema il login che va in timeout',
    titled: true,
    cwd: '/Users/tizio/progetti/backend',
  });
});

ok('file troncato a meta riga: ripiega senza sollevare eccezioni', () => {
  assert.deepStrictEqual(parseFixture('troncata.jsonl'), {
    title: 'abcdef12',
    titled: false,
    cwd: '/Users/tizio/fallback',
  });
});

ok('nessun messaggio utente: titolo dall id, cwd dal nome della cartella', () => {
  assert.deepStrictEqual(parseFixture('senza-messaggi.jsonl'), {
    title: 'abcdef12',
    titled: false,
    cwd: '/Users/tizio/fallback',
  });
});

ok('un summary fa da titolo quando manca il messaggio utente', () => {
  assert.deepStrictEqual(parseFixture('con-summary.jsonl'), {
    title: 'Rifattorizzazione del modulo di autenticazione',
    titled: true,
    cwd: '/srv/app',
  });
});

ok('righe non-JSON vengono saltate senza fermare la lettura', () => {
  assert.deepStrictEqual(parseFixture('sporca.jsonl'), {
    title: 'prima riga valida',
    titled: true,
    cwd: '/tmp/z',
  });
});

ok('il titolo viene troncato invece di riempire la sidebar', () => {
  const lungo = JSON.stringify({ message: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(500) }] } });
  assert.strictEqual(sessionFromLines([lungo], { id: 'z' }).title.length, TITLE_MAX);
});

// ---------- Invarianti della struttura ----------
ok('lib/ non dipende da Electron: e la ragione per cui questi test possono girare', () => {
  // Ricorsivo: la regola vale anche per le sottocartelle (lib/usage/…),
  // altrimenti bastava un livello in piu' per aggirarla senza accorgersene.
  const libDir = path.join(__dirname, '..', 'lib');
  const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.isFile() && e.name.endsWith('.js') ? [full] : [];
  });
  for (const file of sources(libDir)) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!/require\(['"]electron['"]\)/.test(src), `${path.relative(libDir, file)} importa electron: va in app/`);
  }
});

ok('main.js e solo cablaggio: nessuna funzione di logica definita al suo interno', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const fns = [...main.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  assert.deepStrictEqual(fns, ['sendToRenderer', 'fail'], 'main.js definisce logica che dovrebbe stare in lib/ o app/: ' + fns.join(', '));
  // 215: soglia alzata di 5 per lo scrollback delle shell (piano 26) — store,
  // avvio del salvataggio e aggancio alla chiusura. La logica sta in
  // lib/scrollback.js e app/quit-capture.js: qui restano solo le chiamate.
  // 220: altre 5 per l'handler della sessione git (lib/git-graph.js), arrivato
  // su main in parallelo — anche quello solo cablaggio.
  // 225: altre 5 per le notifiche di sistema (piano 38): un require e la
  // registrazione; la logica sta in lib/notifications.js e app/notify.js.
  // 227: altre 2 per l'aggiornamento automatico (piano 18), stesso schema —
  // le regole stanno in lib/update-policy.js, i fatti in app/updater.js.
  // 230: altre 3 per il segnale esatto degli agenti (piano 46): require, store
  // e avvio; la logica sta in lib/agent-signals.js e app/pty.js.
  // 232: altre 2 per la bacheca delle segnalazioni (piano 48): un require e la
  // registrazione; rete, cache e contesto stanno in app/feedback.js.
  // 234: altre 2 per la sessione editor (piano 60): un require e la
  // registrazione; file, watch e conferma d'uscita stanno in app/editor*.js.
  assert.ok(main.split('\n').length < 234, `main.js e a ${main.split('\n').length} righe: sta ricrescendo`);
});

/* I file che un PROGRAMMA ESTERNO deve aprire non bastano dentro app.asar:
   solo Electron sa leggere quell'archivio. Vanno sia in `files` (o finiscono
   fuori dal pacchetto) sia in `asarUnpack` (o restano dentro l'archivio, e
   `Help → Licenza` aprirebbe il vuoto). È già successo con app/tmux.conf:
   barra verde e Ctrl+B attivi nel .deb perché tmux non leggeva la config. */
ok('i file legali viaggiano nel pacchetto e fuori dall archivio', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const f of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `${f} non esiste nel repo`);
    assert.ok(pkg.build.files.includes(f), `${f} non e in build.files: resterebbe fuori dal pacchetto`);
    assert.ok(pkg.build.asarUnpack.includes(f), `${f} non e in build.asarUnpack: Help → Licenza aprirebbe il vuoto`);
  }
  // Lo stesso vale per la config di tmux, che la legge tmux e non Electron.
  assert.ok(pkg.build.asarUnpack.includes('app/tmux.conf'));
});

ok('la licenza dichiarata e quella dei termini scritti, non una standard', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  // MIT concederebbe a chiunque riceva il software di rivenderlo: con il
  // codice privato era una contraddizione nelle intenzioni.
  assert.strictEqual(pkg.license, 'UNLICENSED', 'npm usa UNLICENSED per «proprietario»');
  const testo = fs.readFileSync(path.join(__dirname, '..', 'LICENSE'), 'utf8');
  assert.match(testo, /Giacomo Grieco and Alessandro Cadei/, 'manca la nota di copyright');
  assert.match(testo, /NO WARRANTY/, 'la clausola che protegge gli autori non c e');
  assert.match(testo, /THIRD-PARTY-NOTICES\.md/, 'il rimando alle note di terze parti non c e');
});
