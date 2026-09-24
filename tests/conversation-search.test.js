const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { searchConversations, normalizeQuery, snippet, DEFAULT_LIMIT, MAX_SNIPPETS } = require('../lib/conversation-search');
const { createSearchWorker } = require('../lib/search-worker');

/* ---------- Ricerca nelle conversazioni (lib/conversation-search.js) ---------- */

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-search-'));
  const done = () => fs.rmSync(home, { recursive: true, force: true });
  let out;
  try { out = fn(home); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(done);
  done();
  return out;
}

const write = (file, records, mtime) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  if (mtime) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
};

const user = (text) => ({ type: 'user', cwd: '/srv/app', message: { role: 'user', content: text } });
const assistant = (blocks) => ({ type: 'assistant', message: { role: 'assistant', content: blocks } });

function claudeSession(home, id, records, mtime) {
  return write(path.join(home, '.claude', 'projects', '-srv-app', id + '.jsonl'), records, mtime);
}

function codexSession(home, id, records, mtime) {
  const file = path.join(home, '.codex', 'sessions', '2026', '09', '20', `rollout-2026-09-20T10-00-00-${id}.jsonl`);
  return write(file, [{ type: 'session_meta', payload: { id, cwd: '/srv/codex' } }, ...records], mtime);
}

const CODEX_ID = '019fd68e-ab19-7000-8a15-b70db8234c0f';

ok('ricerca: trova la parola nei messaggi, non negli output dei tool', () => withHome((home) => {
  claudeSession(home, 'nei-tool', [
    user('sistema i test'),
    assistant([{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'git worktree list' } }]),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'worktree /srv/app' }] } },
  ]);
  claudeSession(home, 'nel-messaggio', [user('crea un worktree per la feature'), assistant([{ type: 'text', text: 'Fatto.' }])]);
  const r = searchConversations('worktree', { home });
  assert.strictEqual(r.ok, true, r.error || '');
  assert.deepStrictEqual(r.results.map((x) => x.id), ['nel-messaggio']);
  assert.strictEqual(r.results[0].title, 'crea un worktree per la feature', 'il titolo arriva dal lettore del Resume');
  assert.strictEqual(r.results[0].cwd, '/srv/app');
  assert.strictEqual(r.results[0].source, 'claude');
}));

ok('ricerca: ignora maiuscole e accenti, in entrambe le direzioni', () => withHome((home) => {
  claudeSession(home, 'accenti', [user('PERCHÉ il login è lento?')]);
  for (const q of ['perche', 'Perché', 'PERCHE IL']) {
    const r = searchConversations(q, { home });
    assert.deepStrictEqual(r.results.map((x) => x.id), ['accenti'], `query «${q}»`);
  }
  claudeSession(home, 'senza', [user('perche senza accento')]);
  assert.strictEqual(searchConversations('perché', { home }).results.length, 2);
}));

ok('ricerca: una frase trova anche parole separate da a capo', () => withHome((home) => {
  claudeSession(home, 'a-capo', [user('il login\n  rotto da ieri')]);
  const r = searchConversations('login rotto', { home });
  assert.deepStrictEqual(r.results.map((x) => x.id), ['a-capo']);
  assert.deepStrictEqual(r.results[0].snippets[0], { role: 'user', at: null, before: 'il ', match: 'login rotto', after: ' da ieri' });
}));

