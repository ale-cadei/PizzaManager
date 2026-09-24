const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const codex = require('../lib/codex-sessions');

/* ---------- Sessioni Codex: elenco dei rollout ---------- */

function withCodexHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-codex-'));
  try { return fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

function writeRollout(home, day, id, records) {
  const dir = path.join(codex.sessionsDir(home), ...day.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-${day.replace(/\//g, '-')}T10-00-00-${id}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

ok('codex: codexRolloutFiles trova i rollout nelle cartelle per data e ignora il resto', () => {
  withCodexHome((home) => {
    const a = writeRollout(home, '2026/09/01', 'aaa', [{ type: 'session_meta', payload: { id: 'aaa' } }]);
    const b = writeRollout(home, '2026/09/02', 'bbb', [{ type: 'session_meta', payload: { id: 'bbb' } }]);
    fs.writeFileSync(path.join(path.dirname(a), 'appunti.jsonl'), '{}');
    assert.deepStrictEqual(codex.codexRolloutFiles(codex.sessionsDir(home)).sort(), [a, b].sort());
    assert.deepStrictEqual(codex.codexRolloutFiles(path.join(home, 'non-esiste')), []);
  });
});

ok('codex: listCodexSessions legge la home che gli si passa', () => {
  withCodexHome((home) => {
    writeRollout(home, '2026/09/01', 'aaa', [
      { type: 'session_meta', payload: { id: 'aaa', cwd: '/srv/app' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rifai il login' }] } },
    ]);
    const r = codex.listCodexSessions(10, { home });
    assert.strictEqual(r.ok, true, r.error || '');
    assert.deepStrictEqual(r.sessions.map((s) => [s.id, s.title, s.cwd]), [['aaa', 'rifai il login', '/srv/app']]);
  });
});
