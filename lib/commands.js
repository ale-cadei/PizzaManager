'use strict';
const { getDefaultShell } = require('./shell');
const { resolveBinary } = require('./binaries');

/**
 * Come ogni CLI riprende una sessione esistente, e cosa suggerire se manca.
 * Aggiungere un tipo di sessione significa aggiungere una voce qui.
 */
const AI_COMMANDS = {
  opencode: {
    resumeArgs: (id) => ['--session', id],
    installHint: 'Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode',
  },
  claude: {
    resumeArgs: (id) => ['--resume', id],
    installHint: 'Installa con: npm i -g @anthropic-ai/claude-code, oppure verifica il percorso (nvm: ~/.nvm/versions/node/*/bin/claude)',
  },
  codex: {
    // `codex resume <SESSION_ID>` riapre il rollout indicato
    resumeArgs: (id) => ['resume', id],
    installHint: 'Installa con: npm i -g @openai/codex (oppure brew install codex)',
  },
};

function installHint(name) {
  const spec = AI_COMMANDS[name];
  return (spec && spec.installHint) || `Verifica che '${name}' sia installato e nel PATH.`;
}

/**
 * Comando da lanciare nel pty per un tipo di sessione.
 * Un tipo sconosciuto ricade sulla shell, come faceva l'originale.
 */
function buildCommand(type, resumeId, { platform = process.platform } = {}) {
  const spec = AI_COMMANDS[type];
  if (!spec) {
    return { cmd: getDefaultShell(platform), args: platform !== 'win32' ? ['-i'] : [] };
  }
  const r = resolveBinary(type);
  if (!r.path) return { cmd: null, args: [], missing: type, searchedPath: r.searchedPath };
  return { cmd: r.path, args: resumeId ? spec.resumeArgs(resumeId) : [], resolvedVia: r.via };
}

module.exports = { AI_COMMANDS, buildCommand, installHint };
