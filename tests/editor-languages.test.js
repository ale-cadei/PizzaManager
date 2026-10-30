const assert = require('node:assert');
const { test: ok } = require('node:test');
const { languageFor, LANGUAGES, registerLanguages } = require('../renderer/editor-languages');

ok('editor-languages: nomi interi noti, anche con cartelle e maiuscole', () => {
  const cases = {
    '.env': 'dotenv', 'app/.env': 'dotenv', '.gitignore': 'ignore', 'sub/.dockerignore': 'ignore',
    '.prettierignore': 'ignore', CODEOWNERS: 'ignore', Makefile: 'makefile', GNUmakefile: 'makefile',
    'Cargo.lock': 'toml', Pipfile: 'toml', '.bashrc': 'shell', '.zshrc': 'shell', '.envrc': 'shell',
    '.tmux.conf': 'shell', PKGBUILD: 'shell', '.npmrc': 'ini', '.gitmodules': 'ini', 'setup.cfg': 'ini',
    '.prettierrc': 'json', '.swcrc': 'json', Dockerfile: 'dockerfile', Containerfile: 'dockerfile',
    Gemfile: 'ruby', Vagrantfile: 'ruby',
  };
  for (const [rel, id] of Object.entries(cases)) assert.strictEqual(languageFor(rel), id, rel);
});

ok('editor-languages: varianti per inizio del nome', () => {
  assert.strictEqual(languageFor('.env.local'), 'dotenv');
  assert.strictEqual(languageFor('.env.production'), 'dotenv');
  assert.strictEqual(languageFor('docker/Dockerfile.dev'), 'dockerfile');
});

ok('editor-languages: estensioni', () => {
  const cases = {
    'pyproject.toml': 'toml', 'rules.mk': 'makefile', 'prod.env': 'dotenv', 'x.zsh': 'shell',
    'nginx.conf': 'ini', 'app.service': 'ini', 'tsconfig.base.jsonc': 'json', 'a.json5': 'json',
    'build.Dockerfile': 'dockerfile',
  };
  for (const [rel, id] of Object.entries(cases)) assert.strictEqual(languageFor(rel), id, rel);
});

ok('editor-languages: percorsi Windows', () => {
  assert.strictEqual(languageFor('cfg\\.env'), 'dotenv');
  assert.strictEqual(languageFor('a\\b\\Makefile'), 'makefile');
});

ok('editor-languages: il resto lo decide Monaco', () => {
  for (const rel of ['main.js', 'README.md', 'notes.txt', 'LICENSE', '.eslintrc.js', 'x', '', null, undefined]) {
    assert.strictEqual(languageFor(rel), undefined, String(rel));
  }
});

/* Monaco non gira sotto Node: un Monarch ridotto, quanto basta per le
   grammatiche di qui (regole [regex, token|token[], next?], stati con @). */
function tokenize(def, line, state = ['root']) {
  const out = [];
  const stack = [...state];
  let at = 0;
  while (at < line.length) {
    const rules = def.monarch.tokenizer[stack[stack.length - 1]];
    const hit = rules.map(([re, token, next]) => ({ m: new RegExp(`^(?:${re.source})`).exec(line.slice(at)), re, token, next }))
      .find(({ m, re }) => m && m[0].length > 0 && (!re.source.startsWith('^') || at === 0));
    assert.ok(hit, `nessuna regola per «${line.slice(at)}» in ${stack[stack.length - 1]}`);
    const tokens = Array.isArray(hit.token) ? hit.token : [hit.token];
    const parts = Array.isArray(hit.token) ? hit.m.slice(1) : [hit.m[0]];
    parts.forEach((p, i) => { if (p) out.push([p, tokens[i]]); });
    if (hit.next === '@pop') stack.pop();
    else if (hit.next) stack.push(hit.next.slice(1));
    at += hit.m[0].length;
  }
  return out;
}
const byId = (id) => LANGUAGES.find((l) => l.id === id);
const tokenOf = (pairs, text) => (pairs.find(([p]) => p === text) || [])[1];

