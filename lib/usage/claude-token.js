/* Dove sta il token OAuth di Claude Code (docs/plans/35-quota-per-profilo.md).
 *
 * - macOS: nel Keychain, una voce per config dir. Senza CLAUDE_CONFIG_DIR il
 *   servizio e' `Claude Code-credentials`; con la variabile gli si aggiunge
 *   `-` e i primi 8 caratteri dello sha256 del path. Conta la *presenza* della
 *   variabile: `CLAUDE_CONFIG_DIR=~/.claude` ha una voce sua, diversa dal
 *   default.
 * - Linux e Windows: `<config dir>/.credentials.json`. Su macOS e' il ripiego
 *   quando il Keychain non ha niente.
 *
 * Il token non esce da qui se non come valore di ritorno: niente log, e un
 * errore non porta mai con se' l'output di `security`.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const SERVICE = 'Claude Code-credentials';
const HASH_CHARS = 8;
const TIMEOUT_MS = 5000;
const MIN_TOKEN_LEN = 20;

const execFileAsync = promisify(execFile);

/** Nome della voce del Keychain per una config dir (null = nessuna variabile). */
function keychainService(configDir) {
  if (!configDir) return SERVICE;
  const hash = crypto.createHash('sha256').update(configDir).digest('hex').slice(0, HASH_CHARS);
  return `${SERVICE}-${hash}`;
}

/* `security -w` stampa il segreto cosi' com'e', o in esadecimale se non lo
   considera testo stampabile: si accettano entrambe le forme. */
function decodeSecret(stdout) {
  const s = String(stdout || '').trim();
  if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0) return Buffer.from(s, 'hex').toString('utf8');
  return s;
}

/* Il JSON lo scrive un altro programma: puo' cambiare forma dopo un
   aggiornamento. Qualunque stranezza vale "niente token". */
function tokenFromJson(text) {
  try {
    const raw = JSON.parse(text);
    const oauth = raw && typeof raw === 'object' ? raw.claudeAiOauth : null;
    const token = oauth && typeof oauth.accessToken === 'string' ? oauth.accessToken : '';
    return token.length > MIN_TOKEN_LEN ? token : null;
  } catch {
    return null;
  }
}

async function fromKeychain(configDir, run) {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', keychainService(configDir), '-w'], { timeout: TIMEOUT_MS });
    return tokenFromJson(decodeSecret(stdout));
  } catch {
    // voce assente, accesso negato, timeout: si prova il file
    return null;
  }
}

function fromFile(configDir, home) {
  const dir = configDir || path.join(home, '.claude');
  try {
    return tokenFromJson(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Token OAuth per una config dir, o null.
 * @param {{ configDir?: string|null, platform?: string, home?: string, run?: Function }} [opts]
 *   `run(file, args, opts)` -> Promise<{stdout}>: iniettabile, i test non
 *   toccano il Keychain
 * @returns {Promise<string|null>}
 */
async function readClaudeToken({
  configDir = null, platform = process.platform, home = os.homedir(), run = execFileAsync,
} = {}) {
  const fromMac = platform === 'darwin' ? await fromKeychain(configDir, run) : null;
  return fromMac || fromFile(configDir, home);
}

module.exports = { readClaudeToken, keychainService, SERVICE };
