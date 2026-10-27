const assert = require('node:assert');
const { test: ok } = require('node:test');

/* La schermata vuota (renderer/welcome.js) sul DOM finto: che cosa scrive
   per un dato resoconto degli strumenti e che cosa fanno i suoi pulsanti. */
const { installDocument, createElement, descendants } = require('./fake-dom');
const Welcome = require('../renderer/welcome');
const { setupReport } = require('../lib/setup-check');

const byClass = (root, c) => descendants(root).filter((n) => n.classes.has(c));
const text = (n) => [n.textContent, ...descendants(n).map((d) => d.textContent)].join(' ');

function mount(opts = {}) {
  const restore = installDocument();
  const root = createElement('div');
  const copied = [];
  const calls = { recheck: 0 };
  const w = Welcome.createWelcome({
    root, document: global.document,
    onCopy: (t) => copied.push(t),
    onRecheck: () => { calls.recheck += 1; },
    ...opts,
  });
  return { restore, root, w, copied, calls };
}

const found = (p) => ({ found: true, path: p });
const missing = { found: false, path: null };

ok('welcome: gli strumenti mancanti hanno il comando da copiare', () => {
  const { restore, root, w, copied } = mount();
  try {
    w.update(setupReport({ binaries: { claude: found('/b/claude'), codex: missing }, tmuxAvailable: true, platform: 'darwin' }));
    const rows = byClass(root, 'setup-row');
    const codex = rows.find((r) => text(r).includes('Codex'));
    assert.ok(codex.classes.has('is-missing'));
    assert.ok(text(codex).includes('npm i -g @openai/codex'));
    const copy = byClass(codex, 'setup-copy')[0];
    copy.onclick();
    assert.deepStrictEqual(copied, ['npm i -g @openai/codex']);
    assert.ok(copy.textContent.startsWith('Copiato'), 'il click non da conferma: gli appunti non si vedono');
    const claude = rows.find((r) => text(r).includes('Claude Code'));
    assert.ok(claude.classes.has('is-ok') && text(claude).includes('/b/claude'));
  } finally { restore(); }
});

ok('welcome: senza comando si copia l indirizzo, e la nota resta visibile', () => {
  const { restore, root, w, copied } = mount();
  try {
    w.update(setupReport({ binaries: {}, tmuxAvailable: true, platform: 'darwin' }));
    const agy = byClass(root, 'setup-row').find((r) => text(r).includes('Antigravity'));
    assert.ok(text(agy).includes('agy install'));
    byClass(agy, 'setup-copy')[0].onclick();
    assert.deepStrictEqual(copied, ['https://antigravity.google']);
  } finally { restore(); }
});

ok('welcome: tmux mancante dice di riavviare; su Windows non compare', () => {
  const { restore, root, w } = mount();
  try {
    w.update(setupReport({ binaries: { claude: found('/b/claude') }, tmuxAvailable: false, platform: 'darwin' }));
    const tmux = byClass(root, 'setup-row').find((r) => text(r).includes('tmux'));
    assert.ok(tmux && text(tmux).includes('brew install tmux') && /riavvia/i.test(text(tmux)));
    w.update(setupReport({ binaries: { claude: found('C:\\claude.cmd') }, tmuxAvailable: false, platform: 'win32' }));
    assert.ok(!byClass(root, 'setup-row').some((r) => text(r).includes('tmux')));
  } finally { restore(); }
});

ok('welcome: tmux installato ma non ancora attivo si attiva con «Riavvia ora»', () => {
  let riavvii = 0;
  const { restore, root, w } = mount({ onRestart: () => { riavvii += 1; } });
  try {
    w.update(setupReport({ binaries: { claude: found('/b/claude') }, tmuxAvailable: false, tmuxInstalled: true, tmuxPath: '/opt/homebrew/bin/tmux', platform: 'darwin' }));
    const tmux = byClass(root, 'setup-row').find((r) => text(r).includes('tmux'));
    assert.ok(tmux.classes.has('is-pending'), 'una ✘ dopo averlo installato fa pensare che non l abbia trovato');
    assert.ok(text(tmux).includes('/opt/homebrew/bin/tmux'));
    assert.strictEqual(byClass(tmux, 'setup-copy').length, 0);
    byClass(tmux, 'setup-restart')[0].onclick();
    assert.strictEqual(riavvii, 1);
  } finally { restore(); }
});

