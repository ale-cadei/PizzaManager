'use strict';
/* Letture su disco condivise dai tre CLI. Ogni lettura che fallisce vale
 * "niente": un file mancante o illeggibile non deve svuotare la finestra. */
const fs = require('fs');
const path = require('path');
const { describe } = require('./frontmatter');

const HEAD_BYTES = 16 * 1024;
const MAX_ITEMS = 1000;
const MAX_NAME = 120;
const MAX_DESC = 400;

/** I primi byte di un file: di una skill servono frontmatter e prima riga. */
async function readHead(file, bytes = HEAD_BYTES) {
  let fh = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function readText(file) {
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return null; }
}

async function readJson(file) {
  const text = await readText(file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function isDir(p) {
  try { return (await fs.promises.stat(p)).isDirectory(); } catch { return false; }
}

/* Voci di una cartella che passano `keep` (i link si seguono), in ordine alfabetico */
async function entries(dir, keep) {
  let names;
  try { names = await fs.promises.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (name.startsWith('.')) continue;
    try {
      if (keep(await fs.promises.stat(path.join(dir, name)), name)) out.push(name);
    } catch { /* link rotto */ }
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

const subdirs = (dir) => entries(dir, (st) => st.isDirectory());
const filesWith = (dir, exts) => entries(dir, (st, name) => st.isFile() && exts.includes(path.extname(name)));

/** Testo su una riga, al massimo `n` caratteri. */
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

const item = (name, description, kind) => ({ name: clip(name, MAX_NAME), description: clip(description, MAX_DESC), kind });

/** Le skill di una cartella: una sottocartella con SKILL.md ciascuna. */
async function skillsIn(dir) {
  const out = [];
  for (const d of await subdirs(dir)) {
    const text = await readHead(path.join(dir, d, 'SKILL.md'));
    if (text === null) continue;
    const meta = describe(text);
    out.push(item(meta.name || d, meta.description, 'skill'));
  }
  return out;
}

/** I comandi di una cartella: un .md ciascuno, il nome è quello del file. */
async function commandsIn(dir) {
  const out = [];
  for (const f of await filesWith(dir, ['.md'])) {
    const text = await readHead(path.join(dir, f));
    if (text !== null) out.push(item(path.basename(f, '.md'), describe(text).description, 'command'));
  }
  return out;
}

/** "~/..." per i percorsi sotto la home: più corti e senza il nome utente. */
function tildify(p, home) {
  if (home && (p === home || p.startsWith(home + path.sep))) return '~' + p.slice(home.length);
  return p;
}

/** Una cartella di skill (o comandi) da mostrare, solo se esiste. */
async function itemDir(dir, home, kind = 'skill') {
  if (!(await isDir(dir))) return null;
  return { dir: tildify(dir, home), items: kind === 'command' ? await commandsIn(dir) : await skillsIn(dir) };
}

async function itemDirs(specs, home) {
  const dirs = await Promise.all(specs.map(([dir, kind]) => itemDir(dir, home, kind)));
  return dirs.filter(Boolean);
}

/* Manifest Claude o Codex; senza, la descrizione del package.json (non il
   nome: sarebbe quello del pacchetto npm, non del plugin) */
async function manifestOf(dir) {
  for (const sub of ['.claude-plugin', '.codex-plugin']) {
    const m = await readJson(path.join(dir, sub, 'plugin.json'));
    if (m && typeof m === 'object') return m;
  }
  const pkg = await readJson(path.join(dir, 'package.json'));
  return pkg && typeof pkg === 'object' ? { description: pkg.description } : {};
}

/**
 * Un plugin: manifest (formato Claude o Codex), skill e comandi.
 * @param {{id: string, dir: string|null, version?: string, enabled: boolean|null, scope: string|null}} o
 */
async function pluginInfo({ id, dir, version = '', enabled, scope }) {
  // Claude scrive "unknown" quando il plugin non dichiara la versione
  const known = (v) => (typeof v === 'string' && v && v !== 'unknown' ? v : '');
  const at = id.lastIndexOf('@');
  const present = Boolean(dir) && (await isDir(dir));
  const m = present ? await manifestOf(dir) : {};
  const items = present
    ? [...await skillsIn(path.join(dir, 'skills')), ...await commandsIn(path.join(dir, 'commands'))]
    : [];
  return {
    id: clip(id, MAX_NAME),
    name: clip(typeof m.name === 'string' && m.name ? m.name : (at > 0 ? id.slice(0, at) : id), MAX_NAME),
    marketplace: clip(at > 0 ? id.slice(at + 1) : '', MAX_NAME),
    version: clip(known(m.version) || known(version), 40),
    description: clip(typeof m.description === 'string' ? m.description : '', MAX_DESC),
    enabled,
    scope,
    missing: !present,
    items,
  };
}

module.exports = {
  readHead, readText, readJson, isDir, subdirs, filesWith, clip, tildify, itemDirs, pluginInfo,
  MAX_ITEMS, MAX_NAME, MAX_DESC,
};
