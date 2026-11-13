const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorSessionsStore, sanitizeEditorSessions, EDITOR_SESSIONS_FILE, MAX_SESSIONS, MAX_FILES } = require('../lib/editor-sessions');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edsess-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

ok('store: andata e ritorno, con savedAt', (t) => {
  const dir = tmp(t);
  const store = createEditorSessionsStore({ dir, now: () => 1234 });
  const list = [{ name: null, cwd: '/home/u/prj', env: 'local', files: ['src/a.js', 'README.md'], active: 'README.md', startedAt: 10, recent: [{ rel: 'old.js', at: 9 }] }];
  assert.deepStrictEqual(store.write(list), list);
  assert.deepStrictEqual(store.readState(), { sessions: list, savedAt: 1234 });
  assert.strictEqual(store.file, path.join(dir, EDITOR_SESSIONS_FILE));
});

ok('store: file mancante o corrotto = nessuna sessione', (t) => {
  const dir = tmp(t);
  const store = createEditorSessionsStore({ dir });
  assert.deepStrictEqual(store.readState(), { sessions: [], savedAt: null });
  fs.writeFileSync(store.file, '{ rotto');
  assert.deepStrictEqual(store.readState(), { sessions: [], savedAt: null });
});

ok('sanitize: cwd relative o sporche e file che escono si scartano', () => {
  const out = sanitizeEditorSessions([
    { cwd: 'relativa', files: [] },
    { cwd: '/ok\x00', files: [] },
    { cwd: ' /home/u/prj ', name: 'x'.repeat(41), files: ['../etc/passwd', 'a.js', 'a.js', './b.js', '/abs'], active: '../etc/passwd' },
    { cwd: 'C:\\prj', name: ' Mio ', files: 'non-lista', active: 'x' },
    null,
  ]);
  assert.deepStrictEqual(out, [
    { name: null, cwd: '/home/u/prj', env: 'local', files: ['a.js', 'b.js'], active: 'a.js', startedAt: null, recent: [] },
    { name: 'Mio', cwd: 'C:\\prj', env: 'local', files: [], active: null, startedAt: null, recent: [] },
  ]);
});

ok('sanitize: limiti su sessioni e file', () => {
  const files = Array.from({ length: MAX_FILES + 5 }, (_, i) => `f${i}.js`);
  const many = Array.from({ length: MAX_SESSIONS + 5 }, () => ({ cwd: '/p', files }));
  const out = sanitizeEditorSessions(many);
  assert.strictEqual(out.length, MAX_SESSIONS);
  assert.strictEqual(out[0].files.length, MAX_FILES);
  assert.deepStrictEqual(sanitizeEditorSessions('no'), []);
});

ok('sanitize: i recenti restano se sono percorsi relativi validi con una data, al massimo 5 (piano 75)', () => {
  const [s] = sanitizeEditorSessions([{ cwd: '/w', files: [], recent: [
    { rel: 'a.js', at: 5 }, { rel: '../fuori', at: 4 }, { rel: 'b.js' }, 'c.js', { rel: 'a.js', at: 3 },
    { rel: 'd.js', at: 2 }, { rel: 'e.js', at: 1 }, { rel: 'f.js', at: 1 }, { rel: 'g.js', at: 1 }, { rel: 'h.js', at: 1 },
  ] }]);
  assert.deepStrictEqual(s.recent, [{ rel: 'a.js', at: 5 }, { rel: 'd.js', at: 2 }, { rel: 'e.js', at: 1 }, { rel: 'f.js', at: 1 }, { rel: 'g.js', at: 1 }]);
  assert.deepStrictEqual(sanitizeEditorSessions([{ cwd: '/w', recent: 'no' }])[0].recent, []);
});

ok('sanitize: scheda su un server SSH tiene env e accetta ~ (docs/plans/94)', () => {
  const [s, t] = sanitizeEditorSessions([
    { cwd: '~/prj', env: 'ssh:nas', files: ['a.js'] },
    { cwd: '/srv/x/', env: 'ssh:pi' },
  ]);
  assert.strictEqual(s.env, 'ssh:nas');
  assert.strictEqual(s.cwd, '~/prj');
  assert.deepStrictEqual([t.env, t.cwd], ['ssh:pi', '/srv/x']);
});

ok('sanitize: ambiente assente = locale, ambiente non valido o WSL = scheda scartata', () => {
  const list = sanitizeEditorSessions([
    { cwd: '/home/u/prj' },
    { cwd: '~/prj' },
    { cwd: '/srv', env: 'ssh:-oProxyCommand=x' },
    { cwd: '/srv', env: 'wsl:Debian' },
    { cwd: 'relativo', env: 'ssh:nas' },
  ]);
  assert.deepStrictEqual(list.map((s) => [s.env, s.cwd]), [['local', '/home/u/prj']]);
});
