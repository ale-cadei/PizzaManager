const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { toMarkdown, exportFileName } = require('../lib/transcript-markdown');
const { claudeTranscript } = require('../lib/transcripts');

/* ---------- Conversazione → Markdown (lib/transcript-markdown.js) ---------- */

const fixtureDir = path.join(__dirname, 'fixtures', 'transcripts');
const ID = '3b1cafe4-0000-4000-8000-000000000001';
const base = { source: 'claude', id: ID, title: 'Prova', cwd: '/srv/app', exportedAt: '2026-09-24T16:10:00Z', timeZone: 'UTC' };
const entry = (role, text, at = '2026-09-20T10:00:00Z') => ({ role, text, at });
const sectionsOf = (md) => md.split('\n').filter((l) => l.startsWith('## '));

ok('markdown: la conversazione della fixture diventa il file atteso', () => {
  const entries = claudeTranscript(fs.readFileSync(path.join(fixtureDir, 'claude.jsonl'), 'utf8').split('\n'));
  const md = toMarkdown({ ...base, title: 'Login in timeout', entries });
  assert.strictEqual(md, fs.readFileSync(path.join(fixtureDir, 'claude-export.md'), 'utf8'));
});

ok('markdown: messaggi consecutivi dello stesso ruolo stanno in una sezione sola', () => {
  const md = toMarkdown({ ...base, entries: [
    entry('user', 'uno'), entry('user', 'due'),
    entry('assistant', 'tre'), entry('tool', 'Read'), entry('assistant', 'quattro'),
  ] });
  assert.deepStrictEqual(sectionsOf(md), ['## Tu · 10:00', '## Claude · 10:00']);
  assert.ok(md.includes('uno\n\ndue'), 'i testi uniti restano paragrafi separati');
  assert.ok(md.includes('tre\n\nquattro\n\n_Strumenti:_ `Read`'), 'i tool in coda alla risposta');
});

ok('markdown: i tool si contano, nell\'ordine del primo uso', () => {
  const tools = ['Bash', 'Edit', 'Bash', 'mcp__srv__cerca', 'Bash'].map((n) => entry('tool', n));
  const md = toMarkdown({ ...base, entries: [entry('user', 'vai'), ...tools] });
  assert.ok(md.includes('_Strumenti:_ `Bash` ×3 · `Edit` · `mcp__srv__cerca`\n'), md);
  assert.deepStrictEqual(sectionsOf(md), ['## Tu · 10:00', '## Claude · 10:00'], 'una risposta fatta solo di tool ha comunque la sua sezione');
});

ok('markdown: Codex parla come «Codex» e l\'intestazione dice l\'agente', () => {
  const md = toMarkdown({ ...base, source: 'codex', entries: [entry('user', 'ciao'), entry('assistant', 'ciao a te')] });
  assert.deepStrictEqual(sectionsOf(md), ['## Tu · 10:00', '## Codex · 10:00']);
  assert.ok(md.includes('- **Agente:** Codex\n'));
});

ok('markdown: la data compare nel titolo di sezione quando cambia giorno', () => {
  const md = toMarkdown({ ...base, entries: [
    entry('user', 'sera', '2026-09-20T22:00:00Z'),
    entry('assistant', 'notte', '2026-09-20T23:59:00Z'),
    entry('user', 'mattina', '2026-09-21T08:30:00Z'),
  ] });
  assert.deepStrictEqual(sectionsOf(md), ['## Tu · 22:00', '## Claude · 23:59', '## Tu · 21/09/2026 08:30']);
  assert.ok(md.includes('- **Date:** 20/09/2026 22:00 → 21/09/2026 08:30\n'));
});

ok('markdown: gli orari seguono il fuso richiesto', () => {
  const md = toMarkdown({ ...base, timeZone: 'Europe/Rome', entries: [entry('user', 'x', '2026-09-20T10:00:00Z')] });
  assert.deepStrictEqual(sectionsOf(md), ['## Tu · 12:00']);
});

