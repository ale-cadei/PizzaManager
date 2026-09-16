// Cablaggio da capo a fondo delle funzionalita': che handler, preload, markup
// e renderer siano collegati fra loro. Dove la logica e' in un modulo puro, la
// verifica e' comportamentale; dove e' markup o codice del renderer, si legge
// il sorgente perche' non ha una controparte eseguibile fuori da Electron.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// ---------- Appunti e menu Edit ----------
ok('terminale: copia/incolla passano dalla selezione di xterm, non dal documento', () => {
  const clip = read('renderer', 'term-clipboard.js');
  assert.ok(clip.includes('window.AisessClipboard'), 'term-clipboard.js non espone AisessClipboard');
  assert.ok(clip.includes('term.getSelection()'), 'la copia non legge la selezione del terminale');
  assert.ok(clip.includes('clipboardWrite'), 'la copia non scrive negli appunti di sistema');
  assert.ok(clip.includes('term.paste('), "l'incolla non passa da term.paste (bracketed paste)");
  assert.ok(/!e\.shiftKey && !isMac && !term\.hasSelection\(\)\) return true/.test(clip), 'Ctrl+C senza selezione deve restare SIGINT');

  assert.ok(read('main.js').includes("'clipboard-write'") && read('main.js').includes("'clipboard-read'"), 'mancano gli handler appunti');

  const menu = read('app', 'menu.js');
  const edit = menu.match(/label: 'Edit',[\s\S]*?\n {4}\},/);
  assert.ok(edit, 'manca il menu Edit');
  assert.ok(!/role: '(copy|paste|cut|undo|redo|selectAll)'/.test(edit[0]), 'il menu Edit usa i ruoli nativi, che ignorano la selezione dei terminali');
  assert.ok(!/accelerator: 'Ctrl\+(C|Z|X)'/.test(edit[0]), 'un acceleratore ruba una scorciatoia della shell');
  // La menubar in-app (Linux/Windows) deve fare la stessa cosa del menu nativo:
  // niente wc.copy()/wc.paste(), che non vedono la selezione dei terminali.
  const inApp = menu.slice(menu.indexOf('function runMenuAction'));
  assert.ok(!/wc\.(copy|paste|cut|undo|redo|selectAll)\(\)/.test(inApp), 'la menubar in-app usa i metodi nativi di webContents per Edit');
  assert.ok(/case 'copy'[\s\S]{0,200}send\('menu-edit'/.test(inApp), 'la menubar in-app non passa da menu-edit');

  const pre = read('preload.js');
  for (const f of ['clipboardWrite', 'clipboardRead', 'onMenuEdit']) assert.ok(pre.includes(f), `manca ${f} nel preload`);
});

