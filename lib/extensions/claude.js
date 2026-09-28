'use strict';
/* Claude Code: plugin da installed_plugins.json (che dice dove sta ognuno),
 * stato da enabledPlugins in settings.json, skill e comandi dell'utente e,
 * se c'è un progetto aperto, quelli del progetto (docs/plans/30). */
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

async function enabledIn(file) {
  const settings = await readJson(file);
  return settings && settings.enabledPlugins && typeof settings.enabledPlugins === 'object' ? settings.enabledPlugins : {};
}

/* Come Claude: le impostazioni del progetto vincono su quelle dell'utente,
   settings.local.json vince su settings.json */
async function enabledPlugins(home, project) {
  const files = [path.join(home, '.claude', 'settings.json')];
  if (project) files.push(path.join(project, '.claude', 'settings.json'), path.join(project, '.claude', 'settings.local.json'));
  const maps = await Promise.all(files.map(enabledIn));
  return Object.assign({}, ...maps);
}

async function readClaude({ home, project = null }) {
  const root = path.join(home, '.claude');
  const installed = await readJson(path.join(root, 'plugins', 'installed_plugins.json'));
  const enabledMap = await enabledPlugins(home, project);
  const plugins = await Promise.all(installations(installed).map(({ id, install }) => pluginInfo({
    id,
    dir: typeof install.installPath === 'string' ? install.installPath : null,
    version: typeof install.version === 'string' ? install.version : '',
    enabled: typeof enabledMap[id] === 'boolean' ? enabledMap[id] : null,
    scope: scopeOf(install, home),
  })));
  const dirsOf = (base) => [[path.join(base, 'skills'), 'skill'], [path.join(base, 'commands'), 'command']];
  const skillDirs = [
    ...(project ? await itemDirs(dirsOf(path.join(project, '.claude')), home, { project: true }) : []),
    ...await itemDirs(dirsOf(root), home),
  ];
  return { plugins, skillDirs };
}

module.exports = { readClaude };
