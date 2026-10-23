const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Che cosa manca per usare l'app: il resoconto che la schermata vuota mostra
   al primo avvio. Puro: riceve i binari trovati e la piattaforma, non tocca
   il filesystem. */
const { setupReport, checkDeps } = require('../lib/setup-check');

const found = (p) => ({ found: true, path: p });
const missing = { found: false, path: null };
const binaries = {
  claude: found('/opt/homebrew/bin/claude'),
  codex: missing,
  opencode: missing,
  antigravity: missing,
};

ok('setup: per ogni agente dice se c e e, se manca, come installarlo', () => {
  const r = setupReport({ binaries, tmuxAvailable: true, platform: 'darwin' });
  const byType = Object.fromEntries(r.agents.map((a) => [a.type, a]));
  assert.deepStrictEqual(r.agents.map((a) => a.type), ['claude', 'codex', 'opencode', 'antigravity']);
  assert.strictEqual(byType.claude.found, true);
  assert.strictEqual(byType.claude.path, '/opt/homebrew/bin/claude');
  assert.strictEqual(byType.claude.label, 'Claude Code');
  assert.strictEqual(byType.codex.install.command, 'npm i -g @openai/codex');
  // Antigravity non ha un comando da copiare: solo dove andare
  assert.strictEqual(byType.antigravity.install.command, null);
  assert.ok(byType.antigravity.install.url.startsWith('https://'));
});

ok('setup: basta un agente per cominciare, ma il resoconto sa che non e completo', () => {
  const r = setupReport({ binaries, tmuxAvailable: true, platform: 'darwin' });
  assert.strictEqual(r.ready, true);
  assert.strictEqual(r.complete, false);
  const nessuno = setupReport({ binaries: { claude: missing }, tmuxAvailable: true, platform: 'darwin' });
  assert.strictEqual(nessuno.ready, false);
});

ok('setup: tmux si installa col gestore della piattaforma, e serve riavviare', () => {
  const mac = setupReport({ binaries, tmuxAvailable: false, platform: 'darwin' });
  assert.strictEqual(mac.tmux.found, false);
  assert.strictEqual(mac.tmux.install.command, 'brew install tmux');
  assert.ok(/riavvia/i.test(mac.tmux.note));
  assert.strictEqual(setupReport({ binaries, tmuxAvailable: false, platform: 'linux' }).tmux.install.command, 'sudo apt install tmux');
});

ok('setup: su Windows non c e niente da installare: psmux viaggia nel pacchetto', () => {
  const r = setupReport({ binaries: { claude: found('C:\\x\\claude.cmd') }, tmuxAvailable: false, platform: 'win32' });
  assert.strictEqual(r.tmux, null);
});

/* Se le sessioni sopravvivono alla chiusura non dipende piu' dal sistema: su
   Windows lo fa psmux (docs/plans/52), quindi lo dice `persistent`, non la
   riga di tmux. */
ok('setup: persistent dice se le sessioni restano vive, anche su Windows con psmux', () => {
  const win = (tmuxAvailable) => setupReport({ binaries, tmuxAvailable, platform: 'win32' });
  assert.strictEqual(win(true).persistent, true);
  assert.strictEqual(win(false).persistent, false);
  assert.strictEqual(setupReport({ binaries, tmuxAvailable: true, platform: 'darwin' }).persistent, true);
  assert.strictEqual(setupReport({ binaries, tmuxAvailable: false, platform: 'linux' }).persistent, false);
});

/* Il pallino nella legenda: nome e spiegazione per il tooltip. */
ok('legenda: con tmux dice dov e e che le sessioni restano; senza, come installarlo', () => {
  const { backendInfo } = require('../lib/setup-check');
  assert.deepStrictEqual(backendInfo({ available: true, path: '/opt/homebrew/bin/tmux', platform: 'darwin' }), {
    name: 'tmux',
    title: 'tmux: /opt/homebrew/bin/tmux\nLe sessioni restano vive alla chiusura dell\'app e tornano alla riapertura.',
  });
  const senza = backendInfo({ available: false, path: null, platform: 'darwin' });
  assert.match(senza.title, /muoiono con la finestra/);
  assert.match(senza.title, /brew install tmux/);
  assert.match(backendInfo({ available: false, platform: 'linux' }).title, /apt install tmux/);
});

ok('legenda: su Windows e psmux, con la versione; se non parte niente brew, ma l antivirus', () => {
  const { backendInfo } = require('../lib/setup-check');
  const bin = 'C:\\Users\\jack\\AppData\\Local\\PizzaManager\\psmux\\3.3.8\\psmux.exe';
  assert.deepStrictEqual(backendInfo({ available: true, path: bin, version: '3.3.8', platform: 'win32' }), {
    name: 'psmux',
    title: `psmux 3.3.8: ${bin}\nLe sessioni restano vive alla chiusura dell'app e tornano alla riapertura.`,
  });
  const giu = backendInfo({ available: false, path: null, platform: 'win32' });
  assert.strictEqual(giu.name, 'psmux');
  assert.match(giu.title, /muoiono con la finestra/);
  assert.match(giu.title, /antivirus/);
  assert.ok(!/brew|apt|tmux/.test(giu.title), giu.title);
});

ok('setup: tutto installato e un resoconto completo; input mancanti non lanciano', () => {
  const tutti = Object.fromEntries(['claude', 'codex', 'opencode', 'antigravity'].map((t) => [t, found('/x/' + t)]));
  assert.strictEqual(setupReport({ binaries: tutti, tmuxAvailable: true, platform: 'linux' }).complete, true);
  const vuoto = setupReport({});
  assert.strictEqual(vuoto.ready, false);
  assert.ok(vuoto.agents.every((a) => a.found === false));
});

ok('check-deps: binari, PATH e resoconto da una sola ricerca dei binari', () => {
  let ricerche = 0;
  const r = checkDeps({
    tmuxAvailable: true, platform: 'linux',
    resolveAll: () => { ricerche += 1; return { claude: found('/b/claude') }; },
    loginPath: () => '/usr/bin:/b',
  });
  assert.strictEqual(ricerche, 1);
  assert.strictEqual(r.claude.path, '/b/claude', 'i pallini della sidebar leggono ancora i binari al primo livello');
  assert.strictEqual(r.path, '/usr/bin:/b');
  assert.strictEqual(r.setup.ready, true);
});
