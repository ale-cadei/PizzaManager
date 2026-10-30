const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const {
  validSymbol, definitionAt, parseGrep, rankDefinitions, createEditorDefinition,
} = require('../lib/editor-definition');

const strong = (line, word) => {
  const d = definitionAt(line, word);
  return d && d.strong ? d.column : 0;
};
const weak = (line, word) => {
  const d = definitionAt(line, word);
  return d && !d.strong ? d.column : 0;
};

ok('definizione: nomi validi e parole chiave rifiutate', () => {
  for (const w of ['foo', 'Foo_1', '$el', '_x', 'città', '--accent', '$scss-var']) assert.ok(validSymbol(w), w);
  for (const w of ['', '1abc', 'a b', 'a.b', 'if', 'return', 'const', 'x'.repeat(200), null, 42, '-', '--']) {
    assert.ok(!validSymbol(w), String(w));
  }
});

ok('definizione: forme forti per linguaggio, colonna sul nome', () => {
  const cases = [
    ['function foo(a) {', 'foo', 10],
    ['export async function* foo() {', 'foo', 24],
    ['export default class Foo extends Bar {', 'Foo', 22],
    ['interface Foo {', 'Foo', 11],
    ['export type Foo = string;', 'Foo', 13],
    ['enum Foo { A }', 'Foo', 6],
    ['const foo = 1;', 'foo', 7],
    ['  let foo;', 'foo', 7],
    ['var $el = null', '$el', 5],
    ['def foo(self):', 'foo', 5],
    ['    async def foo():', 'foo', 15],
    ['class Foo(Base):', 'Foo', 7],
    ['func foo() error {', 'foo', 6],
    ['func (s *Server) Foo(ctx context.Context) {', 'Foo', 18],
    ['type Foo struct {', 'Foo', 6],
    ['pub fn foo(&self) -> u8 {', 'foo', 8],
    ['struct Foo {', 'Foo', 8],
    ['let mut foo = 3;', 'foo', 9],
    ['fun String.foo(): Int {', 'foo', 12],
    ['val foo = 1', 'foo', 5],
    ['  def self.foo', 'foo', 12],
    ['function &foo() {', 'foo', 11],
    ['#define FOO 1', 'FOO', 9],
    ['local function foo()', 'foo', 16],
    ['function M.foo()', 'foo', 12],
    ['defmodule Foo do', 'Foo', 11],
  ];
  for (const [line, word, column] of cases) assert.strictEqual(strong(line, word), column, line);
});

ok('definizione: forme deboli', () => {
  const cases = [
    ['foo = 1', 'foo', 1],
    ['module.exports.foo = foo;', 'foo', 16],
    ['  this.foo = bar', 'foo', 8],
    ['  foo: function () {', 'foo', 3],
    ["  'foo': 1,", 'foo', 4],
    ['  --accent: #fff;', '--accent', 3],
    ['$scss-var: 4px;', '$scss-var', 1],
    ['  async foo(a, b) {', 'foo', 9],
    ['  static get foo() {', 'foo', 14],
    ['int foo(int a) {', 'foo', 5],
    ['static const char *foo(void)', 'foo', 20],
    ['std::string Widget::foo(int a) const {', 'foo', 21],
    ['foo() {', 'foo', 1],
  ];
  for (const [line, word, column] of cases) assert.strictEqual(weak(line, word), column, line);
});

ok('definizione: usi, chiamate e confronti non sono definizioni', () => {
  const lines = [
    ['foo(1, 2);', 'foo'],
    ['  return foo(a);', 'foo'],
    ['if (foo == 1) {', 'foo'],
    ['x = foo;', 'foo'],
    ['bar(foo) {', 'foo'],
    ['const x = foo();', 'foo'],
    ['new Foo()', 'Foo'],
    ['foo => foo + 1', 'foo'],
    ['if (foo === bar) {', 'foo'],
    ['  } else if (foo(x)) {', 'foo'],
    ['int x = foo(3);', 'foo'],
    ['import { foo } from "./foo";', 'foo'],
    ['// function foobar()', 'foo'],
    ['const foobar = 1', 'foo'],
    ['class FooBar {', 'Foo'],
    ['while (foo(x)) {', 'foo'],
    ['case foo:', 'foo'],
  ];
  for (const [line, word] of lines) assert.strictEqual(definitionAt(line, word), null, line);
});

ok('definizione: parseGrep legge path\\0riga\\0testo e salta il resto', () => {
  const out = 'a/b.js\u00003\u0000function foo() {}\nc.py\u000010\u0000def foo():\nrotto\n\n../fuori.js\u00001\u0000const foo = 1\n';
  assert.deepStrictEqual(parseGrep(out), [
    { rel: 'a/b.js', line: 3, text: 'function foo() {}' },
    { rel: 'c.py', line: 10, text: 'def foo():' },
  ]);
});

ok('definizione: ordine — forti, stesso file vicino sopra, famiglia, cartelle', () => {
  const at = (rel, line, isStrong = true) => ({ rel, line, column: 1, text: '', strong: isStrong });
  const ranked = rankDefinitions([
    at('z/far.py', 1),
    at('src/near.ts', 4),
    at('src/here.js', 90, false),
    at('src/here.js', 2),
    at('src/here.js', 40),
    at('src/here.js', 60),
    at('lib/x.js', 1),
    at('src/sub/y.js', 1),
  ], { rel: 'src/here.js', line: 50 });
  assert.deepStrictEqual(ranked.map((r) => `${r.rel}:${r.line}`), [
    'src/here.js:40', 'src/here.js:2', 'src/here.js:60',
    'src/near.ts:4', 'src/sub/y.js:1', 'lib/x.js:1', 'z/far.py:1',
    'src/here.js:90',
  ]);
});

