/* Di quale account Claude chiedere la quota (docs/plans/35-quota-per-profilo.md).
 *
 * L'account lo decide la config dir, e la config dir la stessa catena che usa
 * lo spawn (app/pty.js, lib/commands.js): CLAUDE_CONFIG_DIR del profilo di
 * comando, poi quella dell'ambiente dell'app, poi nessuna. "Nessuna" non vuol
 * dire ~/.claude: e' la voce senza suffisso del Keychain, un login a parte.
 *
 * La scheda arriva dal renderer: si leggono solo id stringa, e la config dir
 * la ricava il main dallo store dei profili, mai un path spedito da fuori.
 */
'use strict';
const os = require('os');
const { listProfiles, findProfile, resolveProfileCommand } = require('../command-profiles');

const MAX_ID_LEN = 200;

const idOf = (v) => (typeof v === 'string' && v && v.length <= MAX_ID_LEN ? v : null);

/* Stessa scelta di buildCommand: senza id vince il primo profilo Claude;
   con un id che non esiste piu' nessun profilo, e decide l'ambiente. */
function pickProfile(profiles, profileId) {
  try {
    const cfg = profiles ? profiles.load() : null;
    return profileId ? findProfile(cfg, 'claude', profileId) : (listProfiles(cfg, 'claude')[0] || null);
  } catch {
    return null;
  }
}

/**
 * @param {{ tab?: {type?:string, commandProfileId?:string, claudeAccountId?:string}|null,
 *           profiles?: {load: Function}|null, env?: object, home?: string, platform?: string }} opts
 * @returns {{configDir: string|null}|null} null quando la scheda usa una chiave
 *   API: per quella non esiste una quota a 5 ore
 */
function claudeQuotaTarget({
  tab = null, profiles = null, env = process.env, home = os.homedir(), platform = process.platform,
} = {}) {
  const isClaudeTab = Boolean(tab && tab.type === 'claude');
  const accountId = isClaudeTab ? idOf(tab.claudeAccountId) : null;
  if (accountId && accountId !== 'oauth') return null;

  const profile = pickProfile(profiles, isClaudeTab ? idOf(tab.commandProfileId) : null);
  const resolved = profile ? resolveProfileCommand(profile, { home, env, platform }) : null;
  const fromProfile = resolved && resolved.ok ? resolved.env.CLAUDE_CONFIG_DIR : null;
  return { configDir: fromProfile || (env && env.CLAUDE_CONFIG_DIR) || null };
}

module.exports = { claudeQuotaTarget };