ok('markdown: un blocco di codice lasciato aperto si chiude prima della sezione dopo', () => {
  const md = toMarkdown({ ...base, entries: [entry('assistant', 'Ecco:\n```js\nconst a = 1;'), entry('user', 'grazie')] });
  assert.ok(md.includes('const a = 1;\n```\n\n## Tu'), md);
  const closed = toMarkdown({ ...base, entries: [entry('assistant', '```\nok\n```')] });
  assert.strictEqual((closed.match(/```/g) || []).length, 2, 'un blocco già chiuso non si tocca');
});

ok('markdown: i blocchi si seguono come in CommonMark, stesso carattere e lunghezza', () => {
  const four = toMarkdown({ ...base, entries: [entry('assistant', '````md\n```js\nx'), entry('user', 'dopo')] });
  assert.ok(four.includes('```js\nx\n````\n\n## Tu'), 'un blocco di quattro backtick si chiude con quattro');
  const tilde = toMarkdown({ ...base, entries: [entry('assistant', '~~~\n```\n~~~'), entry('user', 'dopo')] });
  assert.ok(tilde.includes('~~~\n```\n~~~\n\n## Tu'), 'un ``` dentro un blocco ~~~ è testo, non una chiusura');
  const openTilde = toMarkdown({ ...base, entries: [entry('assistant', '~~~\ntesto'), entry('user', 'dopo')] });
  assert.ok(openTilde.includes('testo\n~~~\n\n## Tu'), openTilde);
});

ok('markdown: senza cwd né date le righe dell\'intestazione mancano, non restano vuote', () => {
  const md = toMarkdown({ ...base, cwd: '', entries: [entry('user', 'x', null)] });
  assert.ok(!md.includes('Progetto'));
  assert.ok(!md.includes('**Date:**'));
  assert.deepStrictEqual(sectionsOf(md), ['## Tu']);
});

ok('markdown: il titolo sta su una riga sola', () => {
  const md = toMarkdown({ ...base, title: 'riga uno\nriga  due', entries: [entry('user', 'x')] });
  assert.ok(md.startsWith('# riga uno riga due\n'));
});

/* ---------- Nome del file ---------- */

ok('nome file: data della conversazione e titolo senza accenti né simboli', () => {
  const name = exportFileName({ title: 'Perché il login è lento?', id: ID, date: '2026-09-20T10:00:00Z', timeZone: 'UTC' });
  assert.strictEqual(name, '2026-09-20-perche-il-login-e-lento.md');
});

ok('nome file: la data è quella del fuso dell\'utente', () => {
  const name = exportFileName({ title: 'x', id: ID, date: '2026-09-20T23:30:00Z', timeZone: 'Europe/Rome' });
  assert.strictEqual(name, '2026-09-21-x.md');
});

ok('nome file: niente caratteri vietati su Windows, niente percorsi', () => {
  const name = exportFileName({ title: '../a<b>:c"d/e\\f|g?h*', id: ID, date: '2026-09-20T10:00:00Z', timeZone: 'UTC' });
  assert.match(name, /^2026-09-20-[a-z0-9-]+\.md$/);
});

ok('nome file: titolo vuoto → id abbreviato; titolo lungo → tagliato senza trattino in coda', () => {
  assert.strictEqual(exportFileName({ title: '  ?! ', id: ID, date: '2026-09-20T10:00:00Z', timeZone: 'UTC' }), '2026-09-20-3b1cafe4.md');
  const long = exportFileName({ title: 'parola '.repeat(30), id: ID, date: '2026-09-20T10:00:00Z', timeZone: 'UTC' });
  const slug = long.slice('2026-09-20-'.length, -'.md'.length);
  assert.ok(slug.length <= 60 && !slug.endsWith('-'), slug);
});

ok('nome file: senza una data valida, solo il titolo', () => {
  assert.strictEqual(exportFileName({ title: 'x', id: ID, date: null, timeZone: 'UTC' }), 'x.md');
});
