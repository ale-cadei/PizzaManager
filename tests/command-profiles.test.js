const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');

const profiles = require('../lib/command-profiles');

const DEFAULTS = profiles.defaultProfiles({ shell: '/bin/bash', platform: 'linux' });
const DEFAULT_CONFIG = profiles.normalizeConfig(null, { defaults: DEFAULTS });

function buildCommand(type, resumeId) {
  const first = profiles.listProfiles(DEFAULT_CONFIG, type)[0];
  const r = profiles.resolveProfileCommand(first, { resumeId, home: '/home/tester' });
  assert.strictEqual(r.ok, true, r.error || '');
  return { cmd: r.bin, args: r.args, resumeApplied: r.resumeApplied };
}

const SESSION_TYPES = ['shell', 'opencode', 'claude', 'codex'];

ok('comandi: tokenizer rispetta virgolette ed escape', () => {
  assert.deepStrictEqual(profiles.tokenizeCommand('claude --model opus'), ['claude', '--model', 'opus']);
  assert.deepStrictEqual(profiles.tokenizeCommand('"/opt/my dir/claude" --flag'), ['/opt/my dir/claude', '--flag']);
  assert.deepStrictEqual(profiles.tokenizeCommand("claude --msg 'ciao mondo'"), ['claude', '--msg', 'ciao mondo']);
  assert.deepStrictEqual(profiles.tokenizeCommand('claude\\ code --x', { platform: 'linux' }), ['claude code', '--x']);
  assert.deepStrictEqual(profiles.tokenizeCommand('   '), []);
  assert.deepStrictEqual(profiles.tokenizeCommand(null), []);
});

ok('comandi: la validazione blocca operatori di shell e virgolette aperte', () => {
  const pipe = profiles.validateProfile('shell', { label: 'x', command: 'ls | wc -l' });
  assert.strictEqual(pipe.ok, false);
  assert.ok(/operatori di shell/i.test(pipe.error), pipe.error);
  const sub = profiles.validateProfile('shell', { label: 'x', command: 'echo $(whoami)' });
  assert.strictEqual(sub.ok, false, 'la sostituzione di comando va rifiutata');
  const quote = profiles.validateProfile('claude', { label: 'x', command: 'claude "aperta' });
  assert.strictEqual(quote.ok, false);
  assert.ok(/virgolette/i.test(quote.error), quote.error);
});

ok('comandi: nome e riga di comando sono obbligatori', () => {
  assert.strictEqual(profiles.validateProfile('claude', { label: '', command: 'claude' }).ok, false);
  assert.strictEqual(profiles.validateProfile('claude', { label: 'x', command: '   ' }).ok, false);
  assert.strictEqual(profiles.validateProfile('inesistente', { label: 'x', command: 'x' }).ok, false);
  const good = profiles.validateProfile('claude', { label: ' Opus ', command: ' claude --model opus ' });
  assert.strictEqual(good.ok, true, good.error);
  assert.deepStrictEqual(
    { label: good.profile.label, command: good.profile.command },
    { label: 'Opus', command: 'claude --model opus' }
  );
});

ok('comandi: normalizeConfig scarta i profili rotti e non lascia tipi vuoti', () => {
  const cfg = profiles.normalizeConfig(
    {
      profiles: {
        claude: [
          { id: 'claude:opus', label: 'Opus', command: 'claude --model opus' },
          { label: '', command: 'claude' },
          { label: 'rotto', command: 'claude && ls' },
        ],
        codex: 'non un array',
      },
    },
    { defaults: DEFAULTS }
  );
  assert.deepStrictEqual(cfg.profiles.claude.map((p) => p.label), ['Opus']);
  assert.deepStrictEqual(cfg.profiles.codex.map((p) => p.label), DEFAULTS.codex.map((p) => p.label));
  assert.deepStrictEqual(cfg.profiles.shell.map((p) => p.command), DEFAULTS.shell.map((p) => p.command));
  for (const t of SESSION_TYPES) assert.ok(cfg.profiles[t].length >= 1, 'tipo senza comandi: ' + t);
});

