const assert = require('node:assert');
const path = require('path');
const { test: ok } = require('node:test');
const { installWin, SETUP } = require('../scripts/install-win');

const ROOT = 'C:\\src\\PizzaManager';
const quiet = () => {};

/* Un finto spawnSync: registra le chiamate e risponde per comando. */
function fakeSpawn({ running = false, build = 0, setup = 0 } = {}) {
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push(Array.isArray(args) ? [cmd, ...args] : [cmd]);
    if (cmd === 'tasklist') return { status: 0, stdout: running ? 'PizzaManager.exe   1234 Console' : 'INFO: nessuna attività' };
    if (cmd.startsWith('npm')) return { status: build };
    return { status: setup };
  };
  return { spawn, calls };
}

ok('install:win: costruisce, poi installa in silenzio col setup', () => {
  const { spawn, calls } = fakeSpawn();
  const lines = [];
  const code = installWin({ platform: 'win32', spawn, exists: () => true, root: ROOT, env: { LOCALAPPDATA: 'C:\\Users\\jack\\AppData\\Local' }, log: (l) => lines.push(l), error: quiet });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(calls.slice(1), [['npm run dist:win'], [path.join(ROOT, SETUP), '/S']]);
  assert.ok(lines.some((l) => l.includes('C:\\Users\\jack\\AppData\\Local\\Programs\\PizzaManager')), lines.join('\n'));
});

ok('install:win: con PizzaManager aperta si ferma prima di costruire', () => {
  const { spawn, calls } = fakeSpawn({ running: true });
  const errors = [];
  assert.strictEqual(installWin({ platform: 'win32', spawn, exists: () => true, root: ROOT, log: quiet, error: (l) => errors.push(l) }), 1);
  assert.deepStrictEqual(calls.map((c) => c[0]), ['tasklist'], 'niente build né setup');
  assert.ok(/aperta/.test(errors.join()), errors.join());
});

ok('install:win: una build fallita non lancia un setup vecchio', () => {
  const { spawn, calls } = fakeSpawn({ build: 1 });
  assert.strictEqual(installWin({ platform: 'win32', spawn, exists: () => true, root: ROOT, log: quiet, error: quiet }), 1);
  assert.ok(!calls.some((c) => c[0].endsWith('setup.exe')));
});

ok('install:win: fuori da Windows rimanda a install:mac', () => {
  const { spawn, calls } = fakeSpawn();
  const errors = [];
  assert.strictEqual(installWin({ platform: 'darwin', spawn, log: quiet, error: (l) => errors.push(l) }), 1);
  assert.deepStrictEqual(calls, []);
  assert.ok(/install:mac/.test(errors.join()), errors.join());
});
