const assert = require('node:assert');
const path = require('path');
const { EventEmitter } = require('events');
const { execFileSync, spawn } = require('child_process');
const { test: ok } = require('node:test');
const { createKernelBridge, findPython, BRIDGE_SCRIPT } = require('../lib/kernel-bridge');

/* ---------- con un processo finto ---------- */

function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), {
      written: [], ended: false,
      write(s) { this.written.push(s); return true; },
      end() { this.ended = true; },
    });
    child.killed = [];
    child.kill = (sig) => { child.killed.push(sig || 'SIGTERM'); };
    calls.push({ cmd, args, opts, child });
    return child;
  };
  return { fn, calls };
}

function bridgeWithFake(extra = {}) {
  const sp = fakeSpawn();
  const events = [];
  const bridge = createKernelBridge({
    spawn: sp.fn, python: '/usr/bin/python3', script: '/app/kernel-bridge.py', cwd: '/proj',
    env: { PATH: '/bin' }, onEvent: (e) => events.push(e), ...extra,
  });
  return { bridge, events, child: sp.calls[0].child, call: sp.calls[0] };
}

ok('createKernelBridge: python senza shell, con lo script, la cartella e un env senza buffer', () => {
  const { call } = bridgeWithFake();
  assert.strictEqual(call.cmd, '/usr/bin/python3');
  assert.deepStrictEqual(call.args, ['-B', '/app/kernel-bridge.py']);
  assert.strictEqual(call.opts.cwd, '/proj');
  assert.strictEqual(call.opts.shell, undefined);
  assert.strictEqual(call.opts.windowsHide, true);
  assert.strictEqual(call.opts.env.PYTHONUNBUFFERED, '1');
  assert.strictEqual(call.opts.env.PYTHONIOENCODING, 'utf-8');
  assert.strictEqual(call.opts.env.PATH, '/bin');
});

ok('createKernelBridge: righe spezzate fra più chunk diventano eventi; il JSON rotto si salta', () => {
  const { events, child } = bridgeWithFake();
  child.stdout.emit('data', Buffer.from('{"ev":"ready","lang'));
  child.stdout.emit('data', Buffer.from('uage":"python"}\nnon json\n{"ev":"status",'));
  child.stdout.emit('data', Buffer.from('"state":"idle"}\n[1]\n'));
  assert.deepStrictEqual(events, [{ ev: 'ready', language: 'python' }, { ev: 'status', state: 'idle' }]);
});

ok('createKernelBridge: un carattere UTF-8 a cavallo di due chunk resta intero', () => {
  const { events, child } = bridgeWithFake();
  const bytes = Buffer.from('{"ev":"output","text":"è"}\n');
  const cut = bytes.indexOf(0xc3) + 1;
  child.stdout.emit('data', bytes.subarray(0, cut));
  child.stdout.emit('data', bytes.subarray(cut));
  assert.strictEqual(events[0].text, 'è');
});

ok('createKernelBridge: send scrive una riga JSON sullo stdin', () => {
  const { bridge, child } = bridgeWithFake();
  bridge.send({ cmd: 'execute', run: 'r1', code: 'print("a\\nb")' });
  assert.deepStrictEqual(child.stdin.written.map((s) => JSON.parse(s)), [{ cmd: 'execute', run: 'r1', code: 'print("a\\nb")' }]);
  assert.ok(child.stdin.written[0].endsWith('\n'));
  assert.strictEqual(child.stdin.written[0].split('\n').length, 2);
});

ok('createKernelBridge: uscita → evento exit con la coda di stderr; dopo, send non scrive', () => {
  const { bridge, events, child } = bridgeWithFake();
  child.stderr.emit('data', Buffer.from('x'.repeat(5000) + 'Traceback: boom\n'));
  child.emit('exit', 1, null);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].ev, 'exit');
  assert.strictEqual(events[0].code, 1);
  assert.ok(events[0].stderr.endsWith('Traceback: boom\n'));
  assert.ok(events[0].stderr.length <= 4000);
  bridge.send({ cmd: 'interrupt' });
  assert.strictEqual(child.stdin.written.length, 0);
});

ok('createKernelBridge: python che non parte → evento exit con il messaggio, una volta sola', () => {
  const { events, child } = bridgeWithFake();
  child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  child.emit('exit', null, null);
  assert.deepStrictEqual(events, [{ ev: 'exit', code: null, stderr: 'spawn ENOENT' }]);
});

