/* Conversazioni di Claude Code: ~/.claude/projects/<progetto>/<id>.jsonl
 *
 * Il titolo serve sia al dialog di resume sia al nome automatico della scheda,
 * quindi deve somigliare a quello che l'utente ha in testa: il suo prompt.
 * Nel file convivono però molte righe che prompt non sono — hook, attachment,
 * tool_result, contesto iniettato dall'IDE — e il formato cambia fra versioni
 * (`message.content` è una stringa oppure un elenco di blocchi).
 *
 * Ordine di preferenza del titolo:
 *   1. `ai-title`: il titolo che Claude stesso dà alla conversazione, preso
 *      dall'ultima occorrenza (viene riscritto mentre la sessione va avanti)
 *   2. il primo prompt utente vero
 *   3. il `summary` di una conversazione compattata
 *   4. l'id abbreviato, per non mostrare mai una riga senza nome
 *
 * I file arrivano a decine di MB: si leggono solo testa e coda, con una cache
 * invalidata da mtime e dimensione (una sessione attiva riscrive solo la sua).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HEAD_BYTES = 256 * 1024; // un singolo hook di SessionStart supera i 16 KB
const TAIL_BYTES = 64 * 1024;
const TITLE_MAX = 80;
const DEFAULT_LIMIT = 100;

/* Blocchi che Claude inietta nel messaggio utente: sono contesto, non prompt.
   Va via tutto il blocco, tag e contenuto, non solo i tag. */
