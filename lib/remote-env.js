'use strict';
/* Ambienti remoti: un server di ~/.ssh/config o una distro WSL
 * (docs/plans/93-sessioni-remote.md). Solo stringhe: niente filesystem,
 * niente processi. Chi legge i file e lancia wsl.exe è lib/remote-hosts.js.
 *
 * Un ambiente è uno di:
 *   { kind: 'local' }
 *   { kind: 'ssh', host: 'nas' }          alias di ~/.ssh/config, o
 *   { kind: 'ssh', host: 'ale@srv:2222' } server scritto a mano (docs/plans/96)
 *   { kind: 'wsl', distro: 'Debian' }
 * e la sua chiave testuale (`local`, `ssh:nas`, `wsl:Debian`) è ciò che
 * viaggia in tmux, cronologia e renderer. */

/* Nessun `-` in testa: ssh e wsl.exe lo leggerebbero come un'opzione
   (`-oProxyCommand=…` esegue un comando sulla macchina locale). */
const NAME_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,254}$/;
const WILDCARD_RE = /[*?!]/;
// Un nome utente, con le stesse regole: niente `-` in testa
const USER_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
const PORT_RE = /^[1-9][0-9]{0,4}$/;
const DEFAULT_SSH_PORT = 22;
const SECRET_NAME_RE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD/i;
const MAX_DIR_LEN = 4096;
// Caratteri di controllo: un a capo spezzerebbe la riga remota
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Un nome da scrivere dopo `Host` in ~/.ssh/config: niente wildcard, niente `-` in testa. */
function isConfigAlias(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

/** Divide una riga di ssh_config in parole, con le virgolette doppie. */
function configWords(line) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

/** Riga senza commento finale (`#` fuori dalle virgolette). */
function stripComment(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === '#' && !quoted) return line.slice(0, i);
  }
  return line;
}

/**
 * Alias concreti e Include di un ssh_config. Gli alias con wildcard sono
 * regole, non macchine: non si propongono.
 * @param {string} text
 * @returns {{ hosts: string[], includes: string[] }}
 */
function parseSshConfig(text) {
  if (typeof text !== 'string') return { hosts: [], includes: [] };
  const hosts = [];
  const includes = [];
  for (const raw of text.split(/\r?\n/)) {
    // `Host=nas` vale quanto `Host nas`
    const line = stripComment(raw).trim().replace(/^(\S+?)\s*=\s*/, '$1 ');
    if (!line) continue;
    const [keyword, ...rest] = configWords(line);
    const key = keyword.toLowerCase();
    if (key === 'include') includes.push(...rest);
    if (key !== 'host') continue;
    for (const alias of rest) {
      if (WILDCARD_RE.test(alias) || !NAME_RE.test(alias) || hosts.includes(alias)) continue;
      hosts.push(alias);
    }
  }
  return { hosts, includes };
}

/**
 * Distro da `wsl.exe -l -q`, che scrive in UTF-16LE. Una stringa già
 * decodificata come UTF-8 si riconosce dai `\0` e si ripulisce uguale.
 * @param {Buffer|string} out
 * @returns {string[]}
 */
