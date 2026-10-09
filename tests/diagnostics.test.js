// lib/diagnostics.js: la riga di contesto allegata a ogni segnalazione.
// Serve a non dover chiedere «che versione hai? hai tmux?» a ogni scambio.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { diagnosticLine } = require('../lib/diagnostics');

ok('dice versione, sistema e se c e tmux', () => {
  const d = diagnosticLine({ version: '1.4.0', platform: 'darwin', tmux: true, clis: { claude: true, codex: false } });
  assert.match(d, /1\.4\.0/);
  assert.match(d, /macOS/);
  assert.match(d, /tmux/);
});

ok('i nomi dei sistemi sono quelli che usa la gente', () => {
  assert.match(diagnosticLine({ platform: 'darwin' }), /macOS/);
  assert.match(diagnosticLine({ platform: 'win32' }), /Windows/);
  assert.match(diagnosticLine({ platform: 'linux' }), /Linux/);
  // Un sistema che non conosciamo si riporta com e, invece di sparire.
  assert.match(diagnosticLine({ platform: 'freebsd' }), /freebsd/);
});

ok('senza tmux lo dice, perche cambia tutto il comportamento', () => {
  // Senza tmux le sessioni muoiono con l app: meta' delle segnalazioni
  // «le sessioni spariscono» si spiegano con questa riga.
  assert.match(diagnosticLine({ platform: 'linux', tmux: false }), /senza tmux/i);
  assert.match(diagnosticLine({ platform: 'linux', tmux: true }), /con tmux/i);
});

ok('elenca le CLI trovate, e dice quando non ce ne sono', () => {
  const con = diagnosticLine({ clis: { claude: true, codex: true, opencode: false } });
  assert.match(con, /claude/);
  assert.match(con, /codex/);
  assert.ok(!/opencode/.test(con), 'le CLI assenti non si elencano');
  assert.match(diagnosticLine({ clis: {} }), /nessuna CLI/i);
});

ok('con dati mancanti non lancia e non scrive «undefined»', () => {
  for (const arg of [undefined, {}, { version: null, platform: null, clis: null }]) {
    const d = diagnosticLine(arg);
    assert.ok(typeof d === 'string' && d.length > 0, JSON.stringify(arg));
    assert.ok(!/undefined|null|NaN/.test(d), d);
  }
});

ok('e una riga sola: finisce in fondo a una issue, non e un rapporto', () => {
  const d = diagnosticLine({ version: '1.4.0', platform: 'darwin', tmux: true, clis: { claude: true } });
  assert.ok(!d.includes('\n'), d);
});

ok('collectDeps tiene solo le CLI trovate', () => {
  const { collectDeps } = require('../lib/diagnostics');
  const agents = [{ type: 'claude' }, { type: 'codex' }, { type: 'opencode' }];
  const deps = { claude: { found: true }, codex: { found: false }, opencode: { found: true } };
  assert.deepStrictEqual(collectDeps(deps, agents, true), { tmux: true, clis: { claude: true, opencode: true } });
  assert.deepStrictEqual(collectDeps(null, null, false), { tmux: false, clis: {} });
});