ok('createKernelBridge: close chiude lo stdin e, se il ponte non esce, lo uccide', () => {
  const timers = [];
  const { bridge, child } = bridgeWithFake({ setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  bridge.close();
  assert.strictEqual(child.stdin.ended, true);
  assert.strictEqual(child.killed.length, 0);
  assert.strictEqual(timers.length, 1);
  timers[0].fn();
  assert.deepStrictEqual(child.killed, ['SIGKILL']);
});

ok('createKernelBridge: close su un ponte già uscito non uccide niente', () => {
  const timers = [];
  const { bridge, child } = bridgeWithFake({ setTimer: (fn) => { timers.push(fn); return 1; }, clearTimer: () => {} });
  child.emit('exit', 0, null);
  bridge.close();
  assert.strictEqual(timers.length, 0);
  assert.strictEqual(child.killed.length, 0);
});

ok('createKernelBridge: un EPIPE sullo stdin non fa cadere il processo', () => {
  const { child } = bridgeWithFake();
  assert.doesNotThrow(() => child.stdin.emit('error', new Error('EPIPE')));
});

/* ---------- findPython ---------- */

ok('findPython: python3 prima, poi python; null se nessuno', () => {
  const seen = [];
  const resolve = (map) => (name) => { seen.push(name); return { path: map[name] || null }; };
  const platform = 'linux';
  assert.strictEqual(findPython({ platform, resolve: resolve({ python3: '/a/python3', python: '/a/python' }) }), '/a/python3');
  assert.strictEqual(findPython({ platform, resolve: resolve({ python: '/a/python' }) }), '/a/python');
  assert.strictEqual(findPython({ platform, resolve: resolve({}) }), null);
});

ok('findPython: su Windows prima python (python3 è spesso il rimando allo Store)', () => {
  const seen = [];
  findPython({ platform: 'win32', resolve: (n) => { seen.push(n); return { path: null }; } });
  assert.deepStrictEqual(seen, ['python', 'python3']);
});

ok('BRIDGE_SCRIPT: lo script del ponte esiste accanto ad app/', () => {
  assert.strictEqual(path.basename(BRIDGE_SCRIPT), 'kernel-bridge.py');
  assert.ok(require('fs').existsSync(BRIDGE_SCRIPT));
});

/* ---------- col Python vero ---------- */

function jupyterReady() {
  try {
    execFileSync('python3', ['-c', 'import jupyter_client, ipykernel'], { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

/** Un ponte vero; `until(events)` chiude il test quando torna true. */
function realBridge(commands, until, { cwd = __dirname, timeout = 40000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    let bridge = null;
    const timer = setTimeout(() => { bridge.close(); reject(new Error('timeout: ' + JSON.stringify(events))); }, timeout);
    bridge = createKernelBridge({
      spawn, python: 'python3', script: BRIDGE_SCRIPT, cwd, env,
      onEvent: (e) => {
        if (e.ev === 'status') return;
        events.push(e);
        if (e.ev === 'exit' || until(events, bridge)) {
          clearTimeout(timer);
          bridge.close();
          resolve(events);
        }
      },
    });
    commands.forEach((c) => bridge.send(c));
  });
}

const doneOf = (events, run) => events.find((e) => e.ev === 'done' && e.run === run);

ok('ponte vero: print e risultato, done dopo gli output; un errore annulla la coda', { timeout: 60000 }, async (t) => {
  if (!jupyterReady()) return t.skip('jupyter_client o ipykernel non installati');
  const events = await realBridge([
    { cmd: 'start', kernel: 'python3', cwd: __dirname },
    { cmd: 'execute', run: 'a', code: 'import os\nprint(os.path.basename(os.getcwd()))\n6*7' },
    { cmd: 'execute', run: 'b', code: '1/0' },
    { cmd: 'execute', run: 'c', code: '"mai"' },
  ], (ev) => Boolean(doneOf(ev, 'c')));
  assert.strictEqual(events[0].ev, 'ready');
  assert.strictEqual(events[0].language, 'python');
  const a = events.filter((e) => e.run === 'a').map((e) => e.ev);
  assert.deepStrictEqual(a, ['started', 'output', 'output', 'done']);
  const outs = events.filter((e) => e.ev === 'output' && e.run === 'a').map((e) => e.output);
  assert.deepStrictEqual(outs[0], { output_type: 'stream', name: 'stdout', text: 'tests\n' });
  assert.strictEqual(outs[1].output_type, 'execute_result');
  assert.strictEqual(outs[1].data['text/plain'], '42');
  assert.deepStrictEqual(doneOf(events, 'a'), { ev: 'done', run: 'a', status: 'ok', count: 1 });
  assert.strictEqual(doneOf(events, 'b').status, 'error');
  assert.ok(events.some((e) => e.run === 'b' && e.output && e.output.ename === 'ZeroDivisionError'));
  assert.strictEqual(doneOf(events, 'c').status, 'aborted');
});

ok('ponte vero: interrupt ferma la cella con KeyboardInterrupt, restart azzera i numeri', { timeout: 60000 }, async (t) => {
  if (!jupyterReady()) return t.skip('jupyter_client o ipykernel non installati');
  let sent = false;
  let restarted = false;
  const events = await realBridge([
    { cmd: 'start', kernel: 'python3' },
    { cmd: 'execute', run: 'slow', code: 'import time\ntime.sleep(30)' },
  ], (ev, bridge) => {
    if (!sent && ev.some((e) => e.ev === 'started')) {
      sent = true;
      setTimeout(() => bridge.send({ cmd: 'interrupt' }), 300);
    }
    if (doneOf(ev, 'slow') && !restarted) {
      restarted = true;
      bridge.send({ cmd: 'restart' });
      bridge.send({ cmd: 'execute', run: 'after', code: '1' });
    }
    return Boolean(doneOf(ev, 'after'));
  });
  assert.ok(events.some((e) => e.run === 'slow' && e.output && e.output.ename === 'KeyboardInterrupt'));
  assert.strictEqual(events.filter((e) => e.ev === 'ready').length, 2);
  assert.deepStrictEqual(doneOf(events, 'after'), { ev: 'done', run: 'after', status: 'ok', count: 1 });
});

ok('ponte vero: un riavvio che fallisce lo dice, e il riavvio dopo riparte', { timeout: 90000 }, async (t) => {
  if (!jupyterReady() || process.platform === 'win32') return t.skip('jupyter_client o ipykernel non installati');
  // Un kernelspec il cui python sparisce dopo l'avvio, come un venv cancellato
  const fs = require('fs');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-spec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = execFileSync('python3', ['-c', 'import sys; print(sys.executable)']).toString().trim();
  const py = path.join(dir, 'py');
  fs.symlinkSync(exe, py);
  fs.mkdirSync(path.join(dir, 'kernels', 'fragile'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'kernels', 'fragile', 'kernel.json'), JSON.stringify({
    argv: [py, '-m', 'ipykernel_launcher', '-f', '{connection_file}'], display_name: 'Fragile', language: 'python',
  }));
  let phase = 0;
  const events = await realBridge([{ cmd: 'start', kernel: 'fragile' }], (ev, bridge) => {
    if (phase === 0 && ev.some((e) => e.ev === 'ready')) {
      phase = 1;
      fs.unlinkSync(py);
      bridge.send({ cmd: 'restart' });
    }
    if (phase === 1 && ev.some((e) => e.ev === 'error')) {
      phase = 2;
      fs.symlinkSync(exe, py);
      bridge.send({ cmd: 'restart' });
      bridge.send({ cmd: 'execute', run: 'dopo', code: '6*7' });
    }
    return Boolean(doneOf(ev, 'dopo'));
  }, { env: { ...process.env, JUPYTER_PATH: dir }, timeout: 70000 });
  assert.strictEqual(events.filter((e) => e.ev === 'ready').length, 2);
  assert.strictEqual(doneOf(events, 'dopo').status, 'ok');
});

ok('ponte vero: un kernel che non esiste → missing con quelli disponibili', { timeout: 60000 }, async (t) => {
  if (!jupyterReady()) return t.skip('jupyter_client o ipykernel non installati');
  const events = await realBridge([{ cmd: 'start', kernel: 'nessuno-cosi' }], (ev) => ev.some((e) => e.ev === 'missing'));
  const missing = events.find((e) => e.ev === 'missing');
  assert.strictEqual(missing.what, 'kernel');
  assert.strictEqual(missing.kernel, 'nessuno-cosi');
  assert.ok(missing.available.includes('python3'));
});

ok('ponte vero: stdin chiuso → il ponte esce da solo', { timeout: 30000 }, async (t) => {
  if (!jupyterReady()) return t.skip('jupyter_client o ipykernel non installati');
  const code = await new Promise((resolve) => {
    const child = spawn('python3', ['-B', BRIDGE_SCRIPT], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('exit', resolve);
    child.stdin.end();
  });
  assert.strictEqual(code, 0);
});
