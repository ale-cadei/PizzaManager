'use strict';
const os = require('os');
const commandProfiles = require('./command-profiles');
const { resolveBinary, isExecutable } = require('./binaries');

const INSTALL_HINTS = {
  opencode: 'Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode',
  claude: 'Installa con: npm i -g @anthropic-ai/claude-code, oppure verifica il percorso (nvm: ~/.nvm/versions/node/*/bin/claude)',
  codex: 'Installa con: npm i -g @openai/codex (oppure brew install codex)',
};


/**
 * Gli alias di shell (~/.zshrc, ~/.bashrc) esistono solo dentro una shell
 * interattiva: pty.spawn lancia il binario direttamente, quindi non li vede
 * mai. Caso tipico: `alias claudep="CLAUDE_CONFIG_DIR=… claude"`.
 */
function aliasHint(name) {
  return `\nSe '${name}' è un alias della shell (~/.zshrc, ~/.bashrc) non può funzionare: `
    + 'il comando viene eseguito senza shell. Riscrivilo per esteso nel profilo, '
    + 'es. CLAUDE_CONFIG_DIR=~/.claude-personal claude';
}

/**
 * Comando da lanciare nel pty per un tipo di sessione.
 * `profileId` seleziona uno dei comandi configurati; senza id vince il primo.
 *
 * Restituisce { cmd, args, profileEnv, resolvedVia, profile } oppure, in caso
 * di errore, { cmd: null, error } o { cmd: null, missing, searchedPath }.
 */
function buildCommand(type, resumeId, profileId, { profiles, home = os.homedir(), env = process.env } = {}) {
  if (!profiles) throw new Error('buildCommand richiede lo store dei profili');
  const cfg = profiles.load();
  const list = commandProfiles.listProfiles(cfg, type);
  if (!list.length) return { cmd: null, args: [], error: `Nessun comando configurato per il tipo '${type}'.` };
  const profile = profileId ? commandProfiles.findProfile(cfg, type, profileId) : list[0];
  if (!profile) {
    return { cmd: null, args: [], error: 'Il comando scelto non esiste più: riaprilo da File → Configurazione comandi.' };
  }

  const r = commandProfiles.resolveProfileCommand(profile, { resumeId, home, env });
  if (!r.ok) return { cmd: null, args: [], error: `"${profile.label}": ${r.error}` };
  if (resumeId && !r.resumeApplied) {
    return {
      cmd: null,
      args: [],
      error: `"${profile.label}" non supporta il resume: aggiungi gli argomenti di resume (es. --resume {id}) in File → Configurazione comandi.`,
    };
  }

  // Percorso esplicito: usato così com'è. Nome nudo: risolto nel PATH.
  if (r.bin.includes('/')) {
    if (!isExecutable(r.bin)) return { cmd: null, args: [], error: `"${profile.label}": ${r.bin} non è un eseguibile valido.` };
    return { cmd: r.bin, args: r.args, profileEnv: r.env, resolvedVia: 'path-esplicito', profile };
  }
  const rb = resolveBinary(r.bin);
  if (!rb.path) return { cmd: null, args: [], missing: r.bin, searchedPath: rb.searchedPath, profile };
  return { cmd: rb.path, args: r.args, profileEnv: r.env, resolvedVia: rb.via, profile };
}

/** Suggerimento mostrato quando un binario non e' nel PATH: installazione + nota sugli alias. */
function installHint(name) {
  return (INSTALL_HINTS[name] || `Verifica che '${name}' sia installato e nel PATH.`) + aliasHint(name);
}

module.exports = { buildCommand, installHint, aliasHint, INSTALL_HINTS };
