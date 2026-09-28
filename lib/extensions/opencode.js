'use strict';
/* opencode: plugin come file locali (plugin/ o plugins/ nella cartella di
 * configurazione) o pacchetti npm (chiave `plugin` di opencode.json/.jsonc).
 * Le skill le cerca anche nelle cartelle di Claude e di .agents. Nel progetto
 * aperto: .opencode/ e opencode.json(c) alla radice (docs/plans/30). */
const path = require('path');
const { readText, readHead, filesWith, clip, itemDirs, MAX_ITEMS, MAX_NAME, MAX_DESC } = require('./common');

const PLUGIN_EXTS = ['.js', '.mjs', '.cjs', '.ts'];

/** JSON con commenti (// e /* *\/), senza toccare le stringhe. */
function stripJsonComments(text) {
  const src = String(text || '');
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += src[++i] || ''; } else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true; out += ch;
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** La prima riga del commento in cima al file: è lì che un plugin si presenta. */
function firstComment(text) {
  const src = String(text || '').replace(/^#!.*\n/, '');
  const m = /^\s*(?:\/\*([\s\S]*?)\*\/|((?:[ \t]*\/\/.*(?:\r?\n|$))+))/.exec(src);
  if (!m) return '';
  const lines = (m[1] || m[2]).split(/\r?\n/).map((l) => l.replace(/^\s*(\*+|\/\/+)\s?/, '').trim());
  return lines.find(Boolean) || '';
}

async function readConfig(dir) {
  const specs = [];
  for (const name of ['opencode.json', 'opencode.jsonc']) {
    const text = await readText(path.join(dir, name));
    if (text === null) continue;
    try {
      const data = JSON.parse(stripJsonComments(text));
      if (data && Array.isArray(data.plugin)) specs.push(...data.plugin.filter((p) => typeof p === 'string'));
    } catch { /* config illeggibile: nessun plugin npm da mostrare */ }
  }
  return [...new Set(specs)].slice(0, MAX_ITEMS);
}

const plugin = (name, description, scope) => ({
  id: clip(name, MAX_NAME), name: clip(name, MAX_NAME), marketplace: '', version: '',
  description: clip(description, MAX_DESC), enabled: null, scope, missing: false, items: [],
});

async function localPlugins(dir, scope = 'file locale') {
  const out = [];
  for (const sub of ['plugin', 'plugins']) {
    for (const f of await filesWith(path.join(dir, sub), PLUGIN_EXTS)) {
      out.push(plugin(path.basename(f, path.extname(f)), firstComment(await readHead(path.join(dir, sub, f))), scope));
    }
  }
  return out;
}

/* Le cartelle di skill di una radice: la sua cartella di opencode, più quelle
   di Claude e di .agents che opencode legge comunque */
const skillSpecs = (ocDir, base) => [
  [path.join(ocDir, 'skill')], [path.join(ocDir, 'skills')],
  [path.join(base, '.claude', 'skills')], [path.join(base, '.agents', 'skills')],
];

async function projectPart(project, home) {
  if (!project) return { plugins: [], skillDirs: [] };
  const ocDir = path.join(project, '.opencode');
  const specs = [...await readConfig(project), ...await readConfig(ocDir)];
  return {
    plugins: [
      ...await localPlugins(ocDir, 'progetto'),
      ...[...new Set(specs)].map((spec) => plugin(spec, '', 'pacchetto npm del progetto')),
    ],
    skillDirs: await itemDirs(skillSpecs(ocDir, project), home, { project: true }),
  };
}

async function readOpencode({ home, env = {}, project = null }) {
  const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
  const local = await projectPart(project, home);
  const plugins = [
    ...local.plugins,
    ...await localPlugins(dir),
    ...(await readConfig(dir)).map((spec) => plugin(spec, '', 'pacchetto npm')),
  ];
  const skillDirs = [...local.skillDirs, ...await itemDirs(skillSpecs(dir, home), home)];
  return { plugins, skillDirs };
}

module.exports = { readOpencode, stripJsonComments, firstComment };
