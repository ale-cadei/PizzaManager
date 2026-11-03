const assert = require('node:assert');
const { test: ok } = require('node:test');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { nameInjection, cleanName, NAME_MAX, NAME_ENV, ID_ENV } = require('../lib/session-name');
const { opencodePluginSource } = require('../lib/agent-hooks');

const nameArgs = (type, name, args) => nameInjection(type, name, { args }).args;

ok('claude: il nome scelto diventa --name=<nome>', () => {
  assert.deepStrictEqual(nameArgs('claude', 'refactor login'), ['--name=refactor login']);
});

ok('un nome che comincia con - resta il valore di --name, non un\'opzione', () => {
  assert.deepStrictEqual(nameArgs('claude', '-x'), ['--name=-x']);
});

ok('gli altri tipi non hanno un flag per il nome', () => {
  for (const type of ['opencode', 'codex', 'antigravity', 'shell', 'git', 'editor']) {
    assert.deepStrictEqual(nameArgs(type, 'prova'), [], type);
  }
});

ok('nessun nome, vuoto o solo spazi: niente flag', () => {
  for (const name of [undefined, null, '', '   ', '\t\n']) {
    assert.deepStrictEqual(nameArgs('claude', name), [], JSON.stringify(name));
  }
});

ok('un valore che non è una stringa non passa', () => {
  for (const name of [42, {}, ['a'], true]) {
    assert.deepStrictEqual(nameArgs('claude', name), [], JSON.stringify(name));
  }
});

ok('caratteri di controllo e spazi ripetuti diventano uno spazio', () => {
  assert.strictEqual(cleanName('  a\x1b[31m\tb\n\nc\x07  '), 'a [31m b c');
});

ok(`il nome si taglia a ${NAME_MAX} caratteri, senza spazi in coda`, () => {
  const long = 'a'.repeat(NAME_MAX - 1) + ' bbbb';
  const clean = cleanName(long);
  assert.strictEqual(clean, 'a'.repeat(NAME_MAX - 1));
  assert.ok(cleanName('x'.repeat(500)).length === NAME_MAX);
});

ok('se il profilo ha già -n o --name il nome non si aggiunge', () => {
  for (const args of [['-n', 'mio'], ['--name', 'mio'], ['--name=mio'], ['--resume', 'id', '-n=mio']]) {
    assert.deepStrictEqual(nameArgs('claude', 'prova', args), [], args.join(' '));
  }
});

ok('altri argomenti del profilo non contano', () => {
  assert.deepStrictEqual(nameArgs('claude', 'prova', ['--resume', 'id', '--model', 'opus']), ['--name=prova']);
});

/* opencode non ha un flag: il nome va al plugin del piano 46 per variabile
   d'ambiente, e il plugin lo mette come titolo della sessione. */
ok('opencode: il nome va nell\'ambiente, l\'id solo al resume', () => {
  assert.deepStrictEqual(nameInjection('opencode', ' mio  nome '), { args: [], env: { [NAME_ENV]: 'mio nome', [ID_ENV]: '' } });
  assert.deepStrictEqual(nameInjection('opencode', 'mio', { resumeId: 'ses_1' }), { args: [], env: { [NAME_ENV]: 'mio', [ID_ENV]: 'ses_1' } });
});

ok('opencode senza nome: le variabili ci sono ma vuote, quelle ereditate non passano', () => {
  assert.deepStrictEqual(nameInjection('opencode', '', { resumeId: 'ses_1' }), { args: [], env: { [NAME_ENV]: '', [ID_ENV]: '' } });
});

ok('claude: il nome non passa dall\'ambiente', () => {
  assert.deepStrictEqual(nameInjection('claude', 'x').env, {});
});

/* ---------- il plugin di opencode, caricato come modulo vero ---------- */
let pluginSeq = 0;
async function loadPlugin(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-name-plugin-'));
  const mod = path.join(dir, `p${pluginSeq++}.mjs`);
  fs.writeFileSync(mod, opencodePluginSource());
  const keys = [NAME_ENV, ID_ENV, 'AISESS_SIGNAL_FILE'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const calls = [];
  const client = { session: { update: async (req) => { calls.push(req); return { data: { title: req.body.title } }; } } };
  try {
    const hooks = await (await import(pathToFileURL(mod).href)).default({ client });
    await new Promise((r) => setTimeout(r, 10)); // la rinomina del resume parte fuori dall'init
    return { hooks, calls };
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
const created = (id, extra = {}) => ({ event: { type: 'session.created', properties: { info: { id, title: 'New session', ...extra } } } });

ok('plugin: la prima sessione creata prende il nome, una sola volta', async () => {
  const { hooks, calls } = await loadPlugin({ [NAME_ENV]: 'pizza', [ID_ENV]: '' });
  await hooks.event(created('ses_child', { parentID: 'ses_x' }));
  assert.deepStrictEqual(calls, [], 'una sessione figlia (subagente) non si rinomina');
  await hooks.event(created('ses_a'));
  await hooks.event(created('ses_b'));
  assert.deepStrictEqual(calls, [{ path: { id: 'ses_a' }, body: { title: 'pizza' } }]);
});

ok('plugin: al resume rinomina subito la sessione ripresa e non quelle nuove', async () => {
  const { hooks, calls } = await loadPlugin({ [NAME_ENV]: 'ripresa', [ID_ENV]: 'ses_r' });
  assert.deepStrictEqual(calls, [{ path: { id: 'ses_r' }, body: { title: 'ripresa' } }]);
  await hooks.event(created('ses_nuova'));
  assert.strictEqual(calls.length, 1);
});

ok('plugin: senza nome non rinomina niente', async () => {
  const { hooks, calls } = await loadPlugin({ [NAME_ENV]: '', [ID_ENV]: '' });
  await hooks.event(created('ses_a'));
  assert.deepStrictEqual(calls, []);
});

ok('plugin: una rinomina che fallisce non rompe opencode', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-name-plugin-'));
  const mod = path.join(dir, 'fail.mjs');
  fs.writeFileSync(mod, opencodePluginSource());
  process.env[NAME_ENV] = 'x';
  try {
    const client = { session: { update: async () => { throw new Error('server giù'); } } };
    const hooks = await (await import(pathToFileURL(mod).href)).default({ client });
    await hooks.event(created('ses_a'));
    const noClient = await (await import(pathToFileURL(mod).href + '?2')).default({});
    await noClient.event(created('ses_b'));
  } finally { delete process.env[NAME_ENV]; }
});