ok('comandi: normalizeConfig assegna id unici e rispetta il limite per tipo', () => {
  const dup = profiles.normalizeConfig(
    { profiles: { claude: [
      { id: 'claude:x', label: 'A', command: 'claude' },
      { id: 'claude:x', label: 'B', command: 'claude' },
    ] } },
    { defaults: DEFAULTS }
  );
  const ids = dup.profiles.claude.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id duplicati: ' + ids);
  const many = Array.from({ length: profiles.MAX_PROFILES_PER_TYPE + 5 }, (_, i) => ({ label: 'c' + i, command: 'claude' }));
  const capped = profiles.normalizeConfig({ profiles: { claude: many } }, { defaults: DEFAULTS });
  assert.strictEqual(capped.profiles.claude.length, profiles.MAX_PROFILES_PER_TYPE);
});

ok('comandi: normalizeConfig non muta l input', () => {
  const raw = { profiles: { claude: [{ id: 'claude:a', label: 'A', command: 'claude' }] } };
  const snapshot = JSON.stringify(raw);
  profiles.normalizeConfig(raw, { defaults: DEFAULTS });
  assert.strictEqual(JSON.stringify(raw), snapshot);
});

ok('comandi: resume in coda, inline con {id} e scartato se non serve', () => {
  const coda = profiles.resolveProfileCommand(
    { command: 'claude --verbose', resumeArgs: '--resume {id}' },
    { resumeId: 'abc' }
  );
  assert.deepStrictEqual(coda.args, ['--verbose', '--resume', 'abc']);
  assert.strictEqual(coda.resumeApplied, true);

  const inline = profiles.resolveProfileCommand(
    { command: 'codex resume {id} --full-auto', resumeArgs: 'resume {id}' },
    { resumeId: 'xyz' }
  );
  assert.deepStrictEqual(inline.args, ['resume', 'xyz', '--full-auto'], 'il segnaposto inline deve vincere');
  assert.strictEqual(inline.resumeApplied, true);

  const pulito = profiles.resolveProfileCommand(
    { command: 'codex resume {id}', resumeArgs: 'resume {id}' },
    {}
  );
  assert.deepStrictEqual(pulito.args, ['resume'], 'senza resumeId i token con {id} vanno via');
  assert.strictEqual(pulito.resumeApplied, false);
});

ok('comandi: la tilde viene espansa (pty.spawn non passa da una shell)', () => {
  const r = profiles.resolveProfileCommand(
    { command: '~/.local/bin/claude --add-dir ~/progetti', resumeArgs: '' },
    { home: '/home/tester' }
  );
  assert.strictEqual(r.bin, '/home/tester/.local/bin/claude');
  assert.deepStrictEqual(r.args, ['--add-dir', '/home/tester/progetti']);
});

