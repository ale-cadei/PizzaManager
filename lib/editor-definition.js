'use strict';
/* Vai alla definizione nella sessione editor (docs/plans/71). Non è un LSP:
 * `git grep` cerca il nome come parola intera nella cartella della scheda
 * (rispettando .gitignore, file non tracciati compresi), poi ogni riga passa
 * per le «forme di definizione» — forti se introdotte da una parola chiave
 * (`function`, `class`, `def`, `const`…), deboli se lo fanno pensare
 * (`X =`, `X:`, `int X(`). L'ordine mette prima il file da cui si parte, poi
 * i file vicini. Sempre runGit: execFile con argv, mai la shell. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');
const { safeRel } = require('./editor-paths');

const TIMEOUT = 10000;
const MAX_RESULTS = 50;
const MAX_LINE = 1000; // oltre è un file minificato: niente da leggere lì
const MAX_WORD = 128;
const NOT_REPO = /not a git repository/i;

// Parole che non si definiscono: cercarle darebbe mezzo progetto
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return',
  'function', 'class', 'const', 'let', 'var', 'new', 'this', 'self', 'super', 'import', 'export',
  'from', 'as', 'in', 'of', 'def', 'fn', 'func', 'fun', 'type', 'interface', 'enum', 'struct',
  'true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'void', 'int', 'string',
  'public', 'private', 'protected', 'static', 'async', 'await', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'delete', 'yield', 'pass', 'not', 'and', 'or', 'is', 'elif', 'with',
]);
// Prima parola di una riga che non è una dichiarazione C-like (`return foo(`)
const NOT_TYPE = new Set(['return', 'else', 'new', 'throw', 'await', 'case', 'delete', 'typeof', 'yield',
  'if', 'while', 'for', 'switch', 'sizeof', 'echo', 'print', 'in', 'not', 'and', 'or', 'do', 'goto']);

const ID = '[\\p{L}\\p{N}_$]';
const SYMBOL = /^(?:--|\$)?[\p{L}_$][\p{L}\p{N}_$-]*$/u;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Un nome che vale la pena cercare: identificatore, variabile CSS (`--x`) o SCSS (`$x`).
 * @param {unknown} word
 * @returns {boolean}
 */
function validSymbol(word) {
  return typeof word === 'string' && word.length <= MAX_WORD && SYMBOL.test(word) && !KEYWORDS.has(word);
}

/* Le forme, col nome nel gruppo 1. Il nome finisce dove non c'è un altro
   carattere di identificatore; comincia dopo uno spazio, un punto o `::`. */
function shapes(word) {
  const W = `(${esc(word)})(?!${ID}|-)`;
  const QUAL = `(?:${ID}+[.:])*`; // `self.`, `M.`, `String.` (Ruby, Lua, Kotlin)
  const MODS = '(?:(?:export|default|public|private|protected|static|readonly|async|override|abstract|final|get|set)\\s+)*';
  return {
    strong: [
      `(?<!${ID})(?:function\\*?|def|defp|defmacro|fun)\\s+&?${QUAL}${W}`,
      `(?<!${ID})(?:class|interface|type|enum|namespace|module|defmodule|struct|trait|union|record|protocol|object|mod|fn|func|macro_rules!)\\s+${W}`,
      `(?<!${ID})(?:const|let|var|val|let\\s+mut)\\s+${W}`,
      `(?<!${ID})func\\s*\\([^)]*\\)\\s*${W}`, // metodo Go
      `#\\s*define\\s+${W}`,
    ],
    weak: [
      `^\\s*${MODS}(?:${ID}+\\.)*${W}\\s*=(?![=>])`, // X = …, obj.X = …
      `^\\s*['"]?${W}['"]?\\s*:(?!:)`, // chiavi, proprietà CSS, YAML
      `^\\s*${MODS}${W}\\s*\\([^)]*\\)\\s*(?::[^=;{]*)?\\{\\s*$`, // metodo con corpo
      `^\\s*(?:${ID}+[ \\t]+|[\\w:<>,*&\\[\\]]+[ \\t]+)+[*&]*(?:${ID}+::)*${W}\\s*\\([^;]*$`, // int X(…)
      `^\\s*${W}\\s*\\(\\)\\s*\\{?\\s*$`, // funzione di shell
    ],
  };
}

function firstMatch(sources, line) {
  for (const src of sources) {
    const m = new RegExp(src, 'du').exec(line);
    if (m) return m.indices[1][0] + 1;
  }
  return 0;
}

/**
 * Se `line` definisce `word`: dove (colonna da 1) e se la forma è forte.
 * @param {string} line
 * @param {string} word
 * @returns {{column: number, strong: boolean}|null}
 */
