'use strict';
/**
 * I file in cui gli hook degli agenti scrivono il loro stato (docs/plans/46).
 *
 * Un file per sessione, `<dir>/signals/<chiave>`, con una parola sola. La
 * chiave è il nome della sessione tmux (stabile fra un avvio e l'altro) o
 * `tab-<id>` senza tmux. Il file sopravvive all'app chiusa: un permesso chiesto
 * nel frattempo si ritrova alla riapertura.
 */
const fs = require('fs');
const path = require('path');

const STATES = ['ready', 'running', 'waiting', 'permission'];
const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
const PLUGIN_NAME = 'opencode-signal.mjs';

function parseState(text) {
  const word = String(text == null ? '' : text).trim();
  return STATES.includes(word) ? word : null;
}

function isValidKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** Attesa prima di riprovare un'osservazione morta, raddoppia fino a un minuto. */
const WATCH_RETRY_MS = 2000;
const WATCH_RETRY_MAX_MS = 60000;

function createAgentSignalStore({ dir, fsWatch = fs.watch, retryMs = WATCH_RETRY_MS }) {
  const signalsDir = path.join(dir, 'signals');
  const hooksDir = path.join(dir, 'hooks');

  function pathFor(key) {
    if (!isValidKey(key)) throw new Error(`chiave del segnale non valida: ${key}`);
    return path.join(signalsDir, key);
  }

  /* Il plugin è codice che opencode esegue e i file di stato li legge il
     main: solo l'utente ci scrive. chmod dopo, perché il mode di mkdir e
     writeFileSync vale solo alla creazione (come lib/scrollback.js). */
  function privateDir(d) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    fs.chmodSync(d, 0o700);
  }

  function ensureDir() { privateDir(signalsDir); }

  function read(key) {
    try { return parseState(fs.readFileSync(pathFor(key), 'utf8')); } catch { return null; }
  }

  function remove(key) {
    if (!isValidKey(key)) return;
    fs.rmSync(pathFor(key), { force: true });
  }

  /** Cancella i file delle sessioni che non esistono più. */
  function sweep(keepKeys) {
    const keep = new Set(keepKeys);
    let names = [];
    try { names = fs.readdirSync(signalsDir); } catch { return; }
    for (const name of names) if (!keep.has(name)) remove(name);
  }

  /**
   * fs.watch può morire (EMFILE, ENOSPC, filesystem senza inotify): senza
   * ripartire, le sessioni già esatte resterebbero ferme sull'ultimo stato.
   * Il primo avvio invece lancia: chi chiama sa che resta l'euristica.
   * @returns {() => void} ferma l'osservazione
   */
  function watch(onSignal) {
    let w = null;
    let timer = null;
    let stopped = false;
    let delay = retryMs;

    const onEvent = (_event, name) => {
      const key = name ? String(name) : '';
      if (!isValidKey(key)) return;
      const state = read(key);
      if (state) onSignal(key, state);
    };

    const retry = (why) => {
      console.error('[agent-signals] watch interrotto, riprovo:', why);
      if (stopped) return;
      timer = setTimeout(restart, delay);
      delay = Math.min(delay * 2, WATCH_RETRY_MAX_MS);
    };

    function open() {
      ensureDir();
      w = fsWatch(signalsDir, onEvent);
      w.on('error', (e) => {
        try { w.close(); } catch {}
        w = null;
        retry(e.message);
      });
    }

    function restart() {
      timer = null;
      if (stopped) return;
      try { open(); delay = retryMs; } catch (e) { retry(e.message); }
    }

    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (w) w.close();
    };
  }

  /** Il plugin opencode lo legge un processo esterno: sta in userData, non in app.asar. */
  function writePlugin(source) {
    privateDir(hooksDir);
    const p = path.join(hooksDir, PLUGIN_NAME);
    fs.writeFileSync(p, source, { mode: 0o600 });
    fs.chmodSync(p, 0o600);
    return p;
  }

  return { dir: signalsDir, pathFor, read, remove, sweep, watch, writePlugin, ensureDir };
}

module.exports = { createAgentSignalStore, parseState, isValidKey, STATES };