ok('editor-languages: grammatiche ben formate', () => {
  assert.deepStrictEqual(LANGUAGES.map((l) => l.id).sort(), ['dotenv', 'ignore', 'makefile', 'toml']);
  for (const l of LANGUAGES) {
    const states = l.monarch.tokenizer;
    assert.ok(states.root, `${l.id}: manca root`);
    for (const [name, rules] of Object.entries(states)) {
      for (const [re, token, next] of rules) {
        assert.ok(re instanceof RegExp, `${l.id}.${name}`);
        if (Array.isArray(token)) {
          const groups = new RegExp(`${re.source}|`).exec('').length - 1;
          assert.strictEqual(groups, token.length, `${l.id}.${name}: ${re} ha ${groups} gruppi`);
        }
        if (next && next !== '@pop') assert.ok(states[next.slice(1)], `${l.id}.${name}: stato ${next} assente`);
      }
    }
    assert.strictEqual(l.configuration.comments.lineComment, '#');
  }
});

ok('editor-languages: dotenv', () => {
  const t = tokenize(byId('dotenv'), 'export API_URL="http://${HOST}:80" # nota');
  assert.strictEqual(tokenOf(t, 'export'), 'keyword');
  assert.strictEqual(tokenOf(t, 'API_URL'), 'key');
  assert.strictEqual(tokenOf(t, '${HOST}'), 'variable');
  assert.strictEqual(tokenOf(t, ' # nota'), 'comment');
  assert.strictEqual(tokenOf(tokenize(byId('dotenv'), '# solo commento'), '# solo commento'), 'comment');
  assert.strictEqual(tokenOf(tokenize(byId('dotenv'), 'DEBUG=true'), 'true'), 'string');
});

ok('editor-languages: ignore', () => {
  const t = tokenize(byId('ignore'), '!build/**/*.log');
  assert.strictEqual(tokenOf(t, '!'), 'keyword');
  assert.strictEqual(tokenOf(t, '**'), 'keyword');
  assert.strictEqual(tokenOf(tokenize(byId('ignore'), '# cache'), '# cache'), 'comment');
});

ok('editor-languages: toml', () => {
  const g = byId('toml');
  assert.strictEqual(tokenOf(tokenize(g, '[tool.poetry]'), '[tool.poetry]'), 'metatag');
  const t = tokenize(g, 'version = "1.2" # x');
  assert.strictEqual(tokenOf(t, 'version'), 'key');
  assert.strictEqual(tokenOf(t, '# x'), 'comment');
  assert.strictEqual(tokenOf(tokenize(g, 'n = 42'), '42'), 'number');
  assert.strictEqual(tokenOf(tokenize(g, 'ok = true'), 'true'), 'keyword');
  assert.strictEqual(tokenOf(tokenize(g, 'd = { a = 1 }'), 'a'), 'key');
});

ok('editor-languages: makefile', () => {
  const g = byId('makefile');
  const v = tokenize(g, 'CC ?= gcc');
  assert.strictEqual(tokenOf(v, 'CC'), 'key');
  assert.strictEqual(tokenOf(v, '?='), 'delimiter');
  const t = tokenize(g, 'build: main.o # x');
  assert.strictEqual(tokenOf(t, 'build'), 'type');
  assert.strictEqual(tokenOf(t, '# x'), 'comment');
  const r = tokenize(g, '\t$(CC) -o $@ $^');
  assert.strictEqual(tokenOf(r, '$(CC)'), 'variable');
  assert.strictEqual(tokenOf(r, '$@'), 'variable');
  assert.strictEqual(tokenOf(tokenize(g, 'ifeq ($(OS),Windows_NT)'), 'ifeq'), 'keyword');
});

ok('editor-languages: registerLanguages registra una volta per monaco', () => {
  const calls = [];
  const monaco = {
    languages: {
      register: (l) => calls.push(['register', l.id]),
      setMonarchTokensProvider: (id) => calls.push(['tokens', id]),
      setLanguageConfiguration: (id) => calls.push(['config', id]),
    },
  };
  registerLanguages(monaco);
  registerLanguages(monaco);
  assert.strictEqual(calls.length, LANGUAGES.length * 3);
  assert.deepStrictEqual(calls.filter(([k]) => k === 'register').map(([, id]) => id), LANGUAGES.map((l) => l.id));
});