function definitionAt(line, word) {
  if (!validSymbol(word) || typeof line !== 'string' || line.length > MAX_LINE) return null;
  const { strong, weak } = shapes(word);
  const s = firstMatch(strong, line);
  if (s) return { column: s, strong: true };
  const first = line.trim().split(/[\s(]/)[0];
  if (NOT_TYPE.has(first)) return null;
  const w = firstMatch(weak, line);
  return w ? { column: w, strong: false } : null;
}

/**
 * L'uscita di `git grep -n -z`: `percorso\0riga\0testo` per riga. I percorsi
 * che escono dalla cartella (o non sono validi) si scartano.
 * @param {string} out
 * @returns {Array<{rel: string, line: number, text: string}>}
 */
function parseGrep(out) {
  return String(out).split('\n').flatMap((row) => {
    const parts = row.split('\0');
    if (parts.length < 3) return [];
    const rel = safeRel(parts[0]);
    const line = Number(parts[1]);
    if (!rel || rel !== parts[0] || !Number.isInteger(line) || line < 1) return [];
    return [{ rel, line, text: parts.slice(2).join('\0').replace(/\r$/, '') }];
  });
}

const FAMILIES = [
  ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte'],
  ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'm', 'mm'],
  ['java', 'kt', 'kts', 'scala', 'groovy'],
  ['css', 'scss', 'sass', 'less'],
  ['sh', 'bash', 'zsh'],
  ['py', 'pyi'],
];
const FAMILY = new Map(FAMILIES.flatMap((exts, i) => exts.map((e) => [e, `f${i}`])));
const familyOf = (rel) => {
  const ext = path.posix.extname(rel || '').slice(1).toLowerCase();
  return FAMILY.get(ext) || ext;
};

function dirDistance(a, b) {
  const pa = path.posix.dirname(a).split('/').filter((s) => s !== '.');
  const pb = path.posix.dirname(b).split('/').filter((s) => s !== '.');
  let common = 0;
  while (common < pa.length && common < pb.length && pa[common] === pb[common]) common += 1;
  return (pa.length - common) + (pb.length - common);
}

/**
 * Forti prima; poi il file di partenza (la definizione più vicina sopra
 * `line`, poi sotto); poi stessa famiglia di linguaggio, cartelle vicine,
 * percorso. Al massimo MAX_RESULTS.
 * @param {Array<{rel: string, line: number, strong: boolean}>} found
 * @param {{rel?: string, line?: number}} from
 */
function rankDefinitions(found, { rel: from = null, line: at = 0 } = {}) {
  const key = (d) => {
    const here = from !== null && d.rel === from;
    const near = !here ? 0 : d.line <= at ? at - d.line : 1e9 + d.line - at;
    return [
      d.strong ? 0 : 1, here ? 0 : 1, near,
      from && familyOf(d.rel) === familyOf(from) ? 0 : 1,
      from ? dirDistance(d.rel, from) : 0,
    ];
  };
  const compare = (a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.line - b.line;
  };
  return [...found].sort(compare).slice(0, MAX_RESULTS);
}

const firstLine = (e) => {
  const stderr = String((e && e.stderr) || '');
  return (stderr.split('\n').find((l) => l.trim()) || String((e && e.message) || e)).trim();
};

/**
 * @param {{root: string, run?: Function, env?: Object<string, string>}} o
 *   `run` ed `env` si sostituiscono nei test
 */
function createEditorDefinition({ root, run = runGit, env = {} } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('cartella della sessione mancante');
  const cwd = fs.realpathSync(root);

  // `-e` prima del nome: `--accent` non diventa un flag
  const grepArgs = (word, inRepo) => ['grep', '-n', '-z', '-I', '-w', '-F',
    ...(inRepo ? ['--untracked'] : ['--no-index', '--exclude-standard']), '-e', word, '--', '.'];

  async function grep(word) {
    const o = { cwd, env, timeout: TIMEOUT };
    try {
      return await run(grepArgs(word, true), o);
    } catch (e) {
      if (!NOT_REPO.test(String((e && e.stderr) || ''))) throw e;
      return run(grepArgs(word, false), o);
    }
  }

  /**
   * @param {{word: string, from?: string, line?: number}} q `from` il file del click, `line` la sua riga
   * @returns {Promise<{ok: true, results: Array<{rel: string, line: number, column: number, text: string, strong: boolean}>}
   *   | {ok: false, reason: 'invalid'|'no-git'|'error', error?: string}>}
   */
  async function find({ word, from, line } = {}) {
    if (!validSymbol(word)) return { ok: false, reason: 'invalid' };
    let out;
    try {
      out = await grep(word);
    } catch (e) {
      if (e && e.missing) return { ok: false, reason: 'no-git' };
      if (e && e.code === 1 && !String(e.stderr || '').trim()) return { ok: true, results: [] }; // nessuna riga
      return { ok: false, reason: 'error', error: firstLine(e) };
    }
    const found = parseGrep(out).flatMap((hit) => {
      const d = definitionAt(hit.text, word);
      return d ? [{ ...hit, ...d }] : [];
    });
    const fromRel = safeRel(from);
    const results = rankDefinitions(found, { rel: fromRel || null, line: Number.isInteger(line) ? line : 0 })
      .map(({ rel, line: l, column, text, strong }) => ({ rel, line: l, column, text, strong }));
    return { ok: true, results };
  }

  return { find };
}

module.exports = { validSymbol, definitionAt, parseGrep, rankDefinitions, createEditorDefinition, MAX_RESULTS };
