const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert");
const { test: ok } = require("node:test");

const { eventsFromLines, collectClaudeUsage, clearCache } = require('../lib/usage/claude-usage');

/* ---------- Uso di Claude Code: dai .jsonl agli eventi ---------- */

function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function assistantLine(over = {}) {
  const { usage, ...rest } = over;
  return {
    type: 'assistant',
    timestamp: '2026-09-21T07:33:20.262Z',
    sessionId: 'sess-1',
    requestId: 'req_1',
    cwd: '/home/tester/progetto',
    message: {
      id: 'msg_1',
      role: 'assistant',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
        ...(usage || {}),
      },
    },
    ...rest,
  };
}

function lines(records) {
  return records.map((r) => JSON.stringify(r));
}

ok('claude usage: una risposta diventa un evento con token e modello', () => {
  const [e, ...rest] = eventsFromLines(lines([assistantLine()]));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(e.source, 'claude');
  assert.strictEqual(e.input, 10);
  assert.strictEqual(e.output, 20);
  assert.strictEqual(e.cacheWrite, 30);
  assert.strictEqual(e.cacheRead, 40);
  assert.strictEqual(e.model, 'claude-opus-5');
  assert.strictEqual(e.sessionId, 'sess-1');
  assert.strictEqual(e.cwd, '/home/tester/progetto');
  assert.strictEqual(e.ts, Date.parse('2026-09-21T07:33:20.262Z'));
});

ok('claude usage: le righe che non sono risposte non producono eventi', () => {
  const out = eventsFromLines(lines([
    { type: 'user', message: { role: 'user', content: 'ciao' } },
    { type: 'summary', summary: 'qualcosa' },
    { type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5' } }, // senza usage
  ]).concat(['riga troncata a me', '']));
  assert.deepStrictEqual(out, []);
});

ok('claude usage: la stessa risposta contata due volte vale una', () => {
  // Succede davvero: resume e sidechain ricopiano le righe in un altro file.
  const out = eventsFromLines(lines([assistantLine(), assistantLine()]));
  assert.strictEqual(out.length, 1);
});

ok('claude usage: due richieste distinte restano due eventi', () => {
  const out = eventsFromLines(lines([assistantLine(), assistantLine({ requestId: 'req_2' })]));
  assert.strictEqual(out.length, 2);
});

ok('claude usage: modello sconosciuto -> token comunque contati', () => {
  const [e] = eventsFromLines(lines([assistantLine({ message: { id: 'm', model: 'modello-ignoto', usage: { input_tokens: 5, output_tokens: 1 } } })]));
  assert.strictEqual(e.input, 5);
});

ok('claude usage: legge tutti i progetti sotto ~/.claude/projects', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-usage-'));
  try {
    clearCache();
    const base = path.join(home, '.claude', 'projects');
    for (const proj of ['-home-a', '-home-b']) {
      fs.mkdirSync(path.join(base, proj), { recursive: true });
      fs.writeFileSync(path.join(base, proj, 'conv.jsonl'),
        lines([assistantLine({ sessionId: proj, requestId: 'req-' + proj })]).join('\n') + '\n');
    }
    const r = collectClaudeUsage({ home });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.events.length, 2);
  } finally { removeDir(home); }
});

ok('claude usage: un file che cresce si rilegge solo nella parte nuova', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-usage-'));
  try {
    clearCache();
    const dir = path.join(home, '.claude', 'projects', '-home-a');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'conv.jsonl');
    fs.writeFileSync(file, lines([assistantLine({ requestId: 'req_1' })]).join('\n') + '\n');
    const first = collectClaudeUsage({ home });
    assert.strictEqual(first.events.length, 1);
    assert.strictEqual(first.filesRead, 1);

    fs.appendFileSync(file, lines([assistantLine({ requestId: 'req_2' })]).join('\n') + '\n');
    const second = collectClaudeUsage({ home });
    assert.strictEqual(second.events.length, 2, 'i vecchi eventi restano, il nuovo si aggiunge');
    assert.strictEqual(second.bytesRead < fs.statSync(file).size, true, 'ha riletto solo la coda');

    const third = collectClaudeUsage({ home });
    assert.strictEqual(third.events.length, 2);
    assert.strictEqual(third.bytesRead, 0, 'file immutato: non si apre nemmeno');
  } finally { removeDir(home); }
});

ok('claude usage: i file piu vecchi della finestra richiesta non si aprono', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-usage-'));
  try {
    clearCache();
    const dir = path.join(home, '.claude', 'projects', '-home-a');
    fs.mkdirSync(dir, { recursive: true });
    const vecchio = path.join(dir, 'vecchio.jsonl');
    fs.writeFileSync(vecchio, lines([assistantLine()]).join('\n') + '\n');
    const unAnnoFa = Date.now() - 365 * 24 * 60 * 60 * 1000;
    fs.utimesSync(vecchio, unAnnoFa / 1000, unAnnoFa / 1000);

    const r = collectClaudeUsage({ home, since: Date.now() - 24 * 60 * 60 * 1000 });
    assert.strictEqual(r.events.length, 0);
    assert.strictEqual(r.bytesRead, 0, 'un file fuori finestra non si legge');
    assert.strictEqual(r.filesSkipped, 1);
  } finally { removeDir(home); }
});

ok('claude usage: una directory che non esiste e un errore dichiarato, non un crash', () => {
  clearCache();
  const r = collectClaudeUsage({ home: path.join(os.tmpdir(), 'aisess-non-esiste-' + Date.now()) });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('non trovata'));
  assert.deepStrictEqual(r.events, []);
});
