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

/* agy 1.5 salva le conversazioni come conversations/<id>.db (SQLite) e scrive
   la cache dei metadati solo a fine sessione: finche' la sessione e' aperta la
   conversazione non aveva cartella, la scheda non la riconosceva e al
   riavvio ripartiva vuota. Cartella e ora arrivano da history.jsonl, una riga
   per prompt: il primo prompt e' senza conversationId (la conversazione nasce
   in quell'istante, ed e' la data di creazione del .db), i successivi lo hanno. */
function writeAgyHistory(home, rows) {
  fs.writeFileSync(path.join(home, 'history.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

ok('antigravity resume: le conversazioni .db (agy 1.5) compaiono anche senza cache', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    fs.writeFileSync(path.join(home, 'conversations', 'nuova.db'), 'SQLite format 3');
    const r = agy.listAntigravitySessions(10, { home });
    assert.deepStrictEqual(r.sessions.map((s) => s.id), ['nuova']);
  });
});

ok('antigravity resume: cartella e ora di una conversazione aperta vengono da history.jsonl', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    fs.writeFileSync(path.join(home, 'conversations', 'aperta.db'), 'SQLite format 3');
    writeAgyHistory(home, [
      { display: 'primo', timestamp: 1000, workspace: '/altrove' },
      { display: 'secondo', timestamp: 9_000_000_000_000, workspace: '/repo/x', conversationId: 'aperta' },
      { display: '/model', timestamp: 9_000_000_000_100, workspace: '/repo/x', conversationId: 'aperta', type: 'slash_command' },
    ]);
    const [s] = agy.listAntigravitySessions(10, { home }).sessions;
    assert.strictEqual(s.cwd, '/repo/x');
    assert.strictEqual(s.mtime, 9_000_000_000_100, 'l ultima riga della conversazione, comandi compresi');
  });
});

ok('antigravity resume: dopo un solo prompt la cartella si abbina dalla nascita del .db', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    const file = path.join(home, 'conversations', 'neonata.db');
    fs.writeFileSync(file, 'SQLite format 3');
    const born = fs.statSync(file).birthtimeMs;
    if (!born) return; // filesystem senza data di nascita: resta il caso con l'id
    writeAgyHistory(home, [
      { display: 'di un altra', timestamp: born - 60_000, workspace: '/altrove' },
      { display: 'spiegami la join', timestamp: Math.round(born), workspace: '/repo/rust' },
    ]);
    const [s] = agy.listAntigravitySessions(10, { home }).sessions;
    assert.strictEqual(s.cwd, '/repo/rust');
    assert.strictEqual(s.title, 'spiegami la join');
  });
});

ok('antigravity resume: una history.jsonl rotta non rompe la lista', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    fs.writeFileSync(path.join(home, 'conversations', 'c.db'), 'x');
    fs.writeFileSync(path.join(home, 'history.jsonl'), '{rotta\n{"timestamp":"no","conversationId":5}\n');
    const r = agy.listAntigravitySessions(10, { home });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.sessions.map((s) => [s.id, s.cwd]), [['c', '']]);
  });
});

ok('antigravity resume: la history aggiorna l ora anche delle conversazioni gia in cache', () => {
  const agy = require('../lib/antigravity-sessions');
  withAntigravityFixture((home) => {
    writeAgyMetadata(home, { vecchia: { last_modified_time: '2026-01-01T00:00:00Z', summary: { Title: 'T', WorkspaceURIs: ['file:///repo/v'] } } });
    writeAgyHistory(home, [{ display: 'ripresa', timestamp: Date.parse('2026-06-01T00:00:00Z'), workspace: '/repo/v', conversationId: 'vecchia' }]);
    const [s] = agy.listAntigravitySessions(10, { home }).sessions;
    assert.strictEqual(s.mtime, Date.parse('2026-06-01T00:00:00Z'));
    assert.strictEqual(s.title, 'T', 'il titolo della cache resta');
  });
});