ok('welcome: «Riavvia ora» c e solo per tmux in attesa', () => {
  const { restore, root, w } = mount();
  try {
    w.update(setupReport({ binaries: { claude: found('/b/claude') }, tmuxAvailable: false, platform: 'darwin' }));
    assert.strictEqual(byClass(root, 'setup-restart').length, 0);
  } finally { restore(); }
});

ok('welcome: con tutto installato la sezione strumenti sparisce', () => {
  const { restore, root, w } = mount();
  try {
    const all = Object.fromEntries(['claude', 'codex', 'opencode', 'antigravity'].map((t) => [t, found('/b/' + t)]));
    w.update(setupReport({ binaries: all, tmuxAvailable: true, platform: 'linux' }));
    assert.strictEqual(byClass(root, 'setup-row').length, 0);
  } finally { restore(); }
});

ok('welcome: «Ricontrolla» rilegge, e senza nessun agente lo si dice', () => {
  const { restore, root, w, calls } = mount();
  try {
    w.update(setupReport({ binaries: {}, tmuxAvailable: true, platform: 'darwin' }));
    assert.ok(/almeno un assistente/i.test(text(byClass(root, 'setup')[0])));
    byClass(root, 'setup-recheck')[0].onclick();
    assert.strictEqual(calls.recheck, 1);
  } finally { restore(); }
});

ok('welcome: i nomi arrivano come testo, mai come HTML', () => {
  const { restore, root, w } = mount();
  try {
    w.update(setupReport({ binaries: { claude: found('/b/<img src=x>') }, tmuxAvailable: true, platform: 'darwin' }));
    assert.ok(descendants(root).every((n) => !n.html), 'qualcosa e passato da innerHTML');
  } finally { restore(); }
});

/* Le cose da sapere: funzioni che guardando l'app non si scoprono. */

ok('welcome: le cose da sapere ci sono sempre, anche a installazione completa', () => {
  const { restore, root, w } = mount();
  try {
    const all = Object.fromEntries(['claude', 'codex', 'opencode', 'antigravity'].map((t) => [t, found('/b/' + t)]));
    w.update(setupReport({ binaries: all, tmuxAvailable: true, platform: 'darwin' }));
    const tips = byClass(root, 'tip').map(text).join('\n');
    assert.ok(/doppio click/i.test(tips), 'manca la rinomina');
    assert.ok(/trascina/i.test(tips), 'manca il riordino');
    assert.ok(tips.includes('+'), 'manca il + del progetto');
    assert.ok(/barra in basso/i.test(tips), 'manca la barra d uso');
  } finally { restore(); }
});

ok('welcome: la promessa di tmux si fa solo se tmux c e', () => {
  const { restore, root, w } = mount();
  try {
    const bin = { claude: found('/b/claude') };
    w.update(setupReport({ binaries: bin, tmuxAvailable: true, platform: 'darwin' }));
    assert.ok(byClass(root, 'tip').some((t) => /restano vive/i.test(text(t))));
    w.update(setupReport({ binaries: bin, tmuxAvailable: false, platform: 'darwin' }));
    assert.ok(!byClass(root, 'tip').some((t) => /restano vive/i.test(text(t))), 'promette sessioni che sopravvivono senza tmux');
  } finally { restore(); }
});

ok('welcome: Nuova e Resume chiamano il renderer', () => {
  const calls = [];
  const { restore, root, w } = mount({ onNew: () => calls.push('new'), onResume: () => calls.push('resume') });
  try {
    w.update(null);
    byClass(root, 'welcome-new')[0].onclick();
    byClass(root, 'welcome-resume')[0].onclick();
    assert.deepStrictEqual(calls, ['new', 'resume']);
  } finally { restore(); }
});