ok('comandi: le variabili in testa diventano env, non argv (alias di shell riscritti)', () => {
  const r = profiles.resolveProfileCommand(
    { command: 'CLAUDE_CONFIG_DIR=~/.claude-personal claude --model opus', resumeArgs: '--resume {id}' },
    { home: '/Users/jack' }
  );
  assert.ok(r.ok);
  assert.strictEqual(r.bin, 'claude');
  assert.deepStrictEqual(r.args, ['--model', 'opus']);
  assert.deepStrictEqual(r.env, { CLAUDE_CONFIG_DIR: '/Users/jack/.claude-personal' });

  // $HOME e ${VAR} presi dall'ambiente passato; variabili ignote restano letterali
  const v = profiles.resolveProfileCommand(
    { command: 'A=$HOME/.x B=${FOO}-1 C=$IGNOTA claude' },
    { home: '/h', env: { HOME: '/Users/jack', FOO: 'bar' } }
  );
  assert.deepStrictEqual(v.env, { A: '/Users/jack/.x', B: 'bar-1', C: '$IGNOTA' });
  assert.strictEqual(v.bin, 'claude');

  // il resume continua a funzionare col prefisso davanti
  const res = profiles.resolveProfileCommand(
    { command: 'CLAUDE_CONFIG_DIR=/p claude', resumeArgs: '--resume {id}' },
    { resumeId: 'abc123' }
  );
  assert.deepStrictEqual(res.args, ['--resume', 'abc123']);
  assert.strictEqual(res.resumeApplied, true);

  // solo variabili, nessun comando: errore sia in resolve sia in validazione
  assert.strictEqual(profiles.resolveProfileCommand({ command: 'FOO=bar' }, {}).ok, false);
  const bad = profiles.validateProfile('claude', { label: 'x', command: 'FOO=bar' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /manca il comando/i);

  // un token con '=' dopo il comando resta un argomento
  const arg = profiles.resolveProfileCommand({ command: 'claude FOO=bar' }, {});
  assert.deepStrictEqual(arg.args, ['FOO=bar']);
  assert.deepStrictEqual(arg.env, {});
});

ok('comandi: profilo non valido non produce un argv', () => {
  assert.strictEqual(profiles.resolveProfileCommand(null, {}).ok, false);
  assert.strictEqual(profiles.resolveProfileCommand({ command: '   ' }, {}).ok, false);
  assert.strictEqual(profiles.resolveProfileCommand({ command: 'claude "x' }, {}).ok, false);
});

ok('comandi: findProfile e listProfiles restituiscono copie', () => {
  const found = profiles.findProfile(DEFAULT_CONFIG, 'claude', 'claude:default');
  assert.ok(found, 'profilo di default claude non trovato');
  found.label = 'modificato';
  assert.notStrictEqual(profiles.findProfile(DEFAULT_CONFIG, 'claude', 'claude:default').label, 'modificato');
  assert.strictEqual(profiles.findProfile(DEFAULT_CONFIG, 'claude', 'inesistente'), null);
  assert.deepStrictEqual(profiles.listProfiles(null, 'claude'), []);
});

ok('shell con spazi nel percorso resta un solo token', () => {
  const d = profiles.defaultProfiles({ shell: '/opt/my shell/bash', platform: 'linux' });
  const r = profiles.resolveProfileCommand(d.shell[0], {});
  assert.strictEqual(r.bin, '/opt/my shell/bash');
  assert.deepStrictEqual(r.args, ['-i']);
});

ok('shell su windows non riceve -i', () => {
  const win = profiles.defaultProfiles({ shell: 'powershell.exe', platform: 'win32' });
  const r = profiles.resolveProfileCommand(win.shell[0], {});
  assert.deepStrictEqual(r.args, []);
});

// ---------- Divergenze dalla shell corrette (piano 04, 6-bis) ----------
ok('comandi: dentro le virgolette doppie il backslash scappa solo $ ` " \\, come in POSIX', () => {
  assert.deepStrictEqual(profiles.tokenizeCommand('"C:\\Users\\x"'), ['C:\\Users\\x'], 'un percorso Windows non deve perdere i backslash');
  assert.deepStrictEqual(profiles.tokenizeCommand('"a\\"b"'), ['a"b'], 'la virgoletta scappata resta letterale');
  assert.deepStrictEqual(profiles.tokenizeCommand('"x\\$y"'), ['x$y'], 'il dollaro scappato resta letterale');
  assert.deepStrictEqual(profiles.tokenizeCommand('"p\\\\q"'), ['p\\q'], 'doppio backslash = un backslash');
  // fuori dalle virgolette il backslash scappa qualunque cosa, come prima (su Unix)
  assert.deepStrictEqual(profiles.tokenizeCommand('a\\ b', { platform: 'linux' }), ['a b']);
});

ok('comandi: $VAR e ${VAR} si espandono anche negli argomenti, le ignote restano letterali', () => {
  const r = profiles.resolveProfileCommand(
    { command: 'claude --model $MODEL --dir ${WORK}/src --keep $IGNOTA', resumeArgs: '--resume {id} --from $MODEL' },
    { env: { MODEL: 'opus', WORK: '/w' }, resumeId: 'abc' }
  );
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.args, ['--model', 'opus', '--dir', '/w/src', '--keep', '$IGNOTA', '--resume', 'abc', '--from', 'opus']);
});

ok('comandi: anche il binario puo venire da una variabile', () => {
  const r = profiles.resolveProfileCommand({ command: '$BIN --x' }, { env: { BIN: '/opt/tools/claude' } });
  assert.strictEqual(r.bin, '/opt/tools/claude');
});
