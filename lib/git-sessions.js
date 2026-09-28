'use strict';
const fs = require('fs');
const os = require('os');
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
 *
 * Il file ricorda anche quando è stato scritto (`savedAt`): confrontato con
 * l'accensione della macchina (savedBeforeBoot) dice se le schede vanno
 * riaperte da sole, come le sessioni tmux vive, o proposte nella finestra
 * del ripristino, come quelle perse col riavvio.
 */
function createGitSessionsStore({ dir, now = Date.now } = {}) {
  if (!dir) throw new Error('createGitSessionsStore richiede una directory');
  const file = path.join(dir, GIT_SESSIONS_FILE);

  /** @returns {{sessions: object[], savedAt: number|null}} */
  function readState() {
    try {
      if (!fs.existsSync(file)) return { sessions: [], savedAt: null };
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Prima di savedAt il file era solo la lista
      if (Array.isArray(data)) return { sessions: sanitizeGitSessions(data), savedAt: null };
      const savedAt = data && Number.isFinite(data.savedAt) ? data.savedAt : null;
      return { sessions: sanitizeGitSessions(data && data.sessions), savedAt };
    } catch {
      // file corrotto: si riparte senza schede git, non un crash all'avvio
      return { sessions: [], savedAt: null };
    }
  }

  const read = () => readState().sessions;

  function write(sessions) {
    const list = sanitizeGitSessions(sessions);
    try {
      fs.writeFileSync(file, JSON.stringify({ savedAt: now(), sessions: list }, null, 2));
    } catch (e) {
      console.error('git-sessions: scrittura fallita:', e.message || e);
    }
    return list;
  }

  return { file, read, readState, write };
}

/**
 * true se la macchina si è accesa dopo `savedAt`: le schede erano aperte a un
 * riavvio. Senza data (file vecchio) si risponde true: meglio chiedere che
 * riaprire da soli.
 * @param {number|null} savedAt
 * @param {{now?: number, uptime?: number}} clock uptime in secondi
 */
function savedBeforeBoot(savedAt, { now = Date.now(), uptime = os.uptime() } = {}) {
  if (!Number.isFinite(savedAt)) return true;
  return savedAt < now - uptime * 1000;
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

module.exports = { createGitSessionsStore, sanitizeGitSessions, savedBeforeBoot, GIT_SESSIONS_FILE, MAX_SESSIONS };
