/* Scoperta delle conversazioni di Antigravity CLI (per il dialog "Resume").
 *
 * La CLI si chiama `agy` e tiene i suoi dati in ~/.gemini/antigravity-cli:
 *   cache/conversation_metadata.json  id -> { summary, last_modified_time }
 *   conversations/<id>.pb             la conversazione vera (protobuf binario)
 *
 * I metadati bastano per la lista (titolo, workspace, data) e sono JSON, quindi
 * i .pb non vanno mai aperti. La cache però viene riscritta dalla CLI a fine
 * sessione: le conversazioni nuove esistono come .pb prima di comparirci, e per
 * questo le due fonti vengono unite.
 *
 * Il resume avviene con `agy --conversation <id>`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONVERSATION_EXT = '.pb';
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

/** Mappa id -> { mtime } per i .pb presenti su disco. */
function readConversationFiles(home) {
  const out = new Map();
  const dir = conversationsDir(home);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(CONVERSATION_EXT)) continue;
    const id = e.name.slice(0, -CONVERSATION_EXT.length);
    let mtime = 0;
    try { mtime = fs.statSync(path.join(dir, e.name)).mtimeMs; } catch {}
    out.set(id, { mtime });
  }
  return out;
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
    // I .pb senza metadati sono conversazioni troppo recenti per la cache
    const extra = [...onDisk.entries()]
      .filter(([id]) => !fromCache.has(id))
      .map(([id, f]) => ({ id, title: id.slice(0, 8), cwd: '', mtime: f.mtime, created: null, steps: null }));
    const sessions = [...fromCache.values(), ...extra]
      .slice()
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit || DEFAULT_LIMIT);
    return { ok: true, sessions };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
}

module.exports = { listAntigravitySessions, antigravityCliHome, metadataFile, conversationsDir };
