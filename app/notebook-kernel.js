'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createKernelBridge, findPython: findPythonDefault, BRIDGE_SCRIPT } = require('../lib/kernel-bridge');
const { augmentedEnv } = require('../lib/binaries');
const { externalPath } = require('../lib/tmux');

const MAX_CODE = 1024 * 1024; // una cella più lunga non è codice scritto a mano
const KERNEL_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/; // i nomi dei kernelspec di Jupyter
const RUN_ID = /^[\w-]{1,64}$/;

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

function validDir(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Canali IPC dei kernel dei notebook (docs/plans/79). Ogni kernel è un
 * ponte Python (lib/kernel-bridge.js) di un webContents: solo quello lo
 * comanda e ne riceve gli eventi su `kernel-event`. Una ricarica o la
 * chiusura della finestra spengono i suoi kernel.
 *
 * Con `app` i kernel si spengono a `will-quit`: quando l'uscita è decisa,
 * non a un quit annullato.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{app?: Electron.App, createBridge?: Function, findPython?: () => string|null, env?: () => object, scriptPath?: string}} [opts]
 *   tutto sostituibile nei test
 * @returns {{shutdownAll: () => void}}
 */
function registerKernelHandlers(ipcMain, {
  app = null,
  createBridge = (opts) => createKernelBridge({ spawn, ...opts }),
  findPython = () => findPythonDefault(),
  env = () => augmentedEnv(),
  scriptPath = externalPath(BRIDGE_SCRIPT),
} = {}) {
  const kernels = new Map(); // id → {bridge, owner: webContents.id}
  const watched = new Set(); // webContents.id con i listener di pulizia
  let next = 0;

  const guard = (fn) => async (event, payload) => {
    try {
      return await fn(payload && typeof payload === 'object' ? payload : {}, event.sender);
    } catch (e) {
      console.error('[kernel]', e);
      return fail('kernel: ' + String((e && e.message) || e));
    }
  };

  function close(id) {
    const k = kernels.get(id);
    if (!k) return;
    kernels.delete(id);
    k.bridge.close();
  }

  function closeOwnedBy(owner) {
    for (const [id, k] of kernels) if (k.owner === owner) close(id);
  }

  function watchSender(sender) {
    if (watched.has(sender.id)) return;
    watched.add(sender.id);
    const forget = () => {
      sender.removeListener('destroyed', forget);
      sender.removeListener('did-start-loading', forget);
      watched.delete(sender.id);
      closeOwnedBy(sender.id);
    };
    sender.once('destroyed', forget);
    sender.once('did-start-loading', forget);
  }

  /** Il kernel `id` se è di `sender`. */
  const owned = (id, sender) => {
    const k = kernels.get(id);
    return k && k.owner === sender.id ? k : null;
  };

  ipcMain.handle('kernel-start', guard(({ dir, kernel }, sender) => {
    if (!validDir(dir)) return fail('kernel: cartella del notebook non valida');
    if (typeof kernel !== 'string' || !KERNEL_NAME.test(kernel)) return fail('kernel: nome del kernel non valido');
    const python = findPython();
    if (!python) return fail('Python non trovato nel PATH', { missing: 'python' });
    const id = `k${++next}`;
    const bridge = createBridge({
      python, script: scriptPath, cwd: dir, env: env(),
      onEvent: (event) => {
        if (event.ev === 'exit') kernels.delete(id);
        if (!sender.isDestroyed()) sender.send('kernel-event', { id, ...event });
      },
    });
    kernels.set(id, { bridge, owner: sender.id });
    watchSender(sender);
    bridge.send({ cmd: 'start', kernel, cwd: dir });
    return { ok: true, id };
  }));

  ipcMain.handle('kernel-execute', guard(({ id, run, code }, sender) => {
    const k = owned(id, sender);
    if (!k) return fail('kernel: non avviato');
    if (typeof run !== 'string' || !RUN_ID.test(run)) return fail('kernel: esecuzione non valida');
    if (typeof code !== 'string' || code.length > MAX_CODE) return fail('kernel: codice non valido o troppo lungo');
    k.bridge.send({ cmd: 'execute', run, code });
    return { ok: true };
  }));

  for (const cmd of ['interrupt', 'restart']) {
    ipcMain.handle(`kernel-${cmd}`, guard(({ id }, sender) => {
      const k = owned(id, sender);
      if (!k) return fail('kernel: non avviato');
      k.bridge.send({ cmd });
      return { ok: true };
    }));
  }

  ipcMain.handle('kernel-shutdown', guard(({ id }, sender) => {
    if (!owned(id, sender)) return fail('kernel: non avviato');
    close(id);
    return { ok: true };
  }));

  const shutdownAll = () => {
    for (const id of [...kernels.keys()]) close(id);
  };
  if (app) app.on('will-quit', shutdownAll);
  return { shutdownAll };
}

module.exports = { registerKernelHandlers, MAX_CODE };
