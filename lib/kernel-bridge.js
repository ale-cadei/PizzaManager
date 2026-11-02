'use strict';
/* Il ponte verso un kernel Jupyter (docs/plans/79): un processo Python con
 * app/kernel-bridge.py, che parla JSON a righe. Qui solo il processo e il
 * protocollo: niente electron, il percorso dello script arriva da fuori
 * (impacchettata, l'app lo passa da externalPath).
 *
 * Python parte senza shell, con -B (niente __pycache__ accanto all'app).
 * Non con -I/-s: jupyter_client sta spesso nel site dell'utente
 * (`pip install --user`), che -I e -s escludono. */
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { resolveBinary } = require('./binaries');

const BRIDGE_SCRIPT = path.join(__dirname, '..', 'app', 'kernel-bridge.py');
const STDERR_TAIL = 4000; // quanto stderr tenere per spiegare un'uscita
const KILL_AFTER_MS = 5000; // stdin chiuso, il ponte spegne il kernel: se non esce, kill

/**
 * Il Python da usare. Su Windows `python3` è spesso il rimando al Microsoft
 * Store anche con Python installato: prima `python`.
 * @returns {string|null}
 */
function findPython({ platform = process.platform, resolve = resolveBinary } = {}) {
  const names = platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const name of names) {
    const found = resolve(name, { platform });
    if (found && found.path) return found.path;
  }
  return null;
}

/** Spezza un flusso di byte in righe intere, anche con UTF-8 a cavallo dei chunk. */
function lineReader(onLine) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  return (chunk) => {
    const lines = (rest + decoder.write(chunk)).split('\n');
    rest = lines.pop();
    lines.forEach(onLine);
  };
}

function parseEvent(line) {
  try {
    const event = JSON.parse(line);
    return event && typeof event === 'object' && !Array.isArray(event) && typeof event.ev === 'string' ? event : null;
  } catch {
    return null; // una riga che non è del protocollo (non dovrebbe esserci: stdout è solo del ponte)
  }
}

/**
 * @param {{spawn: Function, python: string, script?: string, cwd: string, env: Object<string, string>,
 *   onEvent: (event: object) => void, setTimer?: Function, clearTimer?: Function}} opts
 *   `onEvent` riceve gli eventi del ponte e, alla fine, `{ev: 'exit', code, stderr}`
 * @returns {{send: (command: object) => void, close: () => void}}
 */
function createKernelBridge({
  spawn, python, script = BRIDGE_SCRIPT, cwd, env, onEvent,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const child = spawn(python, ['-B', script], {
    cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  });
  let exited = false;
  let stderr = '';
  let killTimer = null;

  const finish = (code, message) => {
    if (exited) return;
    exited = true;
    if (killTimer) clearTimer(killTimer);
    onEvent({ ev: 'exit', code, stderr: message !== undefined ? message : stderr });
  };

  child.stdout.on('data', lineReader((line) => {
    const event = parseEvent(line);
    if (event) onEvent(event);
  }));
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL); });
  child.stdin.on('error', () => {}); // ponte già uscito: lo dice 'exit'
  child.on('error', (e) => finish(null, String((e && e.message) || e)));
  child.on('exit', (code) => finish(code));

  return {
    send(command) {
      if (!exited) child.stdin.write(JSON.stringify(command) + '\n');
    },
    close() {
      if (exited) return;
      child.stdin.end();
      if (!killTimer) killTimer = setTimer(() => { if (!exited) child.kill('SIGKILL'); }, KILL_AFTER_MS);
    },
  };
}

module.exports = { BRIDGE_SCRIPT, findPython, createKernelBridge };
