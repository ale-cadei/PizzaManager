const assert = require('node:assert');
const { test: ok } = require('node:test');
const { postinstall } = require('../scripts/postinstall');

const quiet = () => {};

ok('postinstall: su Windows node-pty non si ricompila', () => {
  let spawned = 0;
  const r = postinstall({ platform: 'win32', spawn: () => { spawned++; return { status: 0 }; }, log: quiet });
  assert.strictEqual(spawned, 0, 'su Windows servono i Build Tools con Spectre: il rebuild non va tentato');
  assert.deepStrictEqual(r, { rebuilt: false });
});

ok('postinstall: su macOS e Linux ricompila node-pty per Electron', () => {
  const calls = [];
  const r = postinstall({ platform: 'linux', spawn: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0 }; }, log: quiet });
  assert.deepStrictEqual(calls, [['electron-rebuild', '-f', '-w', 'node-pty']]);
  assert.deepStrictEqual(r, { rebuilt: true });
});

ok('postinstall: un rebuild fallito avvisa ma non fa fallire npm install', () => {
  const lines = [];
  const r = postinstall({ platform: 'darwin', spawn: () => ({ status: 1 }), log: (l) => lines.push(l) });
  assert.deepStrictEqual(r, { rebuilt: false, failed: true });
  assert.ok(lines.some((l) => /non riuscito/.test(l)), lines.join('\n'));
});
