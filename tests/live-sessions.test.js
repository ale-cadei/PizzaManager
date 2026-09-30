const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createLiveSessionsStore, restorableSessions, restorePlan } = require('../lib/live-sessions');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ais-live-'));
const S = (name, extra = {}) => ({ name, type: 'claude', cwd: '/w', ...extra });

ok('registro: vuoto all inizio, scrive e rilegge, clear svuota', () => {
  const dir = tmp();
  const store = createLiveSessionsStore({ dir });
  assert.deepStrictEqual(store.read(), []);
  store.write([S('ais-claude-1'), S('ais-shell-2', { type: 'shell' })]);
  assert.strictEqual(store.read().length, 2);
  store.clear();
  assert.deepStrictEqual(store.read(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('registro: un file corrotto non fa cadere l avvio, si riparte da vuoto', () => {
  const dir = tmp();
  const store = createLiveSessionsStore({ dir });
  fs.writeFileSync(store.file, '{ non e json');
  assert.deepStrictEqual(store.read(), []);
  fs.writeFileSync(store.file, JSON.stringify([{ senzaNome: true }, S('ais-ok')]));
  assert.deepStrictEqual(store.read().map((s) => s.name), ['ais-ok'], 'le voci senza nome si scartano');
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('ripristino: tmux vuoto e registro pieno = sparito tutto insieme, si propone tutto', () => {
  const snap = [S('ais-a'), S('ais-b')];
  const r = restorableSessions(snap, []);
  assert.deepStrictEqual(r.restorable.map((s) => s.name), ['ais-a', 'ais-b']);
});

ok('ripristino: tmux ha ancora sessioni = quelle mancanti sono state uccise apposta, niente da proporre', () => {
  const snap = [S('ais-a'), S('ais-b'), S('ais-c')];
  const live = [{ name: 'ais-a' }, { name: 'ais-c' }];
  const r = restorableSessions(snap, live);
  assert.deepStrictEqual(r.restorable, []);
  assert.deepStrictEqual(r.reconciled.map((s) => s.name), ['ais-a', 'ais-c'], 'il registro va riallineato a tmux');
});

ok('ripristino: registro vuoto = niente da proporre, qualunque cosa abbia tmux', () => {
  assert.deepStrictEqual(restorableSessions([], []).restorable, []);
  assert.deepStrictEqual(restorableSessions([], [{ name: 'ais-x' }]).restorable, []);
  assert.deepStrictEqual(restorableSessions(null, undefined).restorable, []);
});

ok('piano di ripristino: con id si riprende la conversazione, stesso profilo e account', () => {
  const p = restorePlan({ name: 'ais-claude-1', type: 'claude', cwd: '/p', resumeId: 'uuid-1', profileId: 'claude:lavoro', accountId: 'acc_1', label: 'Fix login' });
  assert.deepStrictEqual(p, { type: 'claude', cwd: '/p', commandProfileId: 'claude:lavoro', claudeAccountId: 'acc_1', name: 'Fix login', previousSession: 'ais-claude-1', resumeId: 'uuid-1', mode: 'resume' });
});

ok('piano di ripristino: senza id si riparte pulita nella stessa directory', () => {
  const p = restorePlan({ name: 'ais-codex-1', type: 'codex', cwd: '/p' });
  assert.strictEqual(p.mode, 'fresh');
  assert.strictEqual(p.resumeId, null);
  assert.strictEqual(p.cwd, '/p');
});

ok('piano di ripristino: una shell e sempre pulita, anche se per errore ha un id', () => {
  const p = restorePlan({ name: 'ais-shell-1', type: 'shell', cwd: '/p', resumeId: 'boh', iconKey: 'docker', iconMode: 'manual' });
  assert.strictEqual(p.mode, 'fresh');
  assert.strictEqual(p.resumeId, null);
  assert.strictEqual(p.iconKey, 'docker');
  assert.strictEqual(p.iconMode, 'manual');
});

ok('piano di ripristino: una voce senza tipo diventa una shell, non un crash', () => {
  assert.strictEqual(restorePlan({ name: 'ais-x' }).type, 'shell');
});

ok('piano di ripristino: porta con se il vecchio nome tmux, anche per una shell', () => {
  // La sessione ricreata ha un nome tmux nuovo: il vecchio serve a ritrovarne
  // il posto nella sidebar (ordine salvato, renderer/session-order.js).
  assert.strictEqual(restorePlan({ name: 'ais-shell-1', type: 'shell', cwd: '/p' }).previousSession, 'ais-shell-1');
  assert.strictEqual(restorePlan({ name: '' }).previousSession, null);
});
