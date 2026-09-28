'use strict';
/* Claude Code: plugin da installed_plugins.json (che dice dove sta ognuno),
 * stato da enabledPlugins in settings.json, skill e comandi dell'utente. */
const path = require('path');
const { readJson, tildify, itemDirs, pluginInfo, MAX_ITEMS } = require('./common');

/* v2: id → lista di installazioni (una per ambito); v1: id → installazione */
function installations(installed) {
  const map = installed && installed.plugins && typeof installed.plugins === 'object' ? installed.plugins : {};
  return Object.entries(map).slice(0, MAX_ITEMS).map(([id, v]) => {
    const list = (Array.isArray(v) ? v : [v]).filter((e) => e && typeof e === 'object');
    return { id, install: list.find((e) => e.scope === 'user') || list[0] || {} };
  });
}

/* Installato solo per un progetto: vale lì, non dappertutto */
function scopeOf(install, home) {
  if (!install.scope || install.scope === 'user') return null;
  return typeof install.projectPath === 'string' ? `solo in ${tildify(install.projectPath, home)}` : `ambito ${install.scope}`;
}

async function readClaude({ home }) {
  const root = path.join(home, '.claude');
  const installed = await readJson(path.join(root, 'plugins', 'installed_plugins.json'));
  const settings = await readJson(path.join(root, 'settings.json'));
  const enabledMap = settings && settings.enabledPlugins && typeof settings.enabledPlugins === 'object' ? settings.enabledPlugins : {};
  const plugins = await Promise.all(installations(installed).map(({ id, install }) => pluginInfo({
    id,
    dir: typeof install.installPath === 'string' ? install.installPath : null,
    version: typeof install.version === 'string' ? install.version : '',
    enabled: typeof enabledMap[id] === 'boolean' ? enabledMap[id] : null,
    scope: scopeOf(install, home),
  })));
  const skillDirs = await itemDirs([[path.join(root, 'skills'), 'skill'], [path.join(root, 'commands'), 'command']], home);
  return { plugins, skillDirs };
}

module.exports = { readClaude };
