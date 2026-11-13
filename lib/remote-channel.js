'use strict';
/* Canale verso l'helper dell'editor su un server SSH (docs/plans/94).
 * Un processo `ssh -T` per host, righe JSON in andata e ritorno: ogni
 * richiesta ha un id, un timeout, e fallisce con un messaggio chiaro se la
 * connessione cade. L'helper (lib/remote-helper.py) viaggia sullo stdin dopo
 * un bootstrap fisso: sul server non si installa niente.
 *
 * Niente terminale: l'autenticazione deve riuscire da sola (chiave, agent,
 * ControlMaster). BatchMode=yes fa fallire subito invece di restare appesi a
 * chiedere una password che nessuno vede. */
const fs = require('fs');
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');
const { shQuote, parseEnvKey } = require('./remote-env');

const HELPER_FILE = path.join(__dirname, 'remote-helper.py');
// Legge la lunghezza, poi l'helper, e lo esegue: la riga di comando resta corta e fissa
const BOOTSTRAP = 'import sys;b=sys.stdin.buffer;n=int(b.readline());'
  + 'exec(compile(b.read(n).decode("ascii"),"aisess-helper","exec"),{"__name__":"__main__"})';
const REQUEST_TIMEOUT_MS = 20000;
const START_TIMEOUT_MS = 20000;
const IDLE_MS = 5 * 60 * 1000;
const MAX_STDERR = 4000;

let helperSource = null;
function loadHelper() {
  if (helperSource === null) helperSource = fs.readFileSync(HELPER_FILE, 'utf8');
  return helperSource;
}

/** Argomenti di ssh per un host già validato (lib/remote-env.js). */
function sshArgs(host) {
  return ['-T', '-o', 'BatchMode=yes', '--', host, `python3 -u -c ${shQuote(BOOTSTRAP)}`];
}

/** Un messaggio che dice cosa fare, dallo stderr di ssh o del server. */
function startFailure(stderr, code) {
  const text = String(stderr || '');
  if (/permission denied|authentication|host key verification failed/i.test(text)) {
    return 'Il server chiede una password o una conferma: l\'editor non ha un terminale per rispondere. '
      + 'Serve una chiave SSH (o ssh-agent), e l\'host già noto: apri prima un terminale sul server.';
  }
  if (/python3: (command )?not found|python3: not found|No such file or directory/i.test(text)) {
    return 'Sul server serve python3 per l\'editor remoto.';
  }
  if (/could not resolve|connection refused|timed out|no route/i.test(text)) {
    return 'Server non raggiungibile: ' + firstLine(text);
  }
  const line = firstLine(text);
  return line ? `Connessione al server chiusa: ${line}` : `Connessione al server chiusa (uscita ${code}).`;
}

function firstLine(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean).pop() || '';
}

const channelError = (message) => Object.assign(new Error(message), { code: 'ECHANNEL' });

/**
 * @param {{ host: string, sshBin: string, spawn?: typeof nodeSpawn, source?: string,
 *   requestTimeoutMs?: number, startTimeoutMs?: number, idleMs?: number,
 *   onClose?: () => void }} o
 */
function createRemoteChannel({
  host, sshBin, spawn = nodeSpawn, source = null,
  requestTimeoutMs = REQUEST_TIMEOUT_MS, startTimeoutMs = START_TIMEOUT_MS, idleMs = IDLE_MS, onClose = () => {},
}) {
  let child = null;
  let ready = null; // Promise del primo {"ready": true}
  let nextId = 1;
  let buffered = '';
  let stderr = '';
  let idleTimer = null;
  const pending = new Map(); // id → { resolve, reject, timer }

  function failAll(err) {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  }

  function onLine(line, markReady) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // un banner del server, non una risposta
    if (msg && msg.ready === true) { markReady(); return; }
    const p = msg && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg);
  }

  function start() {
    stderr = '';
    buffered = '';
    const proc = spawn(sshBin, sshArgs(host), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child = proc;
    ready = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
      const timer = setTimeout(() => {
        settle(reject, channelError('Il server non risponde: connessione scaduta.'));
        proc.kill();
      }, startTimeoutMs);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        buffered += chunk;
        let nl;
        while ((nl = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, nl);
          buffered = buffered.slice(nl + 1);
          onLine(line, () => settle(resolve));
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-MAX_STDERR); });
      proc.stdin.on('error', () => {}); // EPIPE: l'errore vero arriva da 'close'
      proc.on('error', (e) => {
        const err = channelError(e.code === 'ENOENT' ? `'${sshBin}' non trovato.` : String(e.message || e));
        settle(reject, err);
        failAll(err);
      });
      proc.on('close', (code) => {
        if (child === proc) { child = null; ready = null; }
        const err = channelError(startFailure(stderr, code));
        settle(reject, err);
        failAll(err);
        clearTimeout(idleTimer);
        onClose();
      });
    });
    ready.catch(() => {}); // chi aspetta lo vede da request(); qui non resta un rifiuto orfano
    const src = source === null ? loadHelper() : source;
    proc.stdin.write(`${Buffer.byteLength(src)}\n${src}`);
    return ready;
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!pending.size) close(); }, idleMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  /**
   * @param {string} op
   * @param {object} args
   * @param {{timeoutMs?: number}} [o]
   * @returns {Promise<object>} la risposta dell'helper (`ok` true o false); rifiuta solo se il canale cade
   */
  async function request(op, args = {}, { timeoutMs = requestTimeoutMs } = {}) {
    if (!child) start();
    await ready;
    touch();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(channelError('Il server non ha risposto in tempo.'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }

  function close() {
    clearTimeout(idleTimer);
    if (child) { child.stdin.end(); child.kill(); }
  }

  return { request, close, get connected() { return Boolean(child); } };
}

/**
 * Un canale per ambiente, condiviso fra le schede.
 * @param {{ resolveClient: (name: string) => {path: string|null}, create?: typeof createRemoteChannel }} o
 */
function createRemoteChannels({ resolveClient, create = createRemoteChannel }) {
  const channels = new Map();
  /** @param {string} envKey `ssh:host` */
  function get(envKey) {
    const env = parseEnvKey(envKey);
    if (!env || env.kind !== 'ssh') throw channelError('Ambiente non valido per l\'editor remoto: ' + envKey);
    const known = channels.get(envKey);
    if (known) return known;
    const ssh = resolveClient('ssh');
    if (!ssh || !ssh.path) throw channelError('\'ssh\' non trovato nel PATH.');
    const ch = create({ host: env.host, sshBin: ssh.path, onClose: () => { if (channels.get(envKey) === ch) channels.delete(envKey); } });
    channels.set(envKey, ch);
    return ch;
  }
  function closeAll() {
    for (const ch of channels.values()) ch.close();
    channels.clear();
  }
  return { get, closeAll };
}

module.exports = { createRemoteChannel, createRemoteChannels, sshArgs, startFailure, BOOTSTRAP, HELPER_FILE };
