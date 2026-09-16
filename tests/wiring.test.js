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
