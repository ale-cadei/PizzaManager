const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');

const { computeRecentDirs, normalizeDir } = require('../lib/recent-dirs');

ok('recenti: deduplica mantenendo l ordine di recenza e conta gli usi', () => {
  const history = [
    { cwd: '/a/uno', type: 'claude', lastOpened: '2026-01-03T10:00:00Z' },
    { cwd: '/b/due', type: 'shell', lastOpened: '2026-01-02T10:00:00Z' },
    { cwd: '/a/uno', type: 'shell', lastOpened: '2026-01-01T10:00:00Z' },
  ];
  const r = computeRecentDirs(history, { exists: () => true });
  assert.deepStrictEqual(r.map(d => d.path), ['/a/uno', '/b/due']);
  assert.strictEqual(r[0].uses, 2);
  assert.strictEqual(r[0].type, 'claude', 'deve vincere la voce piu recente');
});

ok('recenti: scarta le directory non piu esistenti', () => {
  const history = [{ cwd: '/esiste' }, { cwd: '/spazzata' }];
  const r = computeRecentDirs(history, { exists: (p) => p === '/esiste' });
  assert.deepStrictEqual(r.map(d => d.path), ['/esiste']);
});

ok('recenti: rispetta il limite e ignora voci non valide', () => {
  const history = [
    { cwd: '   ' }, { cwd: 'relativo/path' }, { cwd: null }, {},
    { cwd: '/x/1' }, { cwd: '/x/2' }, { cwd: '/x/3' },
  ];
  const r = computeRecentDirs(history, { limit: 2, exists: () => true });
  assert.deepStrictEqual(r.map(d => d.path), ['/x/1', '/x/2']);
  assert.deepStrictEqual(computeRecentDirs(null), []);
});

ok('recenti: normalizza lo slash finale', () => {
  assert.strictEqual(normalizeDir('/home/utente/progetto/'), '/home/utente/progetto');
  assert.strictEqual(normalizeDir('/'), '/');
  assert.strictEqual(normalizeDir('progetto'), null);
});

ok('recenti: exists che lancia non fa cadere il calcolo', () => {
  const r = computeRecentDirs([{ cwd: '/boom' }, { cwd: '/ok' }], {
    exists: (p) => { if (p === '/boom') throw new Error('EACCES'); return true; },
  });
  assert.deepStrictEqual(r.map(d => d.path), ['/ok']);
});
