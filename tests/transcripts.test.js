const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { claudeMessages, codexMessages, claudeMessage, parseRecord } = require('../lib/transcripts');

/* ---------- Messaggi di una conversazione (lib/transcripts.js) ---------- */

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'transcripts', name), 'utf8').split('\n');
const brief = (msgs) => msgs.map((m) => [m.role, m.text]);

ok('transcripts claude: solo prompt e risposte, senza tool, ragionamenti, meta e blocchi iniettati', () => {
  const msgs = claudeMessages(fixture('claude.jsonl'));
  assert.deepStrictEqual(brief(msgs), [
    ['user', 'Perché il login va in timeout?\nSuccede solo in produzione.'],
    ['assistant', 'Guardo la configurazione del pool.'],
    ['user', 'Ok, allora alza il timeout a 30 s.'],
    ['assistant', 'Fatto: timeout a 30 s.'],
  ]);
  assert.strictEqual(msgs[0].at, '2026-09-20T10:00:01Z', 'la data viene dalla riga');
});

ok('transcripts claude: nessun messaggio contiene la parola che sta solo in tool, thinking e reminder', () => {
  const all = claudeMessages(fixture('claude.jsonl')).map((m) => m.text).join('\n');
  assert.ok(!/worktree/i.test(all), 'worktree compare solo fuori dai messaggi');
});

ok('transcripts claude: i sotto-agenti e le righe senza data non rompono nulla', () => {
  const sub = { isSidechain: true, message: { role: 'user', content: 'prompt del sotto-agente' } };
  assert.strictEqual(claudeMessage(sub), null);
  const noDate = claudeMessage({ message: { role: 'assistant', content: 'ciao' } });
  assert.deepStrictEqual(noDate, { role: 'assistant', text: 'ciao', at: null });
  assert.strictEqual(claudeMessage(null), null);
});

ok('transcripts codex: user_message e agent_message, non i response_item né gli output dei tool', () => {
  assert.deepStrictEqual(brief(codexMessages(fixture('codex.jsonl'))), [
    ['user', 'Rinomina la funzione di login'],
    ['assistant', 'Rinominata in `signIn`.'],
  ]);
});

ok('transcripts: parseRecord scarta righe vuote, non JSON e troncate', () => {
  assert.strictEqual(parseRecord(''), null);
  assert.strictEqual(parseRecord('non json'), null);
  assert.strictEqual(parseRecord('{"a":'), null);
  assert.deepStrictEqual(parseRecord('  {"a":1}  '), { a: 1 });
});

/* ---------- Conversazione per l'export: messaggi e tool (piano 23) ---------- */

const { claudeTranscript, codexTranscript } = require('../lib/transcripts');
const roles = (entries) => entries.map((e) => [e.role, e.text]);

ok('transcript claude: i messaggi e, al loro posto, i nomi dei tool (senza argomenti)', () => {
  const entries = claudeTranscript(fixture('claude.jsonl'));
  assert.deepStrictEqual(roles(entries), [
    ['user', 'Perché il login va in timeout?\nSuccede solo in produzione.'],
    ['assistant', 'Guardo la configurazione del pool.'],
    ['tool', 'Bash'],
    ['user', 'Ok, allora alza il timeout a 30 s.'],
    ['assistant', 'Fatto: timeout a 30 s.'],
  ]);
  assert.strictEqual(entries[2].at, '2026-09-20T10:00:02Z');
  assert.ok(!JSON.stringify(entries).includes('git worktree list'), 'gli argomenti dei tool non escono');
});

ok('transcript claude: i tool dei sotto-agenti non contano', () => {
  const sub = JSON.stringify({ isSidechain: true, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } });
  assert.deepStrictEqual(claudeTranscript([sub]), []);
});

ok('transcript codex: function_call, custom_tool_call e web_search, non gli output', () => {
  assert.deepStrictEqual(roles(codexTranscript(fixture('codex.jsonl'))), [
    ['user', 'Rinomina la funzione di login'],
    ['tool', 'exec_command'],
    ['tool', 'apply_patch'],
    ['tool', 'web_search'],
    ['assistant', 'Rinominata in `signIn`.'],
  ]);
});

ok('transcripts: la ricerca non vede i tool', () => {
  assert.ok(codexMessages(fixture('codex.jsonl')).every((m) => m.role !== 'tool'));
  assert.ok(claudeMessages(fixture('claude.jsonl')).every((m) => m.role !== 'tool'));
});
