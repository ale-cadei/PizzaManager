/* Scoperta delle sessioni Codex CLI (per il dialog "Resume").
 *
 * Codex salva un rollout JSONL per sessione in
 *   ~/.codex/sessions/<AAAA>/<MM>/<GG>/rollout-<timestamp>-<uuid>.jsonl
 * La prima riga è un record `session_meta` con id, cwd e timestamp.
 *
 * Il titolo arriva da ~/.codex/session_index.jsonl (id -> thread_name), che
 * però copre solo le sessioni più recenti: come fallback si cerca il primo
 * messaggio utente nel rollout, saltando i blocchi di contesto automatici
 * (<environment_context>, <permissions instructions>, …).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROLLOUT_PREFIX = 'rollout-';
const ROLLOUT_EXT = '.jsonl';
// Il session_meta iniziale contiene le istruzioni di sistema (decine di KB):
// per intercettare il primo prompt utente serve leggere una testa generosa.
const HEAD_BYTES = 512 * 1024;
const TITLE_MAX = 80;
const DEFAULT_LIMIT = 100;

function codexHome() {
  return path.join(os.homedir(), '.codex');
}

function sessionsDir() {
  return path.join(codexHome(), 'sessions');
}

function sessionIndexFile() {
  return path.join(codexHome(), 'session_index.jsonl');
}

/** Mappa id -> thread_name letta da session_index.jsonl (assente = mappa vuota). */
function loadSessionIndex() {
  const map = new Map();
  try {
    const f = sessionIndexFile();
    if (!fs.existsSync(f)) return map;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const o = JSON.parse(line);
        if (o && o.id && o.thread_name) map.set(o.id, String(o.thread_name));
      } catch {}
    }
  } catch {}
  return map;
}

/** Elenca ricorsivamente i file rollout-*.jsonl sotto `dir`. */
function listRolloutFiles(dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listRolloutFiles(full));
    else if (e.isFile() && e.name.startsWith(ROLLOUT_PREFIX) && e.name.endsWith(ROLLOUT_EXT)) out.push(full);
  }
  return out;
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.slice(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Testo di un messaggio `response_item`, o null se non è un prompt utente reale. */
function userPromptText(obj) {
  if (!obj || obj.type !== 'response_item') return null;
  const p = obj.payload;
  if (!p || p.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) return null;
  const text = p.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('').trim();
  // I blocchi di contesto iniettati da Codex sono XML-like: non sono titoli utili
  if (!text || text.startsWith('<')) return null;
  return text;
}

/** Estrae { id, cwd, created, title } dalla testa del rollout. */
function parseRollout(file) {
  const head = readHead(file);
  let meta = null;
  let prompt = null;
  for (const line of head.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let obj = null;
    try { obj = JSON.parse(line); } catch { continue; } // riga troncata dalla lettura parziale
    if (!meta && obj.type === 'session_meta' && obj.payload) meta = obj.payload;
    if (!prompt) prompt = userPromptText(obj);
    if (meta && prompt) break;
  }
  if (!meta || !meta.id) return null;
  return {
    id: String(meta.id),
    cwd: meta.cwd || '',
    created: meta.timestamp || null,
    prompt: prompt ? prompt.replace(/\s+/g, ' ').slice(0, TITLE_MAX) : null,
  };
}

/**
 * Sessioni Codex ordinate dalla più recente.
 * @param {number} [limit]
 * @returns {{ ok: boolean, error?: string, sessions: Array<object> }}
 */
function listCodexSessions(limit) {
  const base = sessionsDir();
  if (!fs.existsSync(base)) {
    return { ok: false, error: `Directory ${base} non trovata. Nessuna sessione Codex.`, sessions: [] };
  }
  try {
    const index = loadSessionIndex();
    const out = [];
    for (const file of listRolloutFiles(base)) {
      let stat = null;
      try { stat = fs.statSync(file); } catch { continue; }
      let parsed = null;
      try { parsed = parseRollout(file); } catch { continue; }
      if (!parsed) continue;
      out.push({
        id: parsed.id,
        title: index.get(parsed.id) || parsed.prompt || parsed.id.slice(0, 8),
        cwd: parsed.cwd,
        mtime: stat.mtimeMs,
        created: parsed.created,
        file,
      });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, sessions: out.slice(0, limit || DEFAULT_LIMIT) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
}

module.exports = { listCodexSessions, sessionsDir, sessionIndexFile };
