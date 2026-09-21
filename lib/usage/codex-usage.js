/* Uso di Codex CLI, letto dai rollout in ~/.codex/sessions/AAAA/MM/GG.
 *
 * Codex scrive un evento `token_count` a ogni turno con due conteggi:
 *   total_token_usage  cumulativo dall'inizio della sessione
 *   last_token_usage   il turno appena concluso
 * Si sommano i *delta* (`last_token_usage`): sommare i cumulativi conterebbe
 * ogni turno tante volte quanti sono i turni successivi.
 *
 * `input_tokens` comprende gia' i token letti dalla cache: qui la cache viene
 * scorporata, altrimenti i token di ingresso risulterebbero contati due volte.
 *
 * Il modello non sta nell'evento ma nel `turn_context` che lo precede: si
 * tiene quello piu' recente mentre si scorre il file.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJsonlReader } = require('./jsonl-cache');

const SOURCE = 'codex';
const ROLLOUT_PREFIX = 'rollout-';
const ROLLOUT_EXT = '.jsonl';

function sessionsDir(home) {
  return path.join(home || os.homedir(), '.codex', 'sessions');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Stato che scorre lungo il file: sessione e modello correnti. */
const START = Object.freeze({ sessionId: '', cwd: '', model: '', events: [], seen: null });

function withMeta(state, obj) {
  const p = obj.payload || {};
  return {
    ...state,
    sessionId: String(p.id || p.session_id || state.sessionId || ''),
    cwd: String(p.cwd || state.cwd || ''),
    model: String(p.model || state.model || ''),
  };
}

function eventFromTokenCount(obj, state) {
  const p = obj.payload || {};
  const info = p.info;
  const last = info && info.last_token_usage;
  if (!last) return null;
  const rawInput = num(last.input_tokens);
  const cacheRead = num(last.cached_input_tokens);
  const output = num(last.output_tokens);
  if (!(rawInput || output)) return null;
  const input = Math.max(0, rawInput - cacheRead);
  const model = state.model;
  return {
    source: SOURCE,
    ts: Date.parse(obj.timestamp) || 0,
    model,
    input,
    output,
    cacheWrite: 0,
    cacheRead,
    reasoning: num(last.reasoning_output_tokens),
    sessionId: state.sessionId,
    cwd: state.cwd,
    // Codex riporta da solo quanto resta della finestra: e' piu' affidabile di
    // qualunque stima nostra, quindi si passa avanti cosi' com'e'.
    rateLimits: p.rate_limits || null,
    key: `${state.sessionId}:${obj.timestamp}:${num(last.total_tokens)}`,
  };
}

/**
 * Eventi contenuti in un blocco di righe di rollout. Pura.
 * @param {Array<string>} lines
 * @returns {Array<object>}
 */
function eventsFromLines(lines) {
  const end = (Array.isArray(lines) ? lines : []).reduce((state, line) => {
    const t = String(line || '').trim();
    if (!t.startsWith('{')) return state;
    let obj = null;
    try { obj = JSON.parse(t); } catch { return state; } // riga troncata
    if (obj.type === 'session_meta' || obj.type === 'turn_context') return withMeta(state, obj);
    if (obj.type !== 'event_msg' || !obj.payload || obj.payload.type !== 'token_count') return state;
    const e = eventFromTokenCount(obj, state);
    if (!e) return state;
    const seen = state.seen || new Set();
    if (seen.has(e.key)) return { ...state, seen };
    seen.add(e.key);
    return { ...state, seen, events: [...state.events, e] };
  }, { ...START });
  return end.events;
}

const reader = createJsonlReader((lines) => eventsFromLines(lines));

function clearCache() {
  reader.clear();
}

/** Rollout sotto la directory delle sessioni (annidati per anno/mese/giorno). */
function listRolloutFiles(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listRolloutFiles(full);
    return e.isFile() && e.name.startsWith(ROLLOUT_PREFIX) && e.name.endsWith(ROLLOUT_EXT) ? [full] : [];
  });
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
}

/**
 * Eventi d'uso di Codex piu' recenti di `since`.
 * @param {{ home?: string, base?: string, since?: number }} [opts]
 * @returns {{ ok:boolean, error?:string, events:Array<object>, filesRead:number, filesSkipped:number, bytesRead:number }}
 */
function collectCodexUsage({ home, base = sessionsDir(home), since = 0 } = {}) {
  const empty = { events: [], filesRead: 0, filesSkipped: 0, bytesRead: 0 };
  if (!fs.existsSync(base)) {
    return { ok: false, error: `Directory ${base} non trovata. Nessun dato d'uso di Codex.`, ...empty };
  }
  try {
    const out = listRolloutFiles(base).reduce((acc, file) => {
      let stat = null;
      try { stat = fs.statSync(file); } catch { return { ...acc, filesSkipped: acc.filesSkipped + 1 }; }
      if (since && stat.mtimeMs < since) return { ...acc, filesSkipped: acc.filesSkipped + 1 };
      let read = null;
      try { read = reader.read(file, stat); } catch { return { ...acc, filesSkipped: acc.filesSkipped + 1 }; }
      return {
        events: [...acc.events, ...read.events],
        filesRead: acc.filesRead + 1,
        filesSkipped: acc.filesSkipped,
        bytesRead: acc.bytesRead + read.bytes,
      };
    }, empty);
    return { ok: true, ...out, events: dedupe(out.events).filter((e) => e.ts >= since) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), ...empty };
  }
}

module.exports = { collectCodexUsage, eventsFromLines, sessionsDir, clearCache, SOURCE };
