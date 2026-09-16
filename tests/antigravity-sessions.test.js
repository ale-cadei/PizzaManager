const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("node:assert");
const { test: ok } = require("node:test");

/* Resume Antigravity: le conversazioni della CLI stanno in
   ~/.gemini/antigravity-cli, con i metadati in cache/conversation_metadata.json
   e il contenuto in conversations/<id>.pb. */
function withAntigravityFixture(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-agy-'));
  try {
    fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
    fs.mkdirSync(path.join(home, 'conversations'), { recursive: true });
    return fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function writeAgyMetadata(home, conversations) {
  fs.writeFileSync(path.join(home, 'cache', 'conversation_metadata.json'),
    JSON.stringify({ conversations }, null, 2));
}

ok('antigravity resume: legge id, titolo, workspace e data dai metadati', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    writeAgyMetadata(home, {
      'aaa': {
        summary: {
          ID: 'aaa', Title: '', Preview: 'Fixing SQL Table Definition', NumSteps: 25,
          UpdatedAt: '2026-05-04T10:19:04.391Z',
          WorkspaceURIs: ['file:///home/digitiamo/digitiamo/orchestrator%20big%20data'],
          Internal: false,
        },
        is_internal: false,
        last_modified_time: '2026-08-31T09:54:52.166+02:00',
      },
    });
    const r = agy.listAntigravitySessions(10, { home });
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(r.sessions.length, 1);
    const s = r.sessions[0];
    assert.strictEqual(s.id, 'aaa');
    assert.strictEqual(s.title, 'Fixing SQL Table Definition');
    // le WorkspaceURIs sono file:// con percent-encoding: vanno decodificate
    assert.strictEqual(s.cwd, '/home/digitiamo/digitiamo/orchestrator big data');
    assert.ok(s.mtime > 0, 'manca la data della conversazione');
  });
});

ok('antigravity resume: Title vince su Preview, le interne restano fuori', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    writeAgyMetadata(home, {
      titolata: { summary: { ID: 'titolata', Title: 'Titolo vero', Preview: 'anteprima' }, is_internal: false },
      interna: { summary: { ID: 'interna', Preview: 'roba di sistema', Internal: true }, is_internal: true },
    });
    const r = agy.listAntigravitySessions(10, { home });
    assert.strictEqual(r.ok, true, r.error || '');
    const ids = r.sessions.map(s => s.id);
    assert.deepStrictEqual(ids, ['titolata']);
    assert.strictEqual(r.sessions[0].title, 'Titolo vero');
  });
});

ok('antigravity resume: le conversazioni assenti dalla cache non spariscono', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    writeAgyMetadata(home, { nota: { summary: { ID: 'nota', Preview: 'in cache' } } });
    // conversazione appena creata: il .pb c'è, la cache non è ancora aggiornata
    fs.writeFileSync(path.join(home, 'conversations', 'fresca.pb'), 'x');
    const r = agy.listAntigravitySessions(10, { home });
    assert.strictEqual(r.ok, true, r.error || '');
    const ids = r.sessions.map(s => s.id).sort();
    assert.deepStrictEqual(ids, ['fresca', 'nota']);
  });
});

ok('antigravity resume: ordina dalla più recente e rispetta il limite', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    writeAgyMetadata(home, {
      vecchia: { summary: { ID: 'vecchia', Preview: 'v' }, last_modified_time: '2026-01-01T00:00:00Z' },
      media: { summary: { ID: 'media', Preview: 'm' }, last_modified_time: '2026-06-01T00:00:00Z' },
      nuova: { summary: { ID: 'nuova', Preview: 'n' }, last_modified_time: '2026-09-01T00:00:00Z' },
    });
    const all = agy.listAntigravitySessions(10, { home });
    assert.deepStrictEqual(all.sessions.map(s => s.id), ['nuova', 'media', 'vecchia']);
    const due = agy.listAntigravitySessions(2, { home });
    assert.strictEqual(due.sessions.length, 2);
  });
});

ok('antigravity resume: senza dati risponde con un errore leggibile', () => {
  const agy = require('../lib/antigravity-sessions');
  const r = agy.listAntigravitySessions(10, { home: path.join(os.tmpdir(), 'aisess-inesistente', 'antigravity-cli') });
  assert.strictEqual(r.ok, false);
  assert.ok(/antigravity-cli/.test(r.error), 'l errore non dice dove ha cercato');
  assert.deepStrictEqual(r.sessions, []);
});
