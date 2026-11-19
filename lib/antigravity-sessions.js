/* Scoperta delle conversazioni di Antigravity CLI (per il dialog "Resume").
 *
 * La CLI si chiama `agy` e tiene i suoi dati in ~/.gemini/antigravity-cli:
 *   cache/conversation_metadata.json  id -> { summary, last_modified_time }
 *   conversations/<id>.pb             la conversazione vera (protobuf binario;
 *                                     da agy 1.5 e' <id>.db, SQLite)
 *   history.jsonl                     una riga per prompt: cartella, ora, id
 *
 * I metadati bastano per la lista (titolo, workspace, data) e sono JSON, quindi
 * i .pb non vanno mai aperti. La cache però viene riscritta dalla CLI a fine
 * sessione: le conversazioni nuove esistono come file prima di comparirci, e per
 * questo le fonti vengono unite. Cartella e ora di una conversazione aperta
 * arrivano da history.jsonl (lib/antigravity-history.js): senza, la scheda non
 * riconosce la sua conversazione e al riavvio riparte vuota.
 *
 * Il resume avviene con `agy --conversation <id>`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readAgyHistory, orphanBornAt } = require('./antigravity-history');

const CONVERSATION_EXTS = Object.freeze(['.pb', '.db']);
const TITLE_MAX = 80;
const DEFAULT_LIMIT = 100;

function antigravityCliHome() {
  return path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

function metadataFile(home) {
  return path.join(home || antigravityCliHome(), 'cache', 'conversation_metadata.json');
}

function conversationsDir(home) {
  return path.join(home || antigravityCliHome(), 'conversations');
}

/** Millisecondi da una data ISO; 0 se assente o non parsabile. */
function toMillis(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Primo workspace come percorso locale.
 * Le URI sono `file:///percorso` con percent-encoding (gli spazi sono %20).
 */
function workspacePath(uris) {
  if (!Array.isArray(uris)) return '';
  const uri = uris.find((u) => typeof u === 'string' && u.startsWith('file://'));
  if (!uri) return '';
  try {
    return decodeURIComponent(uri.slice('file://'.length));
  } catch {
    return uri.slice('file://'.length); // percent-encoding malformato: meglio il grezzo di niente
  }
}

function shortTitle(value) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}

/** Voce della lista a partire da un record della cache, o null se da nascondere. */
function sessionFromMetadata(id, entry) {
  const summary = (entry && entry.summary) || {};
  if (entry && entry.is_internal) return null;
  if (summary.Internal) return null;
  const title = shortTitle(summary.Title || summary.Preview || '');
  return {
    id,
    title: title || id.slice(0, 8),
    cwd: workspacePath(summary.WorkspaceURIs),
    mtime: toMillis(entry && entry.last_modified_time) || toMillis(summary.UpdatedAt),
    created: summary.UpdatedAt || null,
    steps: typeof summary.NumSteps === 'number' ? summary.NumSteps : null,
  };
}

/** Mappa id -> voce, letta dalla cache dei metadati (assente = mappa vuota). */
function readMetadata(home) {
  const out = new Map();
  const file = metadataFile(home);
  let raw = null;
  try {
    if (!fs.existsSync(file)) return out;
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return out; // cache corrotta o a metà scrittura: si ripiega sui .pb
  }
  const conversations = (raw && raw.conversations) || {};
  for (const [id, entry] of Object.entries(conversations)) {
    const s = sessionFromMetadata(id, entry);
    if (s) out.set(id, s);
  }
  return out;
}

/** Mappa id -> { mtime, birth } per le conversazioni presenti su disco. */
function readConversationFiles(home) {
  const out = new Map();
  const dir = conversationsDir(home);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const ext = path.extname(e.name);
    if (!e.isFile() || !CONVERSATION_EXTS.includes(ext)) continue;
    const id = e.name.slice(0, -ext.length);
    let st = null;
    try { st = fs.statSync(path.join(dir, e.name)); } catch {}
    const prev = out.get(id);
    const mtime = Math.max(st ? st.mtimeMs : 0, prev ? prev.mtime : 0);
    out.set(id, { mtime, birth: (st && st.birthtimeMs) || (prev && prev.birth) || 0 });
  }
  return out;
}

/** Ora piu' recente e cartella (se mancava) da history.jsonl. */
function withHistory(session, seen) {
  if (!seen) return session;
  return { ...session, cwd: session.cwd || seen.cwd, mtime: Math.max(session.mtime, seen.mtime) };
}

/**
 * Conversazione ancora fuori dalla cache. La cartella viene dalla history:
 * dalle righe col suo id, o, dopo un solo prompt, da quello nato insieme al file.
 */
function freshSession(id, file, history) {
  const first = orphanBornAt(history.orphans, file.birth);
  const base = {
    id,
    title: first ? shortTitle(first.prompt) : id.slice(0, 8),
    cwd: first ? first.cwd : '',
    mtime: Math.max(file.mtime, first ? first.ts : 0),
    created: null,
    steps: null,
  };
  return withHistory(base, history.byId.get(id));
}

/**
 * Conversazioni di Antigravity CLI, dalla più recente.
 * @param {number} [limit]
 * @param {{ home?: string }} [opts] home alternativa (usata dai test)
 * @returns {{ ok: boolean, error?: string, sessions: Array<object> }}
 */
function listAntigravitySessions(limit, opts) {
  const home = (opts && opts.home) || antigravityCliHome();
  const hasMetadata = fs.existsSync(metadataFile(home));
  const hasConversations = fs.existsSync(conversationsDir(home));
  if (!hasMetadata && !hasConversations) {
    return {
      ok: false,
      error: `Nessuna conversazione in ${home}. Avvia almeno una sessione con 'agy'.`,
      sessions: [],
    };
  }
  try {
    const fromCache = readMetadata(home);
    const onDisk = readConversationFiles(home);
    const history = readAgyHistory(home);
    const cached = [...fromCache.values()].map((s) => withHistory(s, history.byId.get(s.id)));
    // Le conversazioni senza metadati sono troppo recenti per la cache
    const extra = [...onDisk.entries()]
      .filter(([id]) => !fromCache.has(id))
      .map(([id, f]) => freshSession(id, f, history));
    const sessions = [...cached, ...extra]
      .slice()
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit || DEFAULT_LIMIT);
    return { ok: true, sessions };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
}

module.exports = { listAntigravitySessions, antigravityCliHome, metadataFile, conversationsDir };
