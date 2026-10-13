'use strict';
/* Schede editor aperte, da riaprire al prossimo avvio (docs/plans/60).
 * Come lib/git-sessions.js: la lista la scrive per intero il renderer a ogni
 * cambio, qui si sanifica (è un file che chiunque può toccare) e si ricorda
 * quando è stata scritta, per savedBeforeBoot. Le modifiche non salvate non
 * ci sono: solo quali file erano aperti. */
const fs = require('fs');
const path = require('path');
const { safeRel } = require('./editor-paths');

const EDITOR_SESSIONS_FILE = 'editor-sessions.json';
const MAX_SESSIONS = 50;
const MAX_FILES = 30;
const MAX_CWD = 4096;
const MAX_NAME = 40;
const CONTROL = /[\x00-\x1f\x7f]/;

function cleanCwd(value) {
  if (typeof value !== 'string') return null;
  const cwd = value.trim();
  if (!cwd || cwd.length > MAX_CWD || CONTROL.test(cwd)) return null;
  return path.posix.isAbsolute(cwd) || path.win32.isAbsolute(cwd) ? cwd : null;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= MAX_NAME && !CONTROL.test(name) ? name : null;
}

function cleanFiles(value) {
  const out = [];
  for (const f of Array.isArray(value) ? value : []) {
    const rel = safeRel(f);
    if (rel && !out.includes(rel)) out.push(rel);
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/**
 * @returns {{name: string|null, cwd: string, files: string[], active: string|null, startedAt: number|null}[]}
 */
function sanitizeEditorSessions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const cwd = cleanCwd(s.cwd);
    if (!cwd) continue;
    const files = cleanFiles(s.files);
    const wanted = safeRel(s.active);
    out.push({
      name: cleanName(s.name),
      cwd,
      files,
      active: files.includes(wanted) ? wanted : (files[0] || null),
      startedAt: Number.isFinite(s.startedAt) ? s.startedAt : null,
    });
    if (out.length >= MAX_SESSIONS) break;
  }
  return out;
}

function createEditorSessionsStore({ dir, now = Date.now } = {}) {
  if (!dir) throw new Error('createEditorSessionsStore richiede una directory');
  const file = path.join(dir, EDITOR_SESSIONS_FILE);

  /** @returns {{sessions: object[], savedAt: number|null}} */
  function readState() {
    try {
      if (!fs.existsSync(file)) return { sessions: [], savedAt: null };
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const savedAt = data && Number.isFinite(data.savedAt) ? data.savedAt : null;
      return { sessions: sanitizeEditorSessions(data && data.sessions), savedAt };
    } catch (e) {
      // file corrotto: si riparte senza schede editor, non un crash all'avvio
      console.warn('editor-sessions: file illeggibile, si riparte vuoti:', e.message || e);
      return { sessions: [], savedAt: null };
    }
  }

  function write(list) {
    const sessions = sanitizeEditorSessions(list);
    try {
      fs.writeFileSync(file, JSON.stringify({ savedAt: now(), sessions }, null, 2));
    } catch (e) {
      console.error('editor-sessions: scrittura fallita:', e.message || e);
    }
    return sessions;
  }

  return { file, read: () => readState().sessions, readState, write };
}

module.exports = { createEditorSessionsStore, sanitizeEditorSessions, EDITOR_SESSIONS_FILE, MAX_SESSIONS, MAX_FILES };
