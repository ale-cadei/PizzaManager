const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { buildExport, readConversation } = require('../lib/transcript-export');

/* ---------- Trovare e leggere una conversazione da esportare (lib/transcript-export.js) ---------- */

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-export-'));
  try { return await fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

const write = (file, records) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
};

const CLAUDE_ID = '3b1cafe4-0000-4000-8000-000000000001';
const CODEX_ID = '019fd68e-ab19-7000-8a15-b70db8234c0f';
const at = (s) => `2026-09-20T10:00:0${s}Z`;

function claudeSession(home, id, records) {
  return write(path.join(home, '.claude', 'projects', '-srv-app', id + '.jsonl'), records);
}

function codexSession(home, id, records) {
  const file = path.join(home, '.codex', 'sessions', '2026', '09', '20', `rollout-2026-09-20T10-00-00-${id}.jsonl`);
  return write(file, [{ type: 'session_meta', timestamp: at(0), payload: { id, cwd: '/srv/codex' } }, ...records]);
}

const claudeChat = [
  { type: 'user', timestamp: at(1), cwd: '/srv/app', message: { role: 'user', content: 'Perché il login è lento?' } },
  { type: 'assistant', timestamp: at(2), message: { role: 'assistant', content: [{ type: 'text', text: 'Guardo.' }, { type: 'tool_use', name: 'Bash', input: { command: 'TOKEN=segreto curl x' } }] } },
];

ok('export claude: trova il file dall\'id, titolo e cwd dal lettore, messaggi e tool', () => withHome(async (home) => {
  claudeSession(home, CLAUDE_ID, claudeChat);
  const r = await readConversation({ source: 'claude', id: CLAUDE_ID }, { home });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.title, 'Perché il login è lento?');
  assert.strictEqual(r.cwd, '/srv/app');
  assert.deepStrictEqual(r.entries.map((e) => e.role), ['user', 'assistant', 'tool']);
}));

ok('export codex: titolo dall\'indice di Codex, cwd dal session_meta', () => withHome(async (home) => {
  codexSession(home, CODEX_ID, [
    { type: 'event_msg', timestamp: at(1), payload: { type: 'user_message', message: 'rinomina il login' } },
    { type: 'response_item', timestamp: at(2), payload: { type: 'function_call', name: 'exec_command', arguments: '{}' } },
    { type: 'event_msg', timestamp: at(3), payload: { type: 'agent_message', message: 'Fatto.' } },
  ]);
  fs.writeFileSync(path.join(home, '.codex', 'session_index.jsonl'), JSON.stringify({ id: CODEX_ID, thread_name: 'Login rinominato' }) + '\n');
  const r = await readConversation({ source: 'codex', id: CODEX_ID }, { home });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.title, 'Login rinominato');
  assert.strictEqual(r.cwd, '/srv/codex');
  assert.deepStrictEqual(r.entries.map((e) => e.role), ['user', 'tool', 'assistant']);
}));

ok('export: fonte non ammessa, id non valido o con un percorso dentro → errore, nessun file letto', () => withHome(async (home) => {
  claudeSession(home, CLAUDE_ID, claudeChat);
  const bad = [
    { source: 'opencode', id: CLAUDE_ID },
    { source: 'claude', id: '../../etc/passwd' },
    { source: 'claude', id: `../-srv-app/${CLAUDE_ID}` },
    { source: 'claude', id: 42 },
    { source: 'claude' },
    null,
  ];
  for (const req of bad) {
    const r = await readConversation(req, { home });
    assert.strictEqual(r.ok, false, JSON.stringify(req));
    assert.ok(r.error);
  }
}));

ok('export: id valido ma sconosciuto → «non trovata»', () => withHome(async (home) => {
  const r = await readConversation({ source: 'claude', id: CLAUDE_ID }, { home });
  assert.deepStrictEqual([r.ok, /non trovata/i.test(r.error)], [false, true]);
  const c = await readConversation({ source: 'codex', id: CODEX_ID }, { home });
  assert.deepStrictEqual([c.ok, /non trovata/i.test(c.error)], [false, true]);
}));

ok('export: una conversazione senza messaggi non produce un file con la sola intestazione', () => withHome(async (home) => {
  claudeSession(home, CLAUDE_ID, [{ type: 'mode', sessionId: 'x' }]);
  const r = await readConversation({ source: 'claude', id: CLAUDE_ID }, { home });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /niente da esportare/i);
}));

ok('export: buildExport dà il Markdown e il nome proposto, senza gli argomenti dei tool', () => withHome(async (home) => {
  claudeSession(home, CLAUDE_ID, claudeChat);
  const r = await buildExport({ source: 'claude', id: CLAUDE_ID }, { home, timeZone: 'UTC', exportedAt: '2026-09-24T16:10:00Z' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.fileName, '2026-09-20-perche-il-login-e-lento.md');
  assert.ok(r.markdown.startsWith('# Perché il login è lento?\n'));
  assert.ok(r.markdown.includes('_Strumenti:_ `Bash`'));
  assert.ok(!r.markdown.includes('segreto'), 'gli argomenti dei tool non finiscono nel file');
}));
