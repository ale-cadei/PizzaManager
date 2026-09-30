/* Dove sta il token OAuth di Claude, per piattaforma e per config dir
   (docs/plans/35-quota-per-profilo.md). Niente Keychain vero: `run` e' iniettato. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readClaudeToken, keychainService } = require('../lib/usage/claude-token');

const TOKEN = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz';
const PAYLOAD = JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: 'r' } });

function dirWithCredentials(token) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-'));
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token } }));
  return dir;
}

function recordingRun(result) {
  const calls = [];
  const run = async (file, args) => {
    calls.push({ file, args });
    if (result instanceof Error) throw result;
    return { stdout: result };
  };
  return { run, calls };
}

test('keychainService: senza config dir e\' la voce senza suffisso', () => {
  assert.equal(keychainService(null), 'Claude Code-credentials');
  assert.equal(keychainService(''), 'Claude Code-credentials');
});

test('keychainService: con config dir, 8 caratteri dello sha256 del path', () => {
  // Valori letti dal Keychain vero il 2026-09-30 (piano 35, passo 0)
  assert.equal(keychainService('/Users/jack/.claude-personal'), 'Claude Code-credentials-82109b51');
  assert.equal(keychainService('/Users/jack/.claude'), 'Claude Code-credentials-ba3d4882');
});

test('darwin: il token arriva dal Keychain, voce della config dir', async () => {
  const { run, calls } = recordingRun(PAYLOAD + '\n');
  const token = await readClaudeToken({ configDir: '/Users/jack/.claude-personal', platform: 'darwin', run });
  assert.equal(token, TOKEN);
  assert.equal(calls[0].file, 'security');
  assert.deepEqual(calls[0].args, ['find-generic-password', '-s', 'Claude Code-credentials-82109b51', '-w']);
});

test('darwin: una voce restituita in esadecimale si decodifica', async () => {
  const { run } = recordingRun(Buffer.from(PAYLOAD, 'utf8').toString('hex') + '\n');
  assert.equal(await readClaudeToken({ platform: 'darwin', run }), TOKEN);
});

test('darwin: Keychain vuoto, si prova il file nella config dir', async () => {
  const dir = dirWithCredentials(TOKEN);
  const { run } = recordingRun(new Error('The specified item could not be found in the keychain.'));
  assert.equal(await readClaudeToken({ configDir: dir, platform: 'darwin', run }), TOKEN);
});

test('darwin: senza config dir il file e\' ~/.claude/.credentials.json', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), PAYLOAD);
  const { run } = recordingRun(new Error('non trovato'));
  assert.equal(await readClaudeToken({ platform: 'darwin', home, run }), TOKEN);
});

test('linux: si legge il file e il Keychain non si tocca', async () => {
  const dir = dirWithCredentials(TOKEN);
  const { run, calls } = recordingRun(PAYLOAD);
  assert.equal(await readClaudeToken({ configDir: dir, platform: 'linux', run }), TOKEN);
  assert.equal(calls.length, 0);
});

test('win32: stesso file, nessun Keychain', async () => {
  const dir = dirWithCredentials(TOKEN);
  const { run, calls } = recordingRun(PAYLOAD);
  assert.equal(await readClaudeToken({ configDir: dir, platform: 'win32', run }), TOKEN);
  assert.equal(calls.length, 0);
});

test('un token troppo corto o una voce storta valgono niente', async () => {
  assert.equal(await readClaudeToken({ platform: 'darwin', run: recordingRun('non json').run, home: '/non/esiste' }), null);
  assert.equal(await readClaudeToken({ configDir: dirWithCredentials('corto'), platform: 'linux' }), null);
  assert.equal(await readClaudeToken({ configDir: '/non/esiste', platform: 'linux' }), null);
});
