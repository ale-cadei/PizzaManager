'use strict';
/* «Salva» di un server scritto a mano in ~/.ssh/config (docs/plans/96).
 * Solo aggiunte: un blocco `Host` nuovo, le righe che ci sono restano
 * uguali. Il blocco va prima del primo `Host` con wildcard o `Match`,
 * perché in ssh_config vince il primo valore trovato. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSshTarget, parseSshConfig, isConfigAlias } = require('./remote-env');

const MARK = '# Aggiunto da PizzaManager';
const NEW_FILE_MODE = 0o600;
const SSH_DIR_MODE = 0o700;

/** Prima parola di una riga di ssh_config (`Host=x` vale `Host x`), minuscola. */
function keywordOf(line) {
  const m = /^\s*([A-Za-z]+)(?:\s*=\s*|\s+)(.*)$/.exec(line);
  return m ? { key: m[1].toLowerCase(), rest: m[2] } : null;
}

/** Riga dove inserire: il primo `Host` con wildcard o `Match`, coi commenti subito sopra; -1 = in fondo. */
function insertionLine(lines) {
  const at = lines.findIndex((l) => {
    const k = keywordOf(l);
    return k && (k.key === 'match' || (k.key === 'host' && /[*?!]/.test(k.rest)));
  });
  if (at < 0) return -1;
  let start = at;
  while (start > 0 && /^\s*#/.test(lines[start - 1])) start--;
  return start;
}

function hostBlock(alias, { user, host, port }) {
  return [
    MARK,
    `Host ${alias}`,
    `    HostName ${host}`,
    ...(user ? [`    User ${user}`] : []),
    ...(port ? [`    Port ${port}`] : []),
  ];
}

/**
 * Il config con il blocco del server aggiunto.
 * @param {string} text config attuale ('' se non c'è)
 * @param {{ alias: string, target: string }} o
 * @returns {string}
 */
function addSshHost(text, { alias, target }) {
  if (!isConfigAlias(alias)) throw new Error('Il nome può avere lettere, numeri, «.», «_» e «-», non un «-» in testa.');
  const parsed = parseSshTarget(target);
  if (!parsed) throw new Error('Scrivi il server come host, utente@host o utente@host:porta.');
  if (parseSshConfig(text).hosts.includes(alias)) throw new Error(`«${alias}» c'è già in ~/.ssh/config.`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = hostBlock(alias, parsed);
  if (!text) return block.join(eol) + eol;
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  const at = insertionLine(lines);
  const out = at < 0
    ? [...lines, '', ...block]
    : [...lines.slice(0, at), ...block, '', ...lines.slice(at)];
  return out.join(eol) + eol;
}

/**
 * @param {{ home?: string, fsImpl?: typeof fs }} [o]
 */
function createSshConfigSaver({ home = os.homedir(), fsImpl = fs } = {}) {
  const sshDir = path.join(home, '.ssh');
  const file = path.join(sshDir, 'config');

  /** Testo, percorso vero (un link dei dotfiles si segue) e permessi del config; null se non c'è. */
  function current() {
    try {
      const real = fsImpl.realpathSync(file);
      return { real, text: fsImpl.readFileSync(real, 'utf8'), mode: fsImpl.statSync(real).mode & 0o777 };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  /** Aggiunge il blocco; un file temporaneo accanto e `rename`, così a metà non resta un config troncato. */
  function save({ alias, target }) {
    fsImpl.mkdirSync(sshDir, { recursive: true, mode: SSH_DIR_MODE });
    const now = current();
    const real = now ? now.real : file;
    const mode = now ? now.mode : NEW_FILE_MODE;
    const text = addSshHost(now ? now.text : '', { alias, target });
    const tmp = `${real}.pizzamanager-${process.pid}.tmp`;
    try {
      fsImpl.writeFileSync(tmp, text, { mode });
      fsImpl.chmodSync(tmp, mode);
      fsImpl.renameSync(tmp, real);
    } catch (e) {
      try { fsImpl.unlinkSync(tmp); } catch {}
      throw e;
    }
  }

  return { save, file };
}

module.exports = { addSshHost, createSshConfigSaver };
