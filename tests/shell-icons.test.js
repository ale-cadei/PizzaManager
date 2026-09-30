const assert = require('node:assert/strict');
const { test } = require('node:test');
const ShellIcons = require('../renderer/shell-icons');

test('docker compose e gh pr assegnano subito il logo giusto', () => {
  for (const [command, expected] of [
    ['docker compose up -d', 'docker'],
    ['docker-compose up', 'docker'],
    ['sudo docker compose logs -f', 'docker'],
    ['gh pr create', 'github'],
    ['gh issue list', 'github'],
  ]) {
    const capture = ShellIcons.createCommandCapture();
    assert.strictEqual(capture.feed(command + '\r'), expected, command);
  }
});

test('un comando occasionale non rinomina la shell; due comandi dello stesso strumento sì', () => {
  const capture = ShellIcons.createCommandCapture();
  assert.strictEqual(capture.feed('docker ps\r'), null);
  assert.strictEqual(capture.feed('ls\r'), null);
  assert.strictEqual(capture.feed('docker ps\r'), null);
  assert.strictEqual(capture.feed('docker images\r'), 'docker');
});

test('input a pezzi, backspace e incolla sono riconosciuti, controlli del terminale ignorati', () => {
  const capture = ShellIcons.createCommandCapture();
  assert.strictEqual(capture.feed('\x1b[6n'), null);
  assert.strictEqual(capture.feed('docker composx'), null);
  assert.strictEqual(capture.feed('\x7fe up\r'), 'docker');
  const pasted = ShellIcons.createCommandCapture();
  assert.strictEqual(pasted.feed('\x1b[200~gh pr list\x1b[201~\r'), 'github');
});

test('il catalogo non accetta chiavi esterne', () => {
  assert.strictEqual(ShellIcons.normalize('docker'), 'docker');
  assert.strictEqual(ShellIcons.normalize('<img onerror=alert(1)>'), 'shell');
});
