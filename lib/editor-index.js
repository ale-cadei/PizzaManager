'use strict';
/* Il progetto visto tutto insieme, per la scheda editor (docs/plans/75):
 * l'elenco piatto dei file per «Vai al file» (Ctrl+P) e le lettere git
 * (M/U/A/D) per l'albero. Percorsi relativi alla cartella della scheda, con
 * `/`, come quelli che il renderer manda a lib/editor-fs.js.
 *
 * In un repository decide git: `ls-files` dà tracciati e nuovi senza gli
 * ignorati, `status` le lettere. Fuori da git l'elenco si legge dal disco
 * saltando .git e node_modules, e le lettere non ci sono. Sempre runGit:
 * execFile con argv, mai la shell. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');
const { createEditorFs } = require('./editor-fs');

const MAX_LIST = 20000;
const TIMEOUT = 10000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const splitNul = (text) => String(text).split('\0').filter(Boolean);
const errorText = (e) => String((e && e.message) || e);

/** Le voci di `git status --porcelain=v1 -z`: XY, spazio, percorso; le rinomine aggiungono il vecchio. */
function parsePorcelain(text) {
  const parts = String(text).split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const xy = p.slice(0, 2);
    out.push({ xy, path: p.slice(3) });
    if (xy[0] === 'R' || xy[0] === 'C') i += 1; // il percorso di prima
  }
  return out;
}

/** Una lettera per la riga dell'albero. Un conflitto (UU, AA, DD…) conta come modificato. */
function letterOf(xy) {
  const [x, y] = xy;
  if (xy === '??') return 'U';
  if (x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD') return 'M';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'A' || x === 'R' || x === 'C') return 'A';
  return 'M';
}

/* Fuori da git: la cartella letta in ampiezza, senza seguire i symlink
   (niente giri infiniti), fino a `max` file. */
async function walk(root, max) {
  const files = [];
  const queue = [''];
  while (queue.length) {
    const dir = queue.shift();
    let dirents;
    try {
      dirents = await fs.promises.readdir(path.join(root, ...dir.split('/').filter(Boolean)), { withFileTypes: true });
    } catch {
      continue; // una cartella illeggibile non ferma l'elenco
    }
    for (const d of dirents) {
      const rel = dir ? `${dir}/${d.name}` : d.name;
      if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) queue.push(rel); continue; }
      if (files.length >= max) return { files, truncated: true };
      files.push(rel);
    }
  }
  return { files, truncated: false };
}

/**
 * @param {{root: string, run?: Function, max?: number}} o
 * @returns {Promise<{ok: true, files: string[], truncated: boolean} | {ok: false, error: string}>}
 */
async function listAllFiles({ root, run = runGit, max = MAX_LIST } = {}) {
  let realRoot;
  try {
    realRoot = createEditorFs({ root }).realRoot;
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
  try {
    const out = await run(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: realRoot, timeout: TIMEOUT });
    const all = [...new Set(splitNul(out))]; // un file in conflitto compare una volta per stadio
    return { ok: true, files: all.slice(0, max), truncated: all.length > max };
  } catch {
    // Fuori da un repository, o git assente: si legge la cartella
    return { ok: true, ...(await walk(realRoot, max)) };
  }
}

/**
 * @param {{root: string, run?: Function}} o
 * @returns {Promise<{ok: true, status: Object<string, 'M'|'U'|'A'|'D'>} | {ok: false, error: string}>}
 *   fuori da un repository `status` è vuoto
 */
async function gitStatusLetters({ root, run = runGit } = {}) {
  let realRoot;
  try {
    realRoot = createEditorFs({ root }).realRoot;
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
  try {
    // status dà i percorsi dalla radice del repository: si tiene solo quel che sta sotto la scheda
    const prefix = String(await run(['rev-parse', '--show-prefix'], { cwd: realRoot, timeout: TIMEOUT })).trim();
    const out = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: realRoot, timeout: TIMEOUT });
    const status = {};
    for (const { xy, path: p } of parsePorcelain(out)) {
      if (p.startsWith(prefix) && p.length > prefix.length) status[p.slice(prefix.length)] = letterOf(xy);
    }
    return { ok: true, status };
  } catch (e) {
    if (e && (e.missing || /not a git repository/i.test(String(e.stderr || '')))) return { ok: true, status: {} };
    return { ok: false, error: errorText(e) };
  }
}

module.exports = { listAllFiles, gitStatusLetters, letterOf, parsePorcelain, MAX_LIST };
