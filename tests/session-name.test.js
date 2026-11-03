const assert = require('node:assert');
const { test: ok } = require('node:test');

const { nameArgs, cleanName, NAME_MAX } = require('../lib/session-name');

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