// ---------- Directory recenti ----------
ok('recenti: main + preload + UI collegati', () => {
  assert.ok(read('main.js').includes("'get-recent-dirs'"), 'manca handler get-recent-dirs');
  assert.ok(read('main.js').includes("require('./lib/recent-dirs')"), 'main.js non usa il modulo recent-dirs');
  assert.ok(read('preload.js').includes('getRecentDirs'), 'manca getRecentDirs nel preload');
  assert.ok(read('renderer', 'index.html').includes('id="recent-dirs"'), 'manca il contenitore delle directory recenti');
  const js = read('renderer', 'renderer.js');
  assert.ok(js.includes('renderRecentDirs'), 'il renderer non mostra le directory recenti');
  assert.ok(/openNewModal[\s\S]{0,400}renderRecentDirs\(\)/.test(js), "le directory recenti non vengono aggiornate all'apertura del modal");
  assert.ok(/#recent-dirs-row\[hidden\]\s*\{[^}]*display:\s*none/.test(read('renderer', 'styles.css')), 'la riga delle directory recenti non si nasconde quando vuota');
});

// ---------- Profili di comando ----------
ok('comandi: main + preload + UI collegati', () => {
  const { SESSION_TYPES } = require('../lib/command-profiles');
  const main = read('main.js');
  for (const h of ['get-command-profiles', 'save-command-profiles', 'reset-command-profiles']) assert.ok(main.includes(`'${h}'`), `manca handler ${h}`);
  assert.ok(main.includes("require('./lib/profiles')"), 'main.js non usa lo store dei profili');
  assert.ok(read('app', 'menu.js').includes("'menu-open-config'"), 'manca la voce di menu Configurazione comandi');

  const pre = read('preload.js');
  for (const f of ['getCommandProfiles', 'saveCommandProfiles', 'resetCommandProfiles', 'menu-open-config']) assert.ok(pre.includes(f), `manca ${f} nel preload`);

  const html = read('renderer', 'index.html');
  assert.ok(html.includes('data-action="open-config"'), 'manca la voce Configurazione nel menu File in-app');
  assert.ok(html.includes('id="modal-config"'), 'manca il modal di configurazione');
  assert.ok(html.includes('id="modal-pick-command"'), 'manca il modal di scelta del comando');
  for (const t of SESSION_TYPES) assert.ok(html.includes(`data-config-tab="${t}"`), `manca il tab di configurazione per ${t}`);
});

ok('comandi: le variabili del profilo arrivano al pty e vincono sui default', () => {
  const pty = read('app', 'pty.js');
  assert.ok(/\.\.\.\(profileEnv \|\| \{\}\)/.test(pty), 'pty.spawn non riceve le variabili del profilo');
  assert.ok(/alias della shell/i.test(read('lib', 'commands.js')), "l'errore di binario mancante non spiega il caso alias");
});

// ---------- Login Claude per config dir (comportamentale) ----------
ok('claude: il login viene letto nella config dir del profilo, non sempre in ~/.claude', () => {
  const { detectOauth } = require('../lib/accounts');
  const dir = tmp('ais-cfg-');
  assert.deepStrictEqual(detectOauth(dir), { available: false }, 'config dir vuota: nessun login');

  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'x', subscriptionType: 'max' } }));
  assert.deepStrictEqual(detectOauth(dir), { available: true, label: 'login corrente (max)' });

  // macOS: il token sta nel Keychain, l'account si ricava da .claude.json accanto alla config dir
  const dir2 = tmp('ais-cfg-');
  fs.writeFileSync(path.join(dir2, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'tizio@example.com' } }));
  assert.deepStrictEqual(detectOauth(dir2), { available: true, label: 'login corrente (tizio@example.com)' });

  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
});

