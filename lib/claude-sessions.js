'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Quanto si legge dall'inizio di ogni .jsonl per ricavarne un titolo.
const HEAD_BYTES = 64 * 1024;
const HEAD_LINES = 40;
const TITLE_MAX = 80;
const DEFAULT_LIMIT = 100;

function projectsDir(home = os.homedir()) {
  return path.join(home, '.claude', 'projects');
}

/**
 * Titolo e directory di lavoro dedotti dall'inizio di un file di sessione.
 *
 * Il formato .jsonl di Claude Code non è documentato: si procede per tentativi
 * e si ripiega su valori ricavabili dal nome del file. Funzione pura, così il
 * comportamento sui file malformati è verificabile con delle fixture.
 */
function parseSessionHead(head, { sessionId, projectDirName }) {
  let title = String(sessionId).slice(0, 8);
  let cwd = String(projectDirName || '').replace(/^-/, '').replace(/-/g, '/');
  for (const line of head.split('\n').slice(0, HEAD_LINES)) {
    if (!line.trim().startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // riga troncata o non JSON: si passa alla successiva
    }
    if (obj.cwd) cwd = obj.cwd;
    const msg = obj.message;
    if (msg && msg.role === 'user' && Array.isArray(msg.content)) {
      const t = msg.content.find((c) => c.type === 'text' && c.text);
      if (t && t.text.trim()) {
        title = t.text.trim().slice(0, TITLE_MAX);
        break;
      }
    }
    if (typeof obj.summary === 'string' && obj.summary) title = obj.summary.slice(0, TITLE_MAX);
  }
  return { title, cwd: cwd.startsWith('/') ? cwd : '/' + cwd };
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Sessioni Claude Code trovate scandendo ~/.claude/projects, più recenti prima. */
function listClaudeSessions(limit, { base = projectsDir() } = {}) {
  const out = [];
  try {
    if (!fs.existsSync(base)) {
      return { ok: false, error: 'Directory ' + base + ' non trovata. Nessuna sessione Claude.', sessions: [] };
    }
    const projDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const proj of projDirs) {
      const dir = path.join(base, proj);
      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue; // directory di progetto illeggibile
      }
      for (const f of files) {
        const fp = path.join(dir, f);
        try {
          const stat = fs.statSync(fp);
          const sessionId = path.basename(f, '.jsonl');
          const { title, cwd } = parseSessionHead(readHead(fp), { sessionId, projectDirName: proj });
          out.push({ id: sessionId, title, projectDir: proj, cwd, mtime: stat.mtimeMs, file: fp });
        } catch {
          // file sparito o illeggibile fra readdir e lettura: si salta
        }
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, sessions: out.slice(0, limit || DEFAULT_LIMIT) };
  } catch (e) {
    return { ok: false, error: String(e.message), sessions: [] };
  }
}

module.exports = { listClaudeSessions, parseSessionHead, projectsDir, HEAD_BYTES, TITLE_MAX };