function parseWslList(out) {
  const text = Buffer.isBuffer(out) ? out.toString('utf16le') : String(out || '');
  return text
    .replace(/\u0000/g, '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && NAME_RE.test(s) && !s.startsWith('docker-desktop'));
}

const LOCAL = Object.freeze({ kind: 'local' });

/** Chiave testuale dell'ambiente. */
function envKey(env) {
  if (!env || env.kind === 'local') return 'local';
  if (env.kind === 'ssh') return `ssh:${env.host}`;
  if (env.kind === 'wsl') return `wsl:${env.distro}`;
  throw new Error(`Ambiente sconosciuto: ${env.kind}`);
}

/**
 * Ambiente da una chiave; null se non valida. Vuoto = locale: è ciò che
 * dicono la cronologia e le sessioni tmux di prima del piano 93.
 * @returns {{kind: 'local'} | {kind: 'ssh', host: string} | {kind: 'wsl', distro: string} | null}
 */
function parseEnvKey(key) {
  if (key === undefined || key === null || key === '' || key === 'local') return { kind: 'local' };
  const m = /^(ssh|wsl):(.*)$/.exec(String(key));
  if (!m) return null;
  if (m[1] === 'ssh') return parseSshTarget(m[2]) ? { kind: 'ssh', host: m[2] } : null;
  return NAME_RE.test(m[2]) ? { kind: 'wsl', distro: m[2] } : null;
}

/**
 * Server SSH: `host`, `utente@host` o `utente@host:porta` (un alias di
 * ~/.ssh/config è un host). Rigido: niente spazi, niente IPv6.
 * @returns {{ user: string|null, host: string, port: number|null } | null}
 */
function parseSshTarget(text) {
  if (typeof text !== 'string') return null;
  const m = /^(?:([^@:]*)@)?([^@:]*)(?::([^@:]*))?$/.exec(text);
  if (!m) return null;
  const [, user, host, port] = m;
  if (user !== undefined && !USER_RE.test(user)) return null;
  if (!NAME_RE.test(host)) return null;
  if (port !== undefined && !(PORT_RE.test(port) && Number(port) <= 65535)) return null;
  return { user: user === undefined ? null : user, host, port: port === undefined ? null : Number(port) };
}

/** Il testo scritto nel modal come chiave stabile: spazi via, `:22` via; null se non valido. */
function normalizeSshTarget(text) {
  const t = parseSshTarget(typeof text === 'string' ? text.trim() : text);
  if (!t) return null;
  const dest = t.user ? `${t.user}@${t.host}` : t.host;
  return t.port && t.port !== DEFAULT_SSH_PORT ? `${dest}:${t.port}` : dest;
}

/** Argomenti di ssh per arrivare al server: `-p` prima di `--`, la destinazione dopo. */
function sshDestArgs(target) {
  const t = parseSshTarget(target);
  if (!t) throw new Error(`Server SSH non valido: ${target}`);
  const dest = t.user ? `${t.user}@${t.host}` : t.host;
  return [...(t.port ? ['-p', String(t.port)] : []), '--', dest];
}

function isRemote(env) {
  return Boolean(env && env.kind !== 'local');
}

/** Etichetta breve per scheda e sidebar; vuota in locale. */
function envLabel(env) {
  if (!isRemote(env)) return '';
  return env.kind === 'ssh' ? env.host : `WSL · ${env.distro}`;
}

/**
 * Directory sul server: `~`, `~/…` o assoluta POSIX. Vuota vale `~`.
 * `~altro` (home di un altro utente) no: non si saprebbe come quotarla.
 * @returns {{ ok: true, dir: string } | { ok: false, error: string }}
 */
function validateRemoteDir(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return { ok: true, dir: '~' };
  if (raw.length > MAX_DIR_LEN || CONTROL_RE.test(raw)) return { ok: false, error: 'Directory non valida.' };
  if (raw !== '~' && !raw.startsWith('~/') && !raw.startsWith('/')) {
    return { ok: false, error: 'Sul server la directory va scritta come ~/… oppure /percorso/assoluto.' };
  }
  const dir = raw.length > 1 ? raw.replace(/\/+$/, '') || '/' : raw;
  return { ok: true, dir };
}

/** Quoting POSIX: tutto letterale per qualunque shell sh-compatibile. */
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Come shQuote, ma un `~` iniziale resta fuori: lo espande il server. */
function quoteHomePath(p) {
  const s = String(p);
  if (s === '~') return '~';
  if (s.startsWith('~/')) return s.length > 2 ? `~/${shQuote(s.slice(2))}` : '~/';
  return shQuote(s);
}

/**
 * Variabili del profilo che non devono finire sul server: andrebbero nella
 * riga di comando, leggibile con `ps` da ogni utente di quella macchina.
 * @returns {string|null} il messaggio, o null se non ce ne sono
 */
function remoteSecretProblem(vars) {
  const names = Object.keys(vars || {}).filter((k) => SECRET_NAME_RE.test(k));
  if (!names.length) return null;
  return `Le variabili ${names.join(', ')} sembrano segreti: su una sessione remota finirebbero nella riga di comando `
    + 'del server, leggibile da ogni utente con `ps`. Usa un comando senza queste variabili e fai il login sul server.';
}

/**
 * Riga per `sh -c` sul server: entra nella directory (se manca lo dice e
 * parte dalla home, come fa l'app in locale) e diventa il comando, lanciato
 * dalla shell di login interattiva dell'utente: è lì che nvm, brew e
 * ~/.local/bin mettono `claude` e compagni nel PATH.
 *
 * @param {{ cwd: string, bin?: string, args?: string[], vars?: object, shell?: boolean }} o
 *   `shell: true` apre solo la shell di login
 */
function remoteScript({ cwd, bin, args = [], vars = {}, shell = false }) {
  const dir = quoteHomePath(cwd || '~');
  const notice = shQuote(`PizzaManager: ${cwd} non trovata, parto dalla home.`);
  const cd = `cd -- ${dir} 2>/dev/null || { echo ${notice} >&2; cd; }`;
  const envPart = Object.entries(vars || {}).map(([k, v]) => `${k}=${shQuote(v)}`);
  const prefix = envPart.length ? `exec env ${envPart.join(' ')} ` : 'exec ';
  const loginShell = '"${SHELL:-/bin/sh}"';
  if (shell) return `${cd}; ${prefix}${loginShell} -il`;
  const inner = ['exec', quoteHomePath(bin), ...args.map(shQuote)].join(' ');
  return `${cd}; ${prefix}${loginShell} -lic ${shQuote(inner)}`;
}

/**
 * Comando LOCALE che apre la sessione nell'ambiente remoto.
 * @param {{ env: object, cwd: string, bin?: string, args?: string[], vars?: object, shell?: boolean,
 *   sshBin?: string, wslBin?: string }} o
 * @returns {{ cmd: string, args: string[] }}
 */
function wrapRemote({ env, sshBin = 'ssh', wslBin = 'wsl.exe', ...rest }) {
  const checked = parseEnvKey(isRemote(env) ? envKey(env) : 'local');
  if (!checked || !isRemote(checked)) throw new Error('wrapRemote: serve un ambiente remoto valido.');
  const script = remoteScript(rest);
  if (checked.kind === 'ssh') {
    // ssh unisce gli argomenti remoti e li dà alla shell di login del server,
    // che può essere fish: la riga va a un `sh` esplicito, quotata una volta.
    return { cmd: sshBin, args: ['-t', ...sshDestArgs(checked.host), `sh -c ${shQuote(script)}`] };
  }
  // --exec: niente shell di mezzo, l'argv arriva com'è
  return { cmd: wslBin, args: ['-d', checked.distro, '--exec', 'sh', '-c', script] };
}

module.exports = {
  LOCAL,
  parseSshConfig,
  isConfigAlias,
  parseWslList,
  envKey,
  parseEnvKey,
  parseSshTarget,
  normalizeSshTarget,
  sshDestArgs,
  isRemote,
  envLabel,
  validateRemoteDir,
  shQuote,
  quoteHomePath,
  remoteSecretProblem,
  remoteScript,
  wrapRemote,
};