const INJECTED_TAGS = [
  'ide_opened_file', 'ide_selection', 'system-reminder', 'command-name',
  'command-message', 'command-args', 'local-command-stdout', 'local-command-stderr',
  'user-prompt-submit-hook',
];
const INJECTED_BLOCK = new RegExp(`<(${INJECTED_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>|<(${INJECTED_TAGS.join('|')})\\b[^>]*\\/?>`, 'gi');
const NOT_A_PROMPT = [
  /^caveat:/i,
  /^\[request interrupted/i,
  /^<[a-z]/i, // resta un blocco XML-like dopo la ripulitura: non è un titolo
];

function projectsDir(home) {
  return path.join(home || os.homedir(), '.claude', 'projects');
}

/** Il nome della directory di progetto è il path con i separatori sostituiti
 *  da `-`. Su Windows anche i due punti dell'unità: `C--Users-jack` è `C:\Users\jack`.
 *  È solo un ripiego per i file senza `cwd`: i trattini veri nei nomi delle
 *  cartelle sono indistinguibili da quelli dei separatori. */
function cwdFromProjectDir(name, { platform = process.platform } = {}) {
  const raw = String(name || '');
  if (platform === 'win32') {
    const m = /^([A-Za-z])--?(.*)$/.exec(raw);
    if (!m) return '';
    return `${m[1].toUpperCase()}:\\` + m[2].replace(/-/g, '\\');
  }
  const guess = raw.replace(/^-/, '').replace(/-/g, '/');
  if (!guess) return '';
  return guess.startsWith('/') ? guess : '/' + guess;
}

function readRange(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Righe complete: la lettura parziale tronca l'ultima (e la prima, in coda). */
function completeLines(chunk, { dropFirst = false } = {}) {
  const lines = String(chunk).split('\n');
  return dropFirst ? lines.slice(1) : lines;
}

function parseLine(line) {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try { return JSON.parse(t); } catch { return null; } // riga troncata dalla lettura parziale
}

/** Testo di un `message.content`, che può essere stringa o elenco di blocchi. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** Messaggio scritto dall'utente, ripulito dai blocchi iniettati ma con i suoi
 *  a capo; null se la riga è contesto, meta o output di tool. */
function userMessageText(obj) {
  if (!obj || obj.isMeta) return null;
  const msg = obj.message;
  if (!msg || msg.role !== 'user') return null;
  const raw = contentText(msg.content);
  if (!raw) return null; // solo tool_result o blocchi non testuali
  const text = raw.replace(INJECTED_BLOCK, ' ').trim();
  if (!text || NOT_A_PROMPT.some((re) => re.test(text))) return null;
  return text;
}

/** Prompt utente vero su una riga sola (per il titolo), o null. */
function userPromptText(obj) {
  const text = userMessageText(obj);
  return text === null ? null : normalize(text);
}

function aiTitleOf(obj) {
  if (!obj || obj.type !== 'ai-title') return null;
  return normalize(obj.aiTitle) || null;
}

function summaryOf(obj) {
  if (!obj || typeof obj.summary !== 'string') return null;
  return normalize(obj.summary) || null;
}

const NOTHING_FOUND = { aiTitle: null, prompt: null, summary: null, cwd: '' };

/**
 * Candidati al titolo trovati in un blocco di righe, a partire da quelli già
 * raccolti. Vincono il primo prompt e il primo cwd, ma l'ultimo `ai-title`:
 * Claude lo riscrive mentre la conversazione va avanti.
 */
function collect(lines, found) {
  return lines.reduce((acc, line) => {
    const obj = parseLine(line);
    if (!obj) return acc;
    return {
      aiTitle: aiTitleOf(obj) || acc.aiTitle,
      prompt: acc.prompt || userPromptText(obj),
      summary: acc.summary || summaryOf(obj),
      cwd: acc.cwd || (typeof obj.cwd === 'string' ? obj.cwd : ''),
    };
  }, found);
}

/**
 * Quello che serve alla UI, dati i candidati raccolti.
 * Claude crea il file all'avvio, prima di qualsiasi prompt: finché il titolo è
 * solo l'id di ripiego va segnalato (`titled: false`), altrimenti la scheda si
 * chiamerebbe "3b1cafe4".
 */
function titleAndCwd(found, { id, fallbackCwd }) {
  const real = found.aiTitle || found.prompt || found.summary;
  return {
    title: (real || String(id).slice(0, 8)).slice(0, TITLE_MAX),
    titled: !!real,
    cwd: found.cwd || fallbackCwd,
  };
}

/**
 * Titolo e directory di una conversazione date le sue righe. Funzione pura: è
 * qui che sta la conoscenza del formato .jsonl, verificabile su fixture.
 * @returns {{ title: string, titled: boolean, cwd: string }}
 */
function sessionFromLines(lines, { id, fallbackCwd = '' } = {}) {
  return titleAndCwd(collect(lines, NOTHING_FOUND), { id, fallbackCwd });
}

/** Come sessionFromLines, ma leggendo dal file solo la testa e la coda. */
function readSession(file, { id, fallbackCwd, size }) {
  const head = collect(completeLines(readRange(file, 0, Math.min(HEAD_BYTES, size))), NOTHING_FOUND);
  if (size <= HEAD_BYTES) return titleAndCwd(head, { id, fallbackCwd });
  const start = Math.max(HEAD_BYTES, size - TAIL_BYTES);
  const tail = collect(completeLines(readRange(file, start, size - start), { dropFirst: true }), head);
  return titleAndCwd(tail, { id, fallbackCwd });
}

/* I file sono grossi e la sidebar rilegge spesso: si rilegge solo ciò che è
   cambiato davvero. La cache è sostituita, non mutata riga per riga. */
let cache = new Map();

function cachedSession(file, stat, ctx) {
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.value;
  const value = readSession(file, { ...ctx, size: stat.size });
  cache = new Map(cache).set(file, { mtime: stat.mtimeMs, size: stat.size, value });
  return value;
}

function clearCache() {
  cache = new Map();
}

/**
 * I file .jsonl delle conversazioni, uno per sessione, sotto `base`.
 * `skipped` conta le cartelle di progetto che non si sono potute leggere.
 * Lancia se `base` stessa non è leggibile: lo decide il chiamante.
 * @returns {{ files: Array<{ file: string, id: string, projectDir: string }>, skipped: number }}
 */
function claudeSessionFiles(base = projectsDir()) {
  const projects = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  return projects.reduce((acc, proj) => {
    const dir = path.join(base, proj.name);
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return { ...acc, skipped: acc.skipped + 1 }; } // progetto illeggibile
    const files = names.map((f) => ({ file: path.join(dir, f), id: path.basename(f, '.jsonl'), projectDir: proj.name }));
    return { files: acc.files.concat(files), skipped: acc.skipped };
  }, { files: [], skipped: 0 });
}

/**
 * Conversazioni Claude ordinate dalla più recente.
 * @param {number} [limit]
 * @param {{ home?: string, base?: string }} [opts] percorsi diversi solo nei test
 * @returns {{ ok: boolean, error?: string, sessions: Array<object> }}
 */
function listClaudeSessions(limit, { home, base = projectsDir(home), platform = process.platform } = {}) {
  try {
    if (!fs.existsSync(base)) {
      return { ok: false, error: `Directory ${base} non trovata. Nessuna sessione Claude.`, sessions: [] };
    }
    const out = [];
    // Il formato .jsonl non e' documentato e i file possono essere in scrittura:
    // saltare un file e' giusto, saltarlo in silenzio no. Si contano gli scarti
    // e si riportano, cosi' "la lista e' corta" ha una spiegazione.
    const listed = claudeSessionFiles(base);
    let skipped = listed.skipped;
    for (const { file, id, projectDir } of listed.files) {
      let stat = null;
      try { stat = fs.statSync(file); } catch { skipped++; continue; } // sparito fra readdir e stat
      let read = null;
      try { read = cachedSession(file, stat, { id, fallbackCwd: cwdFromProjectDir(projectDir, { platform }) }); } catch { skipped++; continue; }
      out.push({ id, title: read.title, titled: read.titled, projectDir, cwd: read.cwd, mtime: stat.mtimeMs, file });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, sessions: out.slice(0, limit || DEFAULT_LIMIT), ...(skipped ? { skipped } : {}) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), sessions: [] };
  }
}

module.exports = {
  listClaudeSessions,
  claudeSessionFiles,
  sessionFromLines,
  projectsDir,
  cwdFromProjectDir,
  userPromptText,
  userMessageText,
  contentText,
  clearCache,
  HEAD_BYTES,
  TITLE_MAX,
};
