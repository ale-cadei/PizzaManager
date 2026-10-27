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

ok('setup: tmux installato ad app aperta e in attesa di riavvio, non ancora a posto', () => {
  const mac = setupReport({ binaries, tmuxAvailable: false, tmuxInstalled: true, tmuxPath: '/opt/homebrew/bin/tmux', platform: 'darwin' });
  assert.strictEqual(mac.tmux.found, false, 'le sessioni non lo usano finché l app non riparte');
  assert.strictEqual(mac.tmux.pending, true);
  assert.strictEqual(mac.tmux.path, '/opt/homebrew/bin/tmux');
  assert.ok(/riavvi/i.test(mac.tmux.note), mac.tmux.note);
  const tutti = Object.fromEntries(['claude', 'codex', 'opencode', 'antigravity'].map((t) => [t, found('/x/' + t)]));
  assert.strictEqual(setupReport({ binaries: tutti, tmuxAvailable: false, tmuxInstalled: true, platform: 'darwin' }).complete, false);
  assert.strictEqual(setupReport({ binaries, tmuxAvailable: true, platform: 'darwin' }).tmux.pending, false);
});

ok('setup: su macOS anche a tmux mancante si dice come riavviare davvero', () => {
  const mac = setupReport({ binaries, tmuxAvailable: false, platform: 'darwin' });
  assert.strictEqual(mac.tmux.pending, false);
  assert.ok(mac.tmux.note.includes('⌘Q'), mac.tmux.note);
});

ok('setup: su Windows tmux non si chiede (l app gira senza)', () => {
  const r = setupReport({ binaries: { claude: found('C:\\x\\claude.cmd') }, tmuxAvailable: false, platform: 'win32' });
  assert.strictEqual(r.tmux, null);
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

ok('check-deps: «Ricontrolla» cerca tmux di nuovo, nel PATH di login', () => {
  const cercato = [];
  const r = checkDeps({
    tmuxAvailable: false, platform: 'darwin',
    resolveAll: () => ({ claude: found('/b/claude') }),
    loginPath: () => '/usr/bin:/opt/homebrew/bin',
    resolveTmux: (searchPath) => { cercato.push(searchPath); return { path: '/opt/homebrew/bin/tmux' }; },
  });
  assert.deepStrictEqual(cercato, ['/usr/bin:/opt/homebrew/bin']);
  assert.strictEqual(r.setup.tmux.pending, true);
  assert.strictEqual(r.setup.tmux.path, '/opt/homebrew/bin/tmux');
  const assente = checkDeps({
    tmuxAvailable: false, platform: 'darwin',
    resolveAll: () => ({}), loginPath: () => '/usr/bin', resolveTmux: () => ({ path: null }),
  });
  assert.strictEqual(assente.setup.tmux.pending, false);
});

ok('check-deps: con tmux gia attivo, o su Windows, tmux non si cerca', () => {
  let ricerche = 0;
  const resolveTmux = () => { ricerche += 1; return { path: '/x/tmux' }; };
  const base = { resolveAll: () => ({}), loginPath: () => '/usr/bin', resolveTmux };
  checkDeps({ ...base, tmuxAvailable: true, platform: 'darwin' });
  checkDeps({ ...base, tmuxAvailable: false, platform: 'win32' });
  assert.strictEqual(ricerche, 0);
});
