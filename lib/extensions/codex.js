'use strict';
/* Codex: plugin dichiarati in config.toml ([plugins."nome@mkt"]) e quelli
 * scaricati in plugins/cache/<mkt>/<nome>/<versione>. Si mostrano entrambi:
 * uno può esserci senza l'altro. */
const fs = require('fs');
const path = require('path');
const { readText, subdirs, itemDirs, pluginInfo } = require('./common');

const HEADER = /^\s*\[(.+)\]\s*$/;
const PLUGIN = /^plugins\."([^"]+)"$/;
const ENABLED = /^\s*enabled\s*=\s*(true|false)\b/;

/** Solo le tabelle [plugins."…"] e il loro `enabled`: niente parser TOML. */
function parseCodexPlugins(toml) {
  const map = new Map();
  let current = null;
  for (const line of String(toml || '').split(/\r?\n/)) {
    const h = HEADER.exec(line);
    if (h) {
      const m = PLUGIN.exec(h[1].trim());
      current = m ? m[1] : null;
      if (current) map.set(current, null);
      continue;
    }
    const e = current && ENABLED.exec(line);
    if (e) map.set(current, e[1] === 'true');
  }
  return map;
}

/* La versione toccata più di recente: le vecchie restano in cache */
async function latestVersion(dir) {
  const versions = await subdirs(dir);
  const dated = await Promise.all(versions.map(async (v) => {
    try { return { v, t: (await fs.promises.stat(path.join(dir, v))).mtimeMs }; } catch { return { v, t: 0 }; }
  }));
  dated.sort((a, b) => b.t - a.t);
  return dated.length ? dated[0].v : null;
}

/** id → { dir, version } dei plugin in cache */
async function cachedPlugins(cache) {
  const found = new Map();
  for (const mkt of await subdirs(cache)) {
    for (const name of await subdirs(path.join(cache, mkt))) {
      const base = path.join(cache, mkt, name);
      const version = await latestVersion(base);
      if (version) found.set(`${name}@${mkt}`, { dir: path.join(base, version), version });
    }
  }
  return found;
}

async function readCodex({ home, project = null }) {
  const root = path.join(home, '.codex');
  const config = parseCodexPlugins(await readText(path.join(root, 'config.toml')));
  const cached = await cachedPlugins(path.join(root, 'plugins', 'cache'));
  const ids = [...new Set([...config.keys(), ...cached.keys()])];
  const plugins = await Promise.all(ids.map((id) => {
    const c = cached.get(id) || { dir: null, version: '' };
    return pluginInfo({ id, dir: c.dir, version: c.version, enabled: config.has(id) ? config.get(id) : null, scope: null });
  }));
  const skillDirs = [
    ...(project ? await itemDirs([[path.join(project, '.agents', 'skills')]], home, { project: true }) : []),
    ...await itemDirs([[path.join(root, 'skills')], [path.join(home, '.agents', 'skills')]], home),
  ];
  return { plugins, skillDirs };
}

module.exports = { readCodex, parseCodexPlugins };
