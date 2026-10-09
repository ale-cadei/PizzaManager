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

function createAgentSignalStore({ dir }) {
  const signalsDir = path.join(dir, 'signals');
  const hooksDir = path.join(dir, 'hooks');

  function pathFor(key) {
    if (!isValidKey(key)) throw new Error(`chiave del segnale non valida: ${key}`);
    return path.join(signalsDir, key);
  }

  function ensureDir() { fs.mkdirSync(signalsDir, { recursive: true }); }

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

  /** @returns {() => void} ferma l'osservazione */
  function watch(onSignal) {
    ensureDir();
    const w = fs.watch(signalsDir, (_event, name) => {
      const key = name ? String(name) : '';
      if (!isValidKey(key)) return;
      const state = read(key);
      if (state) onSignal(key, state);
    });
    w.on('error', (e) => console.error('[agent-signals] watch interrotto:', e.message));
    return () => w.close();
  }

  /** Il plugin opencode lo legge un processo esterno: sta in userData, non in app.asar. */
  function writePlugin(source) {
    fs.mkdirSync(hooksDir, { recursive: true });
    const p = path.join(hooksDir, PLUGIN_NAME);
    fs.writeFileSync(p, source);
    return p;
  }

  return { dir: signalsDir, pathFor, read, remove, sweep, watch, writePlugin, ensureDir };
}

module.exports = { createAgentSignalStore, parseState, isValidKey, STATES };