ok('claude: account a chiave API + profilo con CLAUDE_CONFIG_DIR viene bloccato prima dello spawn', () => {
  const { createPtyManager } = require('../app/pty');
  const { createAccountStore } = require('../lib/accounts');
  const { createHistoryStore } = require('../lib/history');
  const { createProfileStore } = require('../lib/profiles');
  const dir = tmp('ais-pty-');
  const accounts = createAccountStore({ dir });
  const history = createHistoryStore({ dir });
  const profiles = createProfileStore({ dir });
  accounts.add({ name: 'lavoro', apiKey: 'sk-ant-x' });
  const accId = accounts.list()[0].id;
  // percorso esplicito a /bin/sh: non dipende da claude installato
  const cfg = profiles.load();
  cfg.profiles.claude = [{ id: 'claude:iso', label: 'Isolato', command: 'CLAUDE_CONFIG_DIR=/tmp/cfg-iso /bin/sh', resumeArgs: '' }];
  profiles.save(cfg);

  const sent = [];
  const mgr = createPtyManager({ accounts: () => accounts, history: () => history, profiles, sendToRenderer: (c, p) => sent.push(c) });
  const r = mgr.spawn({ id: 't1', type: 'claude', cwd: dir, claudeAccountId: accId, commandProfileId: 'claude:iso' });

  assert.strictEqual(r.ok, false);
  assert.ok(/ANTHROPIC_API_KEY ha la precedenza sul login del profilo/.test(r.error), r.error);
  assert.strictEqual(mgr.size, 0, 'nessun processo deve essere partito');
  assert.deepStrictEqual(sent, [], 'niente deve essere arrivato al renderer');
  assert.deepStrictEqual(history.load(), [], 'un avvio rifiutato non va in cronologia');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Correzioni del branch 3 ----------
ok('profili: il file puo contenere segreti e non e leggibile da altri utenti', () => {
  const { createProfileStore, FILE_MODE } = require('../lib/profiles');
  const dir = tmp('ais-prof-');
  const profiles = createProfileStore({ dir });
  profiles.save({ profiles: profiles.defaults() });
  assert.strictEqual(fs.statSync(profiles.file).mode & 0o777, FILE_MODE, 'permessi diversi da 600');
  // anche riscrivendo un file gia' esistente (writeFileSync applica mode solo alla creazione)
  fs.chmodSync(profiles.file, 0o644);
  profiles.save({ profiles: profiles.defaults() });
  assert.strictEqual(fs.statSync(profiles.file).mode & 0o777, FILE_MODE, 'la riscrittura ha perso il 600');
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('claude: ANTHROPIC_API_KEY nel profilo + account a chiave API viene bloccato come il caso CLAUDE_CONFIG_DIR', () => {
  const { createPtyManager } = require('../app/pty');
  const { createAccountStore } = require('../lib/accounts');
  const { createHistoryStore } = require('../lib/history');
  const { createProfileStore } = require('../lib/profiles');
  const dir = tmp('ais-pty-');
  const accounts = createAccountStore({ dir });
  const history = createHistoryStore({ dir });
  const profiles = createProfileStore({ dir });
  accounts.add({ name: 'lavoro', apiKey: 'sk-ant-account' });
  const accId = accounts.list()[0].id;
  const cfg = profiles.load();
  cfg.profiles.claude = [{ id: 'claude:k', label: 'Con chiave', command: 'ANTHROPIC_API_KEY=sk-ant-nel-profilo /bin/sh', resumeArgs: '' }];
  profiles.save(cfg);

  const mgr = createPtyManager({ accounts: () => accounts, history: () => history, profiles, sendToRenderer: () => {} });
  const r = mgr.spawn({ id: 't2', type: 'claude', cwd: dir, claudeAccountId: accId, commandProfileId: 'claude:k' });
  assert.strictEqual(r.ok, false);
  assert.ok(/imposta già ANTHROPIC_API_KEY/.test(r.error), r.error);
  assert.strictEqual(mgr.size, 0);

  // con OAuth invece il profilo con la chiave e' legittimo: e' la scelta esplicita dell'utente
  const ok2 = mgr.spawn({ id: 't3', type: 'claude', cwd: dir, claudeAccountId: 'oauth', commandProfileId: 'claude:k' });
  assert.strictEqual(ok2.ok, true, ok2.error);
  mgr.kill('t3');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Resume Antigravity ----------
ok('antigravity: main + preload + UI collegati', () => {
  const main = read('main.js');
  assert.ok(main.includes("'list-antigravity-sessions'"), 'manca handler list-antigravity-sessions');
  assert.ok(main.includes("require('./lib/antigravity-sessions')"), 'main.js non usa il modulo antigravity-sessions');
  assert.ok(read('preload.js').includes('listAntigravity'), 'manca listAntigravity nel preload');
  assert.ok(read('renderer', 'index.html').includes('data-tab="antigravity"'), 'manca il tab antigravity nel resume');
  const js = read('renderer', 'renderer.js');
  assert.ok(js.includes('listAntigravity'), 'il renderer non carica le conversazioni antigravity');
  assert.ok(/antigravity:\s*\(s\)\s*=>\s*\(\{/.test(js), 'manca la vista resume di antigravity');
});

// ---------- Nomi delle schede ----------
/* Il pty puo' spostare la sessione (cwd assente, con ~ o inesistente finisce
   nella home): se la scheda tiene il valore digitato, il titolo automatico non
   trova mai la conversazione, perche' confronta le directory. */
ok('nomi: la scheda adotta la directory davvero usata dal pty', () => {
  const { resolveWorkdir } = require('../lib/workdir');
  const home = '/home/tizio';
  const isDir = (p) => p === home || p === '/home/tizio/progetto';
  assert.strictEqual(resolveWorkdir('~/progetto', { home, isDir }), '/home/tizio/progetto', 'la tilde non viene espansa');
  assert.strictEqual(resolveWorkdir('/non/esiste', { home, isDir }), home, 'una directory inesistente non ripiega sulla home');
  assert.strictEqual(resolveWorkdir('', { home, isDir }), home);
  assert.ok(/return \{ ok: true, cwd: workdir \}/.test(read('app', 'pty.js')), 'pty.spawn non restituisce la directory risolta');
  assert.ok(/res\.cwd/.test(read('renderer', 'renderer.js')), 'il renderer non adotta la directory risolta dal main');
});

ok('nomi: rinomina manuale, titoli automatici e primo prompt collegati alla UI', () => {
  const html = read('renderer', 'index.html');
  const js = read('renderer', 'renderer.js');
  assert.ok(html.includes('session-titles.js'), 'session-titles.js non e incluso nella pagina');
  assert.ok(html.includes('prompt-capture.js'), 'prompt-capture.js non e incluso nella pagina');
  assert.ok(js.includes('AisessTitles'), 'il renderer non usa lo store dei nomi');
  // La sidebar si ricostruisce al primo click, quindi il dblclick del browser
  // non scatta: serve il riconoscimento manuale del doppio click.
  assert.ok(/DOUBLE_CLICK_MS/.test(read('renderer', 'sidebar.js')) && /renameTab\(/.test(js),
    'manca la rinomina manuale col doppio click');
  // window.prompt() lancia un errore in Electron: serve il modal interno
  assert.ok(!/window\.prompt\(/.test(js), 'window.prompt() non e supportato in Electron');
  assert.ok(html.includes('modal-rename'), 'manca il modal di rinomina');
  assert.ok(js.includes('autoTitleTick') || js.includes('refreshAutoTitles'), 'il renderer non aggiorna i titoli automatici');
  assert.ok(/displayName\(/.test(js), 'la lista resume non mostra il nome scelto dall utente');
  assert.ok(/createPromptCapture/.test(js), 'il renderer non cattura il primo prompt');
  assert.ok(/namedFromPrompt/.test(js), 'il titolo del CLI puo sovrascrivere il prompt digitato');
  // Finche' manca il prompt, il titolo e' solo l'id di ripiego: non va usato
  assert.ok(/s\.titled === false/.test(js), 'il renderer applica anche i titoli di ripiego');
});

// ---------- Raggruppamento delle sessioni ----------
ok('raggruppamento: la radice di progetto arriva dal main alle schede', () => {
  const main = read('main.js');
  assert.ok(main.includes("'resolve-project'"), 'manca handler resolve-project');
  assert.ok(main.includes("require('./lib/project-root')"), 'main.js non usa il modulo project-root');
  assert.ok(read('preload.js').includes('resolveProject'), 'manca resolveProject nel preload');

  const js = read('renderer', 'renderer.js');
  assert.ok(/projectRoot/.test(js), 'la scheda non tiene la radice di progetto');
  // La cwd vera la decide il main (resolveWorkdir): risolvere prima dello
  // spawn legherebbe la scheda a una directory che non è quella usata.
  assert.ok(/res\.cwd[\s\S]{0,400}resolveProjectRoot/.test(js),
    'la radice di progetto non viene risolta sulla directory restituita dal main');
});

ok('raggruppamento: il selettore esiste, persiste e non usa handler inline', () => {
  const html = read('renderer', 'index.html');
  assert.ok(html.includes('id="group-mode-type"') && html.includes('id="group-mode-project"'),
    'manca il selettore Tipo | Progetto');
  const seg = html.match(/<div class="seg"[\s\S]*?<\/div>/);
  assert.ok(seg, 'manca il contenitore .seg del selettore');
  assert.ok(!/on(click|change)=/.test(seg[0]), 'handler inline: la CSP lo blocca');
  assert.ok(/aria-pressed/.test(seg[0]), 'il selettore non dice quale modalità è attiva');

  const js = read('renderer', 'sidebar.js');
  assert.ok(js.includes("'aisess.groupMode'"), 'la modalità non viene persistita');
  assert.ok(js.includes("'aisess.collapsedProjects'"),
    'i collassi dei progetti condividono la chiave con quelli dei tipi');
  assert.ok(/groupKeyFor\(/.test(js), 'il collasso non segue la modalità corrente');
  assert.ok(!/collapsedGroups\.has\(t\.type\)/.test(js),
    'setActive espande ancora il gruppo per tipo anche in modalità progetto');
});
