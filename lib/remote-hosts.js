'use strict';
/* Dove si può aprire una sessione oltre a questo computer
 * (docs/plans/93-sessioni-remote.md): gli host di ~/.ssh/config e, su
 * Windows, le distro WSL. Il parsing è in lib/remote-env.js; qui si leggono
 * i file e si lancia wsl.exe. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { parseSshConfig, parseWslList } = require('./remote-env');

const CACHE_MS = 30000;
const WSL_TIMEOUT_MS = 5000;
// Un Include che include se stesso non deve girare per sempre
const MAX_INCLUDE_DEPTH = 8;

/** `*` e `?` di un glob di ssh_config, solo nell'ultimo pezzo del percorso. */
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * @param {{ home?: string, platform?: string, fsImpl?: typeof fs,
 *   run?: (cmd: string, args: string[], opts: object) => Promise<Buffer>, now?: () => number }} [o]
 */
function createRemoteHosts({ home = os.homedir(), platform = process.platform, fsImpl = fs, run = runBuffer, now = Date.now } = {}) {
  const sshDir = path.join(home, '.ssh');
  let cache = null;

  /** Percorsi di un Include: relativi a ~/.ssh, `~` è la home, glob nell'ultimo pezzo. */
  function expandInclude(pattern) {
    const p = pattern.startsWith('~/') ? path.join(home, pattern.slice(2)) : path.resolve(sshDir, pattern);
    if (!/[*?]/.test(path.basename(p))) return [p];
    const dir = path.dirname(p);
    const re = globToRegExp(path.basename(p));
    try {
      return fsImpl.readdirSync(dir).filter((n) => re.test(n)).sort().map((n) => path.join(dir, n));
    } catch {
      return [];
    }
  }

  function readHosts(file, depth, seen) {
    if (depth > MAX_INCLUDE_DEPTH || seen.has(file)) return [];
    seen.add(file);
    let text;
    try {
      text = fsImpl.readFileSync(file, 'utf8');
    } catch (e) {
      // Nessun config è il caso normale; gli altri errori si dicono nel log
      if (e.code !== 'ENOENT' && e.code !== 'EISDIR') console.error(`[remote-hosts] ${file} non letto:`, e.message);
      return [];
    }
    const { hosts, includes } = parseSshConfig(text);
    const nested = includes.flatMap(expandInclude).flatMap((f) => readHosts(f, depth + 1, seen));
    return [...hosts, ...nested];
  }

  function sshHosts() {
    return [...new Set(readHosts(path.join(sshDir, 'config'), 0, new Set()))];
  }

  async function wslDistros() {
    if (platform !== 'win32') return [];
    try {
      return parseWslList(await run('wsl.exe', ['-l', '-q'], { timeout: WSL_TIMEOUT_MS, windowsHide: true }));
    } catch (e) {
      // WSL non installato: niente distro, non è un errore da mostrare
      console.error('[remote-hosts] wsl.exe -l -q:', e.message);
      return [];
    }
  }

  /** @returns {Promise<{ ssh: string[], wsl: string[] }>} */
  async function list({ fresh = false } = {}) {
    if (!fresh && cache && now() - cache.at < CACHE_MS) return cache.value;
    const value = { ssh: sshHosts(), wsl: await wslDistros() };
    cache = { at: now(), value };
    return value;
  }

  return { list };
}

function runBuffer(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, encoding: 'buffer' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

module.exports = { createRemoteHosts };
