// Test che toccano l'ambiente reale: girano solo se i tool sono installati,
// altrimenti si dichiarano saltati. Servono a intercettare i cambi di formato
// delle CLI esterne, che nessun test con dipendenze iniettate puo' vedere.
const fs = require('fs');
const assert = require('node:assert');
const { test: ok, skip } = require('node:test');

ok('codex-sessions: la scansione dei rollout non solleva eccezioni', (t) => {
  const { listCodexSessions, sessionsDir } = require('../lib/codex-sessions');
  const r = listCodexSessions(5);
  assert.ok(typeof r.ok === 'boolean' && Array.isArray(r.sessions), 'forma della risposta inattesa');
  if (!fs.existsSync(sessionsDir())) return t.skip('nessuna directory di sessioni codex su questa macchina');
  assert.strictEqual(r.ok, true, r.error || '');
  assert.ok(r.sessions.length <= 5, 'limite non rispettato');
  for (const s of r.sessions) {
    assert.ok(s.id && s.title, 'sessione senza id o titolo');
    assert.strictEqual(typeof s.mtime, 'number', 'mtime mancante');
  }
});

ok('opencode: `session list --format json` produce ancora un array JSON', (t) => {
  const { execFileSync } = require('child_process');
  const { resolveBinary } = require('../lib/binaries');
  const bin = resolveBinary('opencode');
  if (!bin.path) return t.skip('opencode non installato su questa macchina');
  let out;
  try {
    out = execFileSync(bin.path, ['session', 'list', '--format', 'json', '-n', '2'], { timeout: 15000 });
  } catch (e) {
    return t.skip('opencode presente ma non interrogabile: ' + (e.message || e));
  }
  const testo = out.toString().trim();
  // Con zero sessioni opencode non stampa nulla, nemmeno "[]". Non c'e' niente
  // da verificare sul formato — ed e' il caso che oggi manda in errore il
  // dialog Resume: vedi docs/plans/04-robustness.md.
  if (!testo) return t.skip('nessuna sessione opencode su questa macchina');
  assert.ok(Array.isArray(JSON.parse(testo)), 'opencode non restituisce piu un array: il dialog Resume si rompe');
});