ok('definizione: ordine senza file di partenza, e al massimo 50', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ rel: `f${String(i).padStart(2, '0')}.js`, line: 1, column: 1, text: '', strong: true }));
  const ranked = rankDefinitions(many, {});
  assert.strictEqual(ranked.length, 50);
  assert.strictEqual(ranked[0].rel, 'f00.js');
});

/* ---------- con un git finto ---------- */

ok('definizione: find con git finto — argv, cwd, risultati ordinati', async () => {
  const calls = [];
  const run = async (args, o) => {
    calls.push({ args, cwd: o.cwd });
    return 'b.js\u00002\u0000foo();\na.js\u00007\u0000function foo() {}\nlong.js\u00001\u0000' + `const foo = ${'1'.repeat(1200)}\n`;
  };
  const d = createEditorDefinition({ root: os.tmpdir(), run });
  const r = await d.find({ word: 'foo', from: 'b.js', line: 2 });
  assert.deepStrictEqual(r, { ok: true, results: [{ rel: 'a.js', line: 7, column: 10, text: 'function foo() {}', strong: true }] });
  const { args } = calls[0];
  for (const flag of ['grep', '-n', '-z', '-I', '-w', '-F', '--untracked']) assert.ok(args.includes(flag), flag);
  assert.strictEqual(args[args.indexOf('-e') + 1], 'foo');
  assert.strictEqual(calls[0].cwd, fs.realpathSync(os.tmpdir()));
});

ok('definizione: un nome che inizia con - non diventa un flag di git', async () => {
  let seen = null;
  const d = createEditorDefinition({ root: os.tmpdir(), run: async (args) => { seen = args; return ''; } });
  await d.find({ word: '--accent' });
  assert.strictEqual(seen[seen.indexOf('-e') + 1], '--accent');
});

ok('definizione: nessuna corrispondenza (git esce con 1) è una lista vuota', async () => {
  const run = async () => { throw Object.assign(new Error('exit 1'), { code: 1, stderr: '' }); };
  const r = await createEditorDefinition({ root: os.tmpdir(), run }).find({ word: 'foo' });
  assert.deepStrictEqual(r, { ok: true, results: [] });
});

ok('definizione: fuori da un repository ritenta con --no-index', async () => {
  const seen = [];
  const run = async (args) => {
    seen.push(args);
    if (!args.includes('--no-index')) throw Object.assign(new Error('x'), { code: 128, stderr: 'fatal: not a git repository' });
    return 'a.py\u00001\u0000def foo():\n';
  };
  const r = await createEditorDefinition({ root: os.tmpdir(), run }).find({ word: 'foo' });
  assert.strictEqual(r.results.length, 1);
  assert.ok(seen[1].includes('--exclude-standard'));
  assert.ok(!seen[1].includes('--untracked'), '--untracked e --no-index non vanno insieme');
});

ok('definizione: errori — nome non valido, git mancante, altro', async () => {
  const never = async () => { throw new Error('non doveva partire'); };
  const d = createEditorDefinition({ root: os.tmpdir(), run: never });
  for (const word of ['', 'if', 'a b', undefined]) assert.deepStrictEqual(await d.find({ word }), { ok: false, reason: 'invalid' });
  const missing = createEditorDefinition({ root: os.tmpdir(), run: async () => { throw Object.assign(new Error('no'), { missing: true }); } });
  assert.deepStrictEqual(await missing.find({ word: 'foo' }), { ok: false, reason: 'no-git' });
  const broken = createEditorDefinition({ root: os.tmpdir(), run: async () => { throw Object.assign(new Error('x'), { code: 2, stderr: 'fatal: boom\n' }); } });
  assert.deepStrictEqual(await broken.find({ word: 'foo' }), { ok: false, reason: 'error', error: 'fatal: boom' });
  assert.throws(() => createEditorDefinition({ root: '' }));
});

/* ---------- git vero ---------- */

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function tree(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-def-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const FILES = {
  '.gitignore': 'build/\n',
  'src/app.js': "const { helper } = require('./util');\nhelper(1);\n",
  'src/util.js': 'function helper(x) {\n  return x;\n}\nmodule.exports = { helper };\n',
  'build/util.js': 'function helper() {}\n',
  'py/mod.py': 'def helper():\n    pass\n',
};

ok('definizione: git grep vero in un repository, ignorati esclusi, file nuovi compresi', async (t) => {
  if (!hasGit()) { t.skip('git non installato'); return; }
  const root = tree(t, FILES);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('add', 'src/util.js', '.gitignore'); // app.js e mod.py restano non tracciati
  const r = await createEditorDefinition({ root }).find({ word: 'helper', from: 'src/app.js', line: 2 });
  assert.strictEqual(r.ok, true);
  // La destrutturazione di app.js riga 1 non è una definizione: si salta
  assert.deepStrictEqual(r.results.map((x) => `${x.rel}:${x.line}:${x.column}`), ['src/util.js:1:10', 'py/mod.py:1:5']);
});

ok('definizione: git grep vero fuori da un repository', async (t) => {
  if (!hasGit()) { t.skip('git non installato'); return; }
  const root = tree(t, FILES);
  // Un .git vuoto più su non deve servire: la tmpdir non sta in un repository
  const r = await createEditorDefinition({ root, env: { GIT_CEILING_DIRECTORIES: path.dirname(root) } })
    .find({ word: 'helper', from: 'src/app.js', line: 2 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.results[0].rel, 'src/util.js');
});
