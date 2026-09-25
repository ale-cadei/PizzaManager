'use strict';
const fs = require('fs');
const path = require('path');

const GIT_SESSIONS_FILE = 'git-sessions.json';
const MAX_SESSIONS = 50;
const MAX_NAME = 40;
const MAX_CWD = 4096;

/**
 * Schede git aperte, da riaprire all'avvio successivo.
 *
 * Le altre sessioni sopravvivono in tmux e i loro metadati stanno lì
 * (`@ais_*`); una scheda git non ha un processo né una sessione tmux, quindi
 * l'unica traccia è questo file. Il renderer lo riscrive per intero a ogni
 * apertura, chiusura o rinomina: dice cosa c'è aperto adesso, non cosa si è
 * aperto in passato (quella è la cronologia).
 */
function createGitSessionsStore({ dir } = {}) {
  if (!dir) throw new Error('createGitSessionsStore richiede una directory');
  const file = path.join(dir, GIT_SESSIONS_FILE);

  function read() {
    try {
      if (!fs.existsSync(file)) return [];
      return sanitizeGitSessions(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      return []; // file corrotto: si riparte senza schede git, non un crash all'avvio
    }
  }

  function write(sessions) {
    const list = sanitizeGitSessions(sessions);
    try {
      fs.writeFileSync(file, JSON.stringify(list, null, 2));
    } catch (e) {
      console.error('git-sessions: scrittura fallita:', e.message || e);
    }
    return list;
  }

  return { file, read, write };
}

/**
 * Solo voci ben formate: arrivano dal renderer o da un file che qualcuno può
 * aver toccato. `name` null = la scheda prende il nome del repository.
 * @returns {{cwd: string, name: string|null, startedAt: number}[]}
 */
function sanitizeGitSessions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s.cwd !== 'string') continue;
    const cwd = s.cwd.trim();
    if (!cwd || cwd.length > MAX_CWD || /[\0-\x1f]/.test(cwd)) continue;
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, MAX_NAME) : null;
    const startedAt = Number.isFinite(s.startedAt) && s.startedAt > 0 ? s.startedAt : Date.now();
    out.push({ cwd, name, startedAt });
    if (out.length >= MAX_SESSIONS) break;
  }
  return out;
}

module.exports = { createGitSessionsStore, sanitizeGitSessions, GIT_SESSIONS_FILE, MAX_SESSIONS };
