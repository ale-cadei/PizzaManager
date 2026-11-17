const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { listCopilotSessions, parseWorkspaceYaml } = require('../lib/copilot-sessions');

/* Resume Copilot: una cartella per sessione in ~/.copilot/session-state/<id>/
   con workspace.yaml (metadati) ed events.jsonl (eventi, uno per riga). */
function withCopilotHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-copilot-'));
  try {
    fs.mkdirSync(path.join(home, 'session-state'), { recursive: true });
    return fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function writeSession(home, id, { yaml = null, events = [] } = {}) {
  const dir = path.join(home, 'session-state', id);
  fs.mkdirSync(dir, { recursive: true });
  if (yaml !== null) fs.writeFileSync(path.join(dir, 'workspace.yaml'), yaml);
  if (events.length) fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

const start = (cwd, ts = '2026-11-10T10:00:00Z') => ({ type: 'session.start', timestamp: ts, data: { sessionId: 'x', context: { cwd, branch: 'main' } } });
const userMsg = (content) => ({ type: 'user.message', timestamp: '2026-11-10T10:00:01Z', data: { content } });

ok('parseWorkspaceYaml: chiavi di primo livello, virgolette tolte, il resto ignorato', () => {
  const y = [
    'id: 11111111-aaaa',
    'name: "Fix login: bug"',
    "summary: 'Riassunto'",
    'user_named: true',
    'nested:',
    '  child: ignorato',
    '# commento',
    'created_at: 2026-11-10T10:00:00.000Z',
  ].join('\n');
  assert.deepStrictEqual(parseWorkspaceYaml(y), {
    id: '11111111-aaaa', name: 'Fix login: bug', summary: 'Riassunto', user_named: 'true', nested: '',
    created_at: '2026-11-10T10:00:00.000Z',
  });
  assert.deepStrictEqual(parseWorkspaceYaml(''), {});
  assert.deepStrictEqual(parseWorkspaceYaml(null), {});
});

ok('copilot resume: titolo dal name, cwd e data dallo yaml', () => {
  withCopilotHome((home) => {
    writeSession(home, 'aaa', {
      yaml: 'id: aaa\nname: Fix Login Bug\ncwd: /home/u/progetto\ncreated_at: 2026-11-10T10:00:00Z\nupdated_at: 2026-11-12T08:00:00Z\n',
      events: [start('/altro'), userMsg('ciao')],
    });
    const r = listCopilotSessions(10, { home });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.sessions, [{ id: 'aaa', title: 'Fix Login Bug', cwd: '/home/u/progetto', mtime: Date.parse('2026-11-12T08:00:00Z') }]);
  });
});

ok('copilot resume: senza name usa summary, poi il primo messaggio; cwd dal session.start', () => {
  withCopilotHome((home) => {
    writeSession(home, 'bbb', { yaml: 'id: bbb\nsummary: Riassunto della sessione\n', events: [start('/p/b'), userMsg('primo')] });
    writeSession(home, 'ccc', { yaml: 'id: ccc\nsummary_count: 0\n', events: [start('/p/c'), userMsg('  scrivi\n i   test  '), userMsg('secondo')] });
    const byId = Object.fromEntries(listCopilotSessions(10, { home }).sessions.map((s) => [s.id, s]));
    assert.strictEqual(byId.bbb.title, 'Riassunto della sessione');
    assert.strictEqual(byId.bbb.cwd, '/p/b');
    assert.strictEqual(byId.ccc.title, 'scrivi i test');
    assert.strictEqual(byId.ccc.cwd, '/p/c');
  });
});

ok('copilot resume: senza yaml né messaggi il titolo è l\'inizio dell\'id', () => {
  withCopilotHome((home) => {
    writeSession(home, '12345678-90ab-cdef', { events: [start('/p')] });
    const [s] = listCopilotSessions(10, { home }).sessions;
    assert.strictEqual(s.title, '12345678');
    assert.strictEqual(s.cwd, '/p');
    assert.ok(s.mtime > 0, 'senza date nello yaml vale la data del file');
  });
});

ok('copilot resume: le righe rotte di events.jsonl non fermano la lettura', () => {
  withCopilotHome((home) => {
    const dir = writeSession(home, 'ddd', { yaml: 'id: ddd\n' });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '{rotta\n' + JSON.stringify(start('/p/d')) + '\n' + JSON.stringify(userMsg('ok')) + '\n');
    const [s] = listCopilotSessions(10, { home }).sessions;
    assert.strictEqual(s.cwd, '/p/d');
    assert.strictEqual(s.title, 'ok');
  });
});

ok('copilot resume: anche il vecchio formato piatto <id>.jsonl', () => {
  withCopilotHome((home) => {
    fs.writeFileSync(path.join(home, 'session-state', 'eee.jsonl'), [start('/p/e'), userMsg('vecchio')].map((e) => JSON.stringify(e)).join('\n'));
    const [s] = listCopilotSessions(10, { home }).sessions;
    assert.deepStrictEqual({ id: s.id, title: s.title, cwd: s.cwd }, { id: 'eee', title: 'vecchio', cwd: '/p/e' });
  });
});

ok('copilot resume: dalla più recente, e il limite vale', () => {
  withCopilotHome((home) => {
    writeSession(home, 'vecchia', { yaml: 'updated_at: 2026-01-01T00:00:00Z\n' });
    writeSession(home, 'nuova', { yaml: 'updated_at: 2026-11-01T00:00:00Z\n' });
    writeSession(home, 'media', { yaml: 'updated_at: 2026-06-01T00:00:00Z\n' });
    assert.deepStrictEqual(listCopilotSessions(2, { home }).sessions.map((s) => s.id), ['nuova', 'media']);
  });
});

ok('copilot resume: titolo lungo accorciato', () => {
  withCopilotHome((home) => {
    writeSession(home, 'fff', { yaml: `name: ${'x'.repeat(200)}\n` });
    assert.strictEqual(listCopilotSessions(10, { home }).sessions[0].title.length, 80);
  });
});

ok('copilot resume: cartella assente → ok false con messaggio, lista vuota', () => {
  const home = path.join(os.tmpdir(), 'aisess-copilot-assente-' + process.pid);
  const r = listCopilotSessions(10, { home });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('copilot'));
  assert.deepStrictEqual(r.sessions, []);
});

ok('copilot resume: COPILOT_HOME sostituisce ~/.copilot', () => {
  const { copilotHome } = require('../lib/copilot-sessions');
  assert.strictEqual(copilotHome({ COPILOT_HOME: '/x/y' }, '/home/u'), '/x/y');
  assert.strictEqual(copilotHome({}, '/home/u'), path.join('/home/u', '.copilot'));
});

/* Copilot 1.0.112 tiene i lock in session-state/.session-operation-locks/:
   una cartella che non è una sessione (trovata nello smoke test). */
ok('copilot resume: le cartelle nascoste di session-state non sono sessioni', () => {
  withCopilotHome((home) => {
    writeSession(home, 'ggg', { yaml: 'id: ggg\nname: vera\n' });
    fs.mkdirSync(path.join(home, 'session-state', '.session-operation-locks'));
    fs.writeFileSync(path.join(home, 'session-state', '.session-operation-locks', 'ggg.lock'), '');
    fs.writeFileSync(path.join(home, 'session-state', '.nascosto.jsonl'), '');
    assert.deepStrictEqual(listCopilotSessions(10, { home }).sessions.map((s) => s.id), ['ggg']);
  });
});
