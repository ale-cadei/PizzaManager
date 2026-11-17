/* Scoperta delle sessioni di GitHub Copilot CLI (per il dialog "Resume").
 *
 * La CLI si chiama `copilot` e tiene i dati in ~/.copilot (o $COPILOT_HOME,
 * che sostituisce l'intero percorso). Una cartella per sessione:
 *   session-state/<uuid>/workspace.yaml   metadati: id, name, cwd, date…
 *   session-state/<uuid>/events.jsonl     un evento JSON per riga
 * Le versioni vecchie scrivevano `session-state/<uuid>.jsonl` piatto.
 *
 * Non è un'API pubblica (docs/plans/97-copilot.md): si legge solo quello che
 * serve alla lista, e un campo che manca non è un errore.
 *
 * Il resume avviene con `copilot --resume=<id>`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const TITLE_MAX = 80;
const DEFAULT_LIMIT = 100;
/* Di events.jsonl basta l'inizio: session.start e il primo messaggio
   stanno in testa, e una sessione lunga può pesare molti MB. */
const EVENTS_HEAD_BYTES = 64 * 1024;
const WORKSPACE_FILE = 'workspace.yaml';
const EVENTS_FILE = 'events.jsonl';
const FLAT_EXT = '.jsonl';
const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_]*):(?:\s+(.*))?$/;

/** La cartella dei dati di Copilot: $COPILOT_HOME vince su ~/.copilot. */
function copilotHome(env = process.env, home = os.homedir()) {
  return env.COPILOT_HOME || path.join(home, '.copilot');
}

function sessionStateDir(home) {
  return path.join(home, 'session-state');
}

function unquote(value) {
  const v = value.trim();
  const quoted = v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0];
  return quoted ? v.slice(1, -1) : v;
}

/**
 * Le chiavi di primo livello `chiave: valore` di un workspace.yaml. Niente
 * libreria YAML: le righe indentate, i commenti e le liste si saltano.
 * @param {unknown} text
 * @returns {Record<string, string>}
 */
function parseWorkspaceYaml(text) {
  if (typeof text !== 'string') return {};
  return text.split(/\r?\n/).reduce((acc, line) => {
    const m = TOP_LEVEL_KEY.exec(line);
    return m ? { ...acc, [m[1]]: unquote(m[2] || '') } : acc;
  }, {});
}

function shortTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}

function toMillis(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function mtimeOf(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

/** I primi byte del file come testo: le righe intere, l'ultima monca si scarta. */
function readHead(file, bytes = EVENTS_HEAD_BYTES) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    const text = buf.subarray(0, n).toString('utf8');
    return n < bytes ? text : text.slice(0, text.lastIndexOf('\n') + 1);
  } catch {
    return '';
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/** cwd dal session.start e testo del primo user.message, dall'inizio degli eventi. */
function eventsSummary(file) {
  const events = readHead(file).split('\n').map(parseLine).filter((e) => e && typeof e === 'object');
  const startEv = events.find((e) => e.type === 'session.start');
  const firstMsg = events.find((e) => e.type === 'user.message' && e.data && typeof e.data.content === 'string');
  const ctx = (startEv && startEv.data && startEv.data.context) || {};
  return {
    cwd: typeof ctx.cwd === 'string' ? ctx.cwd : '',
    firstMessage: firstMsg ? firstMsg.data.content : '',
  };
}

/**
 * Voce della lista per una sessione.
 * @param {string} id
 * @param {{ yamlFile?: string|null, eventsFile: string }} files
 */
function sessionEntry(id, { yamlFile = null, eventsFile }) {
  const meta = yamlFile ? parseWorkspaceYaml(readText(yamlFile)) : {};
  const ev = eventsSummary(eventsFile);
  const title = shortTitle(meta.name) || shortTitle(meta.summary) || shortTitle(ev.firstMessage);
  return {
    id,
    title: title || id.slice(0, 8),
    cwd: meta.cwd || ev.cwd,
    mtime: toMillis(meta.updated_at) || mtimeOf(eventsFile) || mtimeOf(yamlFile) || toMillis(meta.created_at),
  };
}

function entriesIn(dir) {
  /* I nomi col punto non sono sessioni: Copilot ci tiene i lock
     (`.session-operation-locks/`). */
  const items = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  return items.flatMap((e) => {
    if (e.isDirectory()) {
      const base = path.join(dir, e.name);
      return [sessionEntry(e.name, { yamlFile: path.join(base, WORKSPACE_FILE), eventsFile: path.join(base, EVENTS_FILE) })];
    }
    if (e.isFile() && e.name.endsWith(FLAT_EXT)) {
      return [sessionEntry(e.name.slice(0, -FLAT_EXT.length), { eventsFile: path.join(dir, e.name) })];
    }
    return [];
  });
}

/**
 * Sessioni di Copilot CLI, dalla più recente.
 * @param {number} [limit]
 * @param {{ home?: string }} [opts] cartella dei dati alternativa (i test)
 * @returns {{ ok: boolean, error?: string, sessions: Array<{id: string, title: string, cwd: string, mtime: number}> }}
 */
function listCopilotSessions(limit, opts) {
  const home = (opts && opts.home) || copilotHome();
  const dir = sessionStateDir(home);
  if (!fs.existsSync(dir)) {
    return { ok: false, error: `Nessuna sessione in ${dir}. Avvia almeno una sessione con 'copilot'.`, sessions: [] };
  }
  try {
    const sessions = entriesIn(dir)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit || DEFAULT_LIMIT);
    return { ok: true, sessions };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
}

module.exports = { listCopilotSessions, parseWorkspaceYaml, copilotHome, sessionStateDir };
