/* Di quale account chiedere la quota: dalla scheda attiva alla config dir
   (docs/plans/35-quota-per-profilo.md). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { claudeQuotaTarget } = require('../lib/usage/claude-target');

const HOME = '/home/tizio';
const profilesOf = (...list) => ({ load: () => ({ version: 1, profiles: { claude: list } }) });
const LAVORO = { id: 'claude:lavoro', label: 'Lavoro', command: 'CLAUDE_CONFIG_DIR=~/.claude claude', resumeArgs: '--resume {id}' };
const PERSONALE = { id: 'claude:pers', label: 'Personale', command: 'CLAUDE_CONFIG_DIR=~/.claude-personal claude', resumeArgs: '--resume {id}' };
const NUDO = { id: 'claude:nudo', label: 'Claude', command: 'claude', resumeArgs: '--resume {id}' };
const base = { home: HOME, env: {}, platform: 'linux' };

test('la scheda Claude usa la config dir del suo profilo', () => {
  const t = claudeQuotaTarget({ ...base, tab: { type: 'claude', commandProfileId: 'claude:pers' }, profiles: profilesOf(LAVORO, PERSONALE) });
  assert.deepEqual(t, { configDir: '/home/tizio/.claude-personal' });
});

test('~/.claude esplicito resta esplicito: e\' un login diverso dal default', () => {
  const t = claudeQuotaTarget({ ...base, tab: { type: 'claude', commandProfileId: 'claude:lavoro' }, profiles: profilesOf(LAVORO) });
  assert.deepEqual(t, { configDir: '/home/tizio/.claude' });
});

test('profilo senza variabile: vale quella dell ambiente dell app', () => {
  const t = claudeQuotaTarget({
    ...base, env: { CLAUDE_CONFIG_DIR: '/home/tizio/.claude' },
    tab: { type: 'claude', commandProfileId: 'claude:nudo' }, profiles: profilesOf(NUDO),
  });
  assert.deepEqual(t, { configDir: '/home/tizio/.claude' });
});

test('profilo senza variabile e ambiente pulito: la voce di default', () => {
  const t = claudeQuotaTarget({ ...base, tab: { type: 'claude', commandProfileId: 'claude:nudo' }, profiles: profilesOf(NUDO) });
  assert.deepEqual(t, { configDir: null });
});

test('account a chiave API: nessuna quota a 5 ore da chiedere', () => {
  const t = claudeQuotaTarget({ ...base, tab: { type: 'claude', commandProfileId: 'claude:pers', claudeAccountId: 'acc_x' }, profiles: profilesOf(PERSONALE) });
  assert.equal(t, null);
});

test('account "oauth" e\' il login del profilo, non una chiave', () => {
  const t = claudeQuotaTarget({ ...base, tab: { type: 'claude', commandProfileId: 'claude:pers', claudeAccountId: 'oauth' }, profiles: profilesOf(PERSONALE) });
  assert.deepEqual(t, { configDir: '/home/tizio/.claude-personal' });
});

test('scheda non Claude o nessuna scheda: il primo profilo Claude, come allo spawn', () => {
  const profiles = profilesOf(PERSONALE, LAVORO);
  assert.deepEqual(claudeQuotaTarget({ ...base, tab: { type: 'shell', commandProfileId: 'shell:x' }, profiles }), { configDir: '/home/tizio/.claude-personal' });
  assert.deepEqual(claudeQuotaTarget({ ...base, tab: null, profiles }), { configDir: '/home/tizio/.claude-personal' });
});

test('profilo sparito o store illeggibile: si ricade sull ambiente', () => {
  const env = { CLAUDE_CONFIG_DIR: '/x' };
  assert.deepEqual(claudeQuotaTarget({ ...base, env, tab: { type: 'claude', commandProfileId: 'claude:non-c-e' }, profiles: profilesOf(LAVORO) }), { configDir: '/x' });
  const rotto = { load: () => { throw new Error('json storto'); } };
  assert.deepEqual(claudeQuotaTarget({ ...base, env, tab: { type: 'claude' }, profiles: rotto }), { configDir: '/x' });
  assert.deepEqual(claudeQuotaTarget({ ...base, env, tab: null, profiles: null }), { configDir: '/x' });
});

test('dal renderer arrivano solo stringhe: il resto vale "niente"', () => {
  const profiles = profilesOf(PERSONALE);
  const strano = { type: 'claude', commandProfileId: { toString: () => 'claude:pers' }, claudeAccountId: 42 };
  assert.deepEqual(claudeQuotaTarget({ ...base, tab: strano, profiles }), { configDir: '/home/tizio/.claude-personal' });
});
