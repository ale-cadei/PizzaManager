/* La ricerca nelle conversazioni in un thread a parte (docs/plans/22).
 *
 * Scorrere ~300 MB di JSONL nel main process lo fermerebbe per un secondo e
 * più, e con lui l'output di tutti i terminali. Lo stesso file fa da thread
 * (quando lo carica un Worker) e da client per il main (`createSearchWorker`).
 *
 * Una ricerca nuova annulla la precedente: il client incrementa un contatore
 * in memoria condivisa, il thread lo confronta con quello della sua ricerca
 * fra un file e l'altro. Il thread non può ricevere messaggi mentre lavora,
 * la memoria condivisa sì.
 *
 * Solo API di Node: il thread vive quanto l'app e tiene la cache dei titoli
 * di lib/claude-sessions.js fra una ricerca e l'altra.
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROLE = 'conversation-search';
const CANCELLED = { ok: false, cancelled: true, results: [] };

const failure = (prefix, e) => ({ ok: false, error: prefix + String((e && e.message) || e), results: [] });

function runThread({ generation, home }) {
  const { searchConversations } = require('./conversation-search');
  parentPort.on('message', ({ gen, query, scope, allSnippets }) => {
    const isCancelled = () => Atomics.load(generation, 0) !== gen;
    let result = CANCELLED;
    try {
      if (!isCancelled()) result = searchConversations(query, { home, scope, allSnippets, isCancelled });
    } catch (e) {
      result = failure('Ricerca fallita: ', e);
    }
    parentPort.postMessage({ gen, result });
  });
}

if (!isMainThread && workerData && workerData.role === ROLE) runThread(workerData);

/**
 * Client per il main process. Il thread parte alla prima ricerca e, se muore,
 * ripartirà alla successiva.
 * @param {{ home?: string }} [opts] home diversa solo nei test
 * @returns {{ search: (query: string, scope?: object[], allSnippets?: boolean) => Promise<object>, close: () => Promise<void> }}
 */
function createSearchWorker({ home } = {}) {
  const generation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  let worker = null;
  let pending = new Map(); // gen -> resolve

  function settle(gen, result) {
    const resolve = pending.get(gen);
    if (!resolve) return;
    pending = new Map([...pending].filter(([g]) => g !== gen));
    // Da fermo il thread non deve tenere in vita il processo
    if (!pending.size && worker) worker.unref();
    resolve(result);
  }

  function settleAll(result) {
    [...pending.keys()].forEach((gen) => settle(gen, result));
  }

  function start() {
    const w = new Worker(__filename, { workerData: { role: ROLE, generation, home } });
    w.on('message', ({ gen, result }) => settle(gen, result));
    w.on('error', (e) => {
      if (worker === w) worker = null;
      settleAll(failure('Ricerca interrotta: ', e));
    });
    w.on('exit', () => {
      if (worker === w) worker = null;
      settleAll(failure('Ricerca interrotta: ', 'il thread è terminato'));
    });
    return w;
  }

  /** Non rifiuta mai: errori e annullamenti tornano come `{ ok: false }`. */
  function search(query, scope, allSnippets = false) {
    const gen = Atomics.add(generation, 0, 1) + 1;
    try {
      if (!worker) worker = start();
      worker.ref();
      const w = worker;
      return new Promise((resolve) => {
        pending = new Map(pending).set(gen, resolve);
        w.postMessage({ gen, query, scope, allSnippets });
      });
    } catch (e) {
      return Promise.resolve(failure('Ricerca non avviata: ', e));
    }
  }

  async function close() {
    Atomics.add(generation, 0, 1);
    const w = worker;
    worker = null;
    settleAll(CANCELLED);
    if (w) await w.terminate();
  }

  return { search, close };
}

module.exports = { createSearchWorker };