ok('ricerca: Codex tramite event_msg, con id e directory dal rollout', () => withHome((home) => {
  codexSession(home, CODEX_ID, [
    { type: 'response_item', payload: { type: 'function_call_output', output: 'migrazione fallita' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'scrivi la migrazione del database' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Ecco la migrazione.' } },
  ]);
  const r = searchConversations('migrazione', { home });
  assert.strictEqual(r.results.length, 1);
  const [c] = r.results;
  assert.deepStrictEqual([c.source, c.id, c.cwd, c.hits], ['codex', CODEX_ID, '/srv/codex', 2]);
  assert.deepStrictEqual(c.snippets.map((s) => s.role), ['user', 'assistant']);
}));

ok('ricerca: dalla più recente, con Claude e Codex mescolati', () => withHome((home) => {
  claudeSession(home, 'vecchia', [user('parliamo di cache')], 1000);
  codexSession(home, CODEX_ID, [{ type: 'event_msg', payload: { type: 'user_message', message: 'la cache non scade' } }], 3000);
  claudeSession(home, 'media', [user('svuota la cache')], 2000);
  assert.deepStrictEqual(searchConversations('cache', { home }).results.map((x) => x.id), [CODEX_ID, 'media', 'vecchia']);
}));

ok('ricerca: oltre il limite taglia le più vecchie e lo dice', () => withHome((home) => {
  for (let i = 0; i < 4; i++) claudeSession(home, `s${i}`, [user('parola comune')], 1000 * (i + 1));
  const r = searchConversations('comune', { home, limit: 3 });
  assert.deepStrictEqual(r.results.map((x) => x.id), ['s3', 's2', 's1']);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(searchConversations('comune', { home, limit: 4 }).truncated, undefined);
  assert.strictEqual(DEFAULT_LIMIT, 50);
}));

ok('ricerca: al massimo tre frammenti per conversazione, ma tutte le occorrenze contate', () => withHome((home) => {
  claudeSession(home, 'tante', [1, 2, 3, 4, 5].map((n) => user(`bug numero ${n}, e ancora bug`)));
  const [r] = searchConversations('bug', { home }).results;
  assert.strictEqual(r.hits, 10);
  assert.strictEqual(r.snippets.length, MAX_SNIPPETS);
}));

ok('ricerca: query troppo corta, vuota o non stringa è un errore leggibile', () => withHome((home) => {
  for (const q of ['a', '  b  ', '', null]) {
    const r = searchConversations(q, { home });
    assert.strictEqual(r.ok, false, `query ${JSON.stringify(q)}`);
    assert.ok(r.error, 'serve un messaggio');
    assert.deepStrictEqual(r.results, []);
  }
  assert.strictEqual(searchConversations('x'.repeat(201), { home }).ok, false);
}));

ok('ricerca: senza cartelle di Claude e Codex nessun risultato, nessun errore', () => withHome((home) => {
  assert.deepStrictEqual(searchConversations('qualcosa', { home }), { ok: true, query: 'qualcosa', results: [] });
}));

ok('ricerca: si ferma quando la ricerca viene annullata', () => withHome((home) => {
  claudeSession(home, 'uno', [user('annullami')]);
  const r = searchConversations('annullami', { home, isCancelled: () => true });
  assert.deepStrictEqual(r, { ok: false, cancelled: true, results: [] });
}));

ok('ricerca: righe troncate e non JSON non fanno perdere il resto del file', () => withHome((home) => {
  claudeSession(home, 'sporca', ['non json con la parola chiave', '{"type":"user","message":{"role":"user","content":"chiave tronc', user('la chiave giusta')]);
  const [r] = searchConversations('chiave', { home }).results;
  assert.strictEqual(r.hits, 1);
}));

ok('ricerca: normalizeQuery toglie accenti e spazi in più', () => {
  assert.strictEqual(normalizeQuery('  Perché\tÈ  COSÌ '), 'perche e cosi');
  assert.strictEqual(normalizeQuery('perché'), 'perche', 'accento scomposto');
});

ok('ricerca: snippet taglia intorno al punto trovato, con i puntini solo dove taglia', () => {
  const text = 'inizio ' + 'x'.repeat(200) + ' prima TROVATO dopo ' + 'y'.repeat(200) + ' fine';
  const at = text.indexOf('TROVATO');
  const s = snippet(text, at, at + 7);
  assert.strictEqual(s.match, 'TROVATO');
  assert.ok(s.before.startsWith('…') && s.after.endsWith('…'));
  assert.ok((s.before + s.match + s.after).length <= 125, 'circa 120 caratteri');
  assert.deepStrictEqual(snippet('TROVATO in testa', 0, 7), { before: '', match: 'TROVATO', after: ' in testa' });
  assert.deepStrictEqual(snippet('in coda TROVATO', 8, 15), { before: 'in coda ', match: 'TROVATO', after: '' });
});

ok('ricerca: snippet non comincia né finisce a metà parola se lo spazio è vicino', () => {
  const text = 'a'.repeat(100) + ' parola ' + 'b'.repeat(40) + ' CHIAVE ' + 'c'.repeat(40) + ' altra ' + 'd'.repeat(100);
  const at = text.indexOf('CHIAVE');
  const s = snippet(text, at, at + 6, { width: 110 });
  // 52 caratteri per lato: il taglio cadrebbe dentro «aa» e dentro «dddd»
  assert.ok(/^…parola b+ $/.test(s.before), s.before);
  assert.ok(/^ c+ altra…$/.test(s.after), s.after);
});

/* ---------- Il thread di ricerca (lib/search-worker.js) ---------- */

ok('worker: una ricerca vera attraverso il thread', () => withHome(async (home) => {
  claudeSession(home, 'nel-thread', [user('cerca nel thread')]);
  const w = createSearchWorker({ home });
  try {
    const r = await w.search('thread');
    assert.strictEqual(r.ok, true, r.error || '');
    assert.deepStrictEqual(r.results.map((x) => x.id), ['nel-thread']);
  } finally {
    await w.close();
  }
}));

ok('worker: una ricerca nuova annulla quella ancora in coda', () => withHome(async (home) => {
  claudeSession(home, 'uno', [user('prima e seconda')]);
  const w = createSearchWorker({ home });
  try {
    const first = w.search('prima');
    const second = w.search('seconda');
    assert.deepStrictEqual(await first, { ok: false, cancelled: true, results: [] });
    assert.deepStrictEqual((await second).results.map((x) => x.id), ['uno']);
  } finally {
    await w.close();
  }
}));

ok('worker: gli errori tornano come risposta, non come eccezione', () => withHome(async (home) => {
  const w = createSearchWorker({ home });
  try {
    const r = await w.search('x');
    assert.strictEqual(r.ok, false);
    assert.ok(/almeno 2/.test(r.error), r.error);
  } finally {
    await w.close();
  }
}));
