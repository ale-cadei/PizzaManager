const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test } = require('node:test');

const { composeCommand } = require('../lib/commands');
const { createProfileStore } = require('../lib/profiles');

function freshProfiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-compose-'));
  return createProfileStore({ dir });
}

test('composeCommand: il binario resta il nome del profilo, senza cercarlo nel PATH', () => {
  const r = composeCommand('claude', 'uuid-1', null, { profiles: freshProfiles(), platform: 'linux' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.bin, 'claude');
  assert.deepStrictEqual(r.args, ['--resume', 'uuid-1']);
});

test('composeCommand: nome della sessione e iniezioni negli args, non in baseArgs', () => {
  const inject = () => ({ args: ['--hook'], env: { X: '1' } });
  const r = composeCommand('claude', null, null, { profiles: freshProfiles(), platform: 'linux', inject, sessionName: 'mio' });
  assert.deepStrictEqual(r.baseArgs, []);
  assert.deepStrictEqual(r.args, ['--name=mio', '--hook']);
  assert.deepStrictEqual(r.injectedEnv, { X: '1' });
});

test('composeCommand: profilo inesistente → errore leggibile', () => {
  const r = composeCommand('claude', null, 'claude:nope', { profiles: freshProfiles(), platform: 'linux' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /non esiste più/);
});
