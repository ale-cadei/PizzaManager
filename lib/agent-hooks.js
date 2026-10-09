'use strict';
/**
 * Hook degli agenti iniettati per processo (docs/plans/46).
 *
 * Mai nella config dell'utente: Claude li riceve con `--settings` (si sommano
 * ai suoi), opencode con un plugin in OPENCODE_CONFIG_CONTENT (unito alla sua
 * config), Codex non ha hook iniettabili (li salta finché l'utente non li
 * approva) e manda invece OSC 9 nel terminale. Antigravity: niente, resta
 * l'euristica. Se il profilo dell'utente usa già lo stesso canale, si rinuncia.
 */
const path = require('path');
const { pathToFileURL } = require('url');

const SIGNAL_ENV = 'AISESS_SIGNAL_FILE';
const NOTHING = Object.freeze({ args: [], env: {}, exact: false });

function writeCommand(state, platform) {
  if (platform === 'win32') {
    return { type: 'command', shell: 'powershell', command: `Set-Content -NoNewline -LiteralPath $env:${SIGNAL_ENV} -Value ${state}` };
  }
  return { type: 'command', command: `printf ${state} > "$${SIGNAL_ENV}"` };
}

/** JSON per `claude --settings`. L'evento si sa da quale hook scatta: niente stdin. */
function claudeSettings({ platform = process.platform } = {}) {
  const on = (state, matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [writeCommand(state, platform)] }];
  return JSON.stringify({
    hooks: {
      SessionStart: on('ready'),
      UserPromptSubmit: on('running'),
      PreToolUse: on('running'),
      PostToolUse: on('running'),
      Notification: on('permission', 'permission_prompt|elicitation_dialog'),
      Stop: on('waiting'),
      StopFailure: on('waiting'),
    },
  });
}

/* Gira dentro opencode (Bun). Un errore qui non deve mai rompere opencode:
   è l'unico punto in cui un errore si tace, perché non c'è un nostro log. */
function opencodePluginSource() {
  return `// Scritto da PizzaManager (docs/plans/46): stato della sessione per la sua card.
import { writeFileSync } from 'node:fs';
const write = (state) => {
  const file = process.env.${SIGNAL_ENV};
  if (!file) return;
  try { writeFileSync(file, state); } catch {}
};
const STATES = {
  'permission.updated': 'permission',
  'question.asked': 'permission',
  'permission.replied': 'running',
  'question.replied': 'running',
  'question.rejected': 'running',
};
export default async () => {
  write('ready');
  return {
    event: async ({ event }) => {
      if (!event) return;
      if (event.type === 'session.status') {
        const t = event.properties && event.properties.status && event.properties.status.type;
        if (t === 'idle') write('waiting');
        else if (t === 'busy' || t === 'retry') write('running');
        return;
      }
      if (STATES[event.type]) write(STATES[event.type]);
    },
  };
};
`;
}

const CODEX_ARGS = Object.freeze(['-c', 'tui.notifications=true', '-c', 'tui.notification_method=osc9', '-c', 'tui.notification_condition=always']);
function fileUrl(p, platform) {
  if (platform === 'win32') return 'file:///' + path.win32.resolve(p).replace(/\\/g, '/');
  return pathToFileURL(p).href;
}

const hasFlag = (args, flag) => (args || []).some((a) => a === flag || String(a).startsWith(flag + '='));

/**
 * @returns {{args: string[], env: Record<string,string>, exact: boolean}} da AGGIUNGERE ad args/env
 */
function injectFor(type, { pluginPath, platform = process.platform, args = [], env = {} } = {}) {
  if (type === 'claude') {
    if (hasFlag(args, '--settings')) return NOTHING;
    return { args: ['--settings', claudeSettings({ platform })], env: {}, exact: true };
  }
  if (type === 'opencode') {
    if (!pluginPath || env.OPENCODE_CONFIG_CONTENT) return NOTHING;
    return { args: [], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [fileUrl(pluginPath, platform)] }) }, exact: true };
  }
  if (type === 'codex') return { args: [...CODEX_ARGS], env: {}, exact: true };
  return NOTHING;
}

module.exports = { injectFor, claudeSettings, opencodePluginSource, CODEX_ARGS, SIGNAL_ENV };
