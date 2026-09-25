'use strict';
const os = require('os');
const commandProfiles = require('./command-profiles');
const { resolveBinary, isExecutable } = require('./binaries');
const { needsCmdWrapper, windowsCommandLine } = require('./win-command');

/* Un nome nudo si cerca nel PATH; tutto il resto e' un percorso da usare
   com'e'. Su Windows conta anche il backslash e la lettera di unita'. */
function isExplicitPath(bin) {
  return bin.includes('/') || bin.includes('\\') || /^[A-Za-z]:/.test(bin);
}

/**
 * Su Windows un `.cmd`/`.bat` non e' un eseguibile ma uno script di cmd.exe:
 * si lancia cmd.exe con la riga di comando gia' composta (lib/win-command.js).
 * `args` resta leggibile per la cronologia; `commandLine` e' cio' che node-pty
 * deve ricevere al posto dell'argv.
 */
function wrapForPlatform(cmd, args, platform, env) {
  if (platform !== 'win32' || !needsCmdWrapper(cmd)) return { cmd, args };
  const commandLine = windowsCommandLine(cmd, args);
  return { cmd: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', [cmd, ...args].join(' ')], commandLine, wrapped: cmd };
}

/* Codex di default disegna nell'alternate screen e chiede ?1007 invece del
   mouse: la rotella diventa freccia su/giu', e le frecce nel suo prompt
   sfogliano i messaggi gia' inviati invece di scorrere la chat. Inline la
   conversazione resta nella schermata normale e finisce nella history di tmux
   (o di xterm, senza tmux), che la rotella scorre. Si aggiunge al lancio e non
   nel profilo di default: i profili gia' salvati dicono solo `codex`.
   docs/plans/28-rotella-codex.md */
const CODEX_INLINE_FLAG = '--no-alt-screen';

function withInlineFlag(type, args) {
  if (type !== 'codex' || args.includes(CODEX_INLINE_FLAG)) return args;
  return [...args, CODEX_INLINE_FLAG];
}

const INSTALL_HINTS = {
  opencode: 'Installa da https://opencode.ai o verifica ~/.opencode/bin/opencode',
  claude: 'Installa con: npm i -g @anthropic-ai/claude-code, oppure verifica il percorso (nvm: ~/.nvm/versions/node/*/bin/claude)',
  codex: 'Installa con: npm i -g @openai/codex (oppure brew install codex)',
  agy: 'Installa Antigravity CLI da https://antigravity.google, poi esegui `agy install` per metterlo nel PATH',
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
function buildCommand(type, resumeId, profileId, { profiles, home = os.homedir(), env = process.env, platform = process.platform, resolve = resolveBinary } = {}) {
  if (!profiles) throw new Error('buildCommand richiede lo store dei profili');
  const cfg = profiles.load();
  const list = commandProfiles.listProfiles(cfg, type);
  if (!list.length) return { cmd: null, args: [], error: `Nessun comando configurato per il tipo '${type}'.` };
  const profile = profileId ? commandProfiles.findProfile(cfg, type, profileId) : list[0];
  if (!profile) {
    return { cmd: null, args: [], error: 'Il comando scelto non esiste più: riaprilo da File → Configurazione comandi.' };
  }

  const r = commandProfiles.resolveProfileCommand(profile, { resumeId, home, env, platform });
  if (!r.ok) return { cmd: null, args: [], error: `"${profile.label}": ${r.error}` };
  if (resumeId && !r.resumeApplied) {
    return {
      cmd: null,
      args: [],
      error: `"${profile.label}" non supporta il resume: aggiungi gli argomenti di resume (es. --resume {id}) in File → Configurazione comandi.`,
    };
  }

  const args = withInlineFlag(type, r.args);
  // Percorso esplicito: usato così com'è. Nome nudo: risolto nel PATH.
  if (isExplicitPath(r.bin)) {
    if (!isExecutable(r.bin, { platform })) return { cmd: null, args: [], error: `"${profile.label}": ${r.bin} non è un eseguibile valido.` };
    return { ...wrapForPlatform(r.bin, args, platform, env), profileEnv: r.env, resolvedVia: 'path-esplicito', profile };
  }
  const rb = resolve(r.bin, { platform, env, home });
  if (!rb.path) return { cmd: null, args: [], missing: r.bin, searchedPath: rb.searchedPath, profile };
  return { ...wrapForPlatform(rb.path, args, platform, env), profileEnv: r.env, resolvedVia: rb.via, profile };
}

/** Suggerimento mostrato quando un binario non e' nel PATH: installazione + nota sugli alias. */
function installHint(name) {
  return (INSTALL_HINTS[name] || `Verifica che '${name}' sia installato e nel PATH.`) + aliasHint(name);
}

module.exports = { buildCommand, installHint, aliasHint, isExplicitPath, INSTALL_HINTS };
