const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("node:assert");
const { test: ok } = require("node:test");
const { readRendererApp } = require("./renderer-source");

/* ---------- Sessioni Claude: titolo dalla conversazione ---------- */

/** fs.rmSync non esiste prima di Node 14: qui serve funzionare anche lì. */
function removeDir(dir) {
  try {
    if (typeof fs.rmSync === 'function') fs.rmSync(dir, { recursive: true, force: true });
    else fs.rmdirSync(dir, { recursive: true });
  } catch {}
}

function withClaudeFixture(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-claude-'));
  try {
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    return fn(home);
  } finally {
    removeDir(home);
  }
}

/** Scrive una conversazione .jsonl come la scrive Claude Code. */
function writeClaudeSession(home, project, id, records) {
  const dir = path.join(home, '.claude', 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

ok('claude resume: il titolo esce dal prompt anche quando content è una stringa', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    writeClaudeSession(home, '-home-tester-progetto', 'aaa', [
      { type: 'mode', mode: 'normal' },
      { type: 'user', cwd: '/home/tester/progetto', message: { role: 'user', content: 'sistema il login rotto' } },
    ]);
    const r = claude.listClaudeSessions(10, { home });
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(r.sessions.length, 1);
    assert.strictEqual(r.sessions[0].title, 'sistema il login rotto');
    assert.strictEqual(r.sessions[0].cwd, '/home/tester/progetto');
    assert.strictEqual(r.sessions[0].id, 'aaa');
  });
});

ok('claude resume: il contesto iniettato dall IDE non diventa il titolo', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    writeClaudeSession(home, '-home-tester-progetto', 'bbb', [
      {
        type: 'user',
        cwd: '/home/tester/progetto',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '<ide_opened_file>The user opened the file x.py in the IDE.</ide_opened_file>' },
            { type: 'text', text: 'aggiungi i test mancanti' },
          ],
        },
      },
    ]);
    const r = claude.listClaudeSessions(10, { home });
    assert.strictEqual(r.sessions[0].title, 'aggiungi i test mancanti');
  });
});

ok('claude resume: i tool_result e i messaggi meta non sono titoli', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    writeClaudeSession(home, '-home-tester-progetto', 'ccc', [
      { type: 'user', isMeta: true, cwd: '/home/tester/progetto', message: { role: 'user', content: 'Caveat: messaggio di sistema' } },
      { type: 'user', cwd: '/home/tester/progetto', message: { role: 'user', content: [{ type: 'tool_result', content: 'output del tool' }] } },
      { type: 'user', cwd: '/home/tester/progetto', message: { role: 'user', content: 'il prompt vero' } },
    ]);
    const r = claude.listClaudeSessions(10, { home });
    assert.strictEqual(r.sessions[0].title, 'il prompt vero');
  });
});

ok('claude resume: aiTitle vince sul primo prompt, anche in coda al file', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    const filler = Array.from({ length: 40 }, (_, i) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(2000) + i }] } }));
    writeClaudeSession(home, '-home-tester-progetto', 'ddd', [
      { type: 'user', cwd: '/home/tester/progetto', message: { role: 'user', content: 'primo prompt' } },
      ...filler,
      { type: 'ai-title', aiTitle: 'Titolo scelto da Claude' },
    ]);
    const r = claude.listClaudeSessions(10, { home });
    assert.strictEqual(r.sessions[0].title, 'Titolo scelto da Claude');
  });
});

ok('claude resume: senza prompt utile resta un titolo leggibile, mai vuoto', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    writeClaudeSession(home, '-home-tester-progetto', 'eee12345-0000', [
      { type: 'mode', mode: 'normal' },
    ]);
    const r = claude.listClaudeSessions(10, { home, platform: 'linux' });
    assert.ok(r.sessions[0].title, 'titolo vuoto');
    assert.strictEqual(r.sessions[0].cwd, '/home/tester/progetto');
    // Claude crea il file all'avvio: finché non c'è un prompt il titolo è finto
    assert.strictEqual(r.sessions[0].titled, false, 'un titolo di ripiego risulta vero');
  });
});

ok('nomi: la scheda non prende l id come nome finché manca il prompt', () => {
  const js = readRendererApp();
  assert.ok(/s\.titled === false/.test(js),
    'il renderer applica anche i titoli di ripiego');
});

ok('claude resume: ordina dalla più recente e rispetta il limite', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    for (const id of ['uno', 'due', 'tre']) {
      writeClaudeSession(home, '-home-tester-progetto', id, [
        { type: 'user', cwd: '/home/tester/progetto', message: { role: 'user', content: 'prompt ' + id } },
      ]);
    }
    const base = path.join(home, '.claude', 'projects', '-home-tester-progetto');
    fs.utimesSync(path.join(base, 'uno.jsonl'), new Date(1000), new Date(1000));
    fs.utimesSync(path.join(base, 'due.jsonl'), new Date(3000), new Date(3000));
    fs.utimesSync(path.join(base, 'tre.jsonl'), new Date(2000), new Date(2000));
    const r = claude.listClaudeSessions(2, { home });
    assert.deepStrictEqual(r.sessions.map((s) => s.id), ['due', 'tre']);
  });
});

ok('claude resume: senza directory delle conversazioni risponde con un errore leggibile', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    removeDir(path.join(home, '.claude', 'projects'));
    const r = claude.listClaudeSessions(10, { home });
    assert.strictEqual(r.ok, false);
    assert.ok(/non trovata/i.test(r.error || ''), 'errore poco chiaro: ' + r.error);
    assert.deepStrictEqual(r.sessions, []);
  });
});

ok('claude: claudeSessionFiles elenca un file per conversazione con il suo progetto', () => {
  const claude = require('../lib/claude-sessions');
  withClaudeFixture((home) => {
    writeClaudeSession(home, '-home-tester-a', 'uno', [{ type: 'mode' }]);
    writeClaudeSession(home, '-home-tester-b', 'due', [{ type: 'mode' }]);
    fs.writeFileSync(path.join(home, '.claude', 'projects', '-home-tester-a', 'note.txt'), 'non è una conversazione');
    const r = claude.claudeSessionFiles(claude.projectsDir(home));
    assert.strictEqual(r.skipped, 0);
    assert.deepStrictEqual(r.files.map((f) => [f.projectDir, f.id]).sort(), [['-home-tester-a', 'uno'], ['-home-tester-b', 'due']]);
    assert.ok(r.files.every((f) => fs.existsSync(f.file)), 'i percorsi devono essere quelli veri');
  });
});

ok('claude: userMessageText toglie i blocchi iniettati ma tiene gli a capo; userPromptText li appiattisce', () => {
  const { userMessageText, userPromptText } = require('../lib/claude-sessions');
  const line = { type: 'user', message: { role: 'user', content: '<system-reminder>ignora</system-reminder>prima riga\nseconda riga' } };
  assert.strictEqual(userMessageText(line), 'prima riga\nseconda riga');
  assert.strictEqual(userPromptText(line), 'prima riga seconda riga');
  assert.strictEqual(userMessageText({ ...line, isMeta: true }), null);
  assert.strictEqual(userMessageText({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] } }), null);
});
