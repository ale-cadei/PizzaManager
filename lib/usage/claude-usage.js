/* Uso di Claude Code, letto dalle conversazioni in ~/.claude/projects.
 *
 * Ogni risposta dell'assistente porta con se' il conto dei token
 * (`message.usage`) e il modello: e' la fonte piu' precisa che esista, e non
 * richiede ne' rete ne' il CLI acceso.
 *
 * Due problemi pratici, e come sono risolti qui:
 *
 * 1. I file sono grossi (decine di MB) e la barra si aggiorna ogni pochi
 *    secondi. Sono pero' append-only: la cache tiene per ogni file l'offset
 *    dell'ultima riga completa letta e gli eventi gia' estratti, e rilegge solo
 *    i byte nuovi. Un file immutato non viene nemmeno aperto.
 *
 * 2. La stessa risposta compare in piu' file (resume, sidechain). Si deduplica
 *    su `messageId:requestId`, che identifica la singola chiamata all'API.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJsonlReader } = require('./jsonl-cache');

const SOURCE = 'claude';

function projectsDir(home) {
  return path.join(home || os.homedir(), '.claude', 'projects');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Chiave di deduplica: identifica la singola chiamata all'API. */
function dedupKey(obj) {
  const id = obj && obj.message && obj.message.id;
  const req = obj && obj.requestId;
  if (!id && !req) return null; // senza chiave non si puo' deduplicare: si tiene
  return `${id || ''}:${req || ''}`;
}

/** Evento d'uso da una riga, o null se la riga non e' una risposta con usage. */
function eventFromRecord(obj) {
  if (!obj || obj.type !== 'assistant') return null;
  const msg = obj.message;
  const usage = msg && msg.usage;
  if (!usage || typeof usage !== 'object') return null;
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheWrite = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  if (!(input || output || cacheWrite || cacheRead)) return null;
  const model = String(msg.model || '');
  return {
    source: SOURCE,
    ts: Date.parse(obj.timestamp) || 0,
    model,
    input,
    output,
    cacheWrite,
    cacheRead,
    sessionId: String(obj.sessionId || obj.session_id || ''),
    cwd: String(obj.cwd || ''),
    key: dedupKey(obj),
  };
}

/**
 * Eventi contenuti in un blocco di righe JSONL, deduplicati fra loro.
 * Funzione pura: e' qui che sta la conoscenza del formato, verificabile su
 * fixture senza toccare il filesystem.
 * @param {Array<string>} lines
 * @returns {Array<object>}
 */
function eventsFromLines(lines) {
  const seen = new Set();
  return (Array.isArray(lines) ? lines : []).reduce((acc, line) => {
    const t = String(line || '').trim();
    if (!t.startsWith('{')) return acc;
    let obj = null;
    try { obj = JSON.parse(t); } catch { return acc; } // riga troncata dalla lettura parziale
    const e = eventFromRecord(obj);
    if (!e) return acc;
    if (e.key && seen.has(e.key)) return acc;
    if (e.key) seen.add(e.key);
    return [...acc, e];
  }, []);
}

/* La lettura incrementale (offset dell'ultima riga intera, niente rilettura di
   cio' che non e' cambiato) e' condivisa con Codex: lib/usage/jsonl-cache.js. */
const reader = createJsonlReader((lines) => eventsFromLines(lines));

function clearCache() {
  reader.clear();
}

function listConversationFiles(base) {
  const projects = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  return projects.flatMap((p) => {
    const dir = path.join(base, p.name);
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
    } catch {
      return []; // progetto illeggibile: si salta, il conteggio lo segnala a chi chiama
    }
  });
}

/**
 * Tutti gli eventi d'uso di Claude piu' recenti di `since`.
 * @param {{ home?: string, base?: string, since?: number }} [opts]
 * @returns {{ ok: boolean, error?: string, events: Array<object>,
 *             filesRead: number, filesSkipped: number, bytesRead: number }}
 */
function collectClaudeUsage({ home, base = projectsDir(home), since = 0 } = {}) {
  const empty = { events: [], filesRead: 0, filesSkipped: 0, bytesRead: 0 };
  if (!fs.existsSync(base)) {
    return { ok: false, error: `Directory ${base} non trovata. Nessun dato d'uso di Claude.`, ...empty };
  }
  try {
    const files = listConversationFiles(base);
    const out = files.reduce((acc, file) => {
      let stat = null;
      try { stat = fs.statSync(file); } catch { return { ...acc, filesSkipped: acc.filesSkipped + 1 }; }
      // Un file non toccato dopo `since` non puo' contenere eventi dentro la
      // finestra: non si apre. E' quello che tiene la barra leggera.
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

/** Deduplica fra file diversi: la stessa chiamata puo' comparire in piu' conversazioni. */
function dedupe(events) {
  const seen = new Set();
  return events.filter((e) => {
    if (!e.key) return true;
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
}

module.exports = { collectClaudeUsage, eventsFromLines, eventFromRecord, projectsDir, clearCache, dedupe, SOURCE };
