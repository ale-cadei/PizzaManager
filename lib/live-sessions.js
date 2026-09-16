'use strict';
const fs = require('fs');
const path = require('path');

const LIVE_FILE = 'live-sessions.json';

/**
 * Specchio su disco delle sessioni vive in tmux.
 *
 * tmux protegge dalla chiusura dell'app, non dal riavvio della macchina: un
 * reboot termina il server e tutte le sue sessioni. Questo file viene
 * riscritto a ogni operazione (spawn, stacco, termina, cambio titolo o id) con
 * la lista corrente, cosi' se tmux sparisce il file dice cosa c'era. Il
 * riavvio non avvisa: per questo e' sempre aggiornato, non "salvato alla
 * chiusura".
 *
 * Non e' la cronologia (che registra ogni avvio, per sempre): e' l'insieme
 * delle sessioni aperte adesso. Una sessione terminata con ⏻ sparisce anche
 * da qui.
 */
function createLiveSessionsStore({ dir } = {}) {
  if (!dir) throw new Error('createLiveSessionsStore richiede una directory');
  const file = path.join(dir, LIVE_FILE);

  function read() {
    try {
      if (!fs.existsSync(file)) return [];
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.name === 'string') : [];
    } catch {
      return []; // file corrotto: niente da ripristinare, non un crash all'avvio
    }
  }

  function write(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    try {
      fs.writeFileSync(file, JSON.stringify(list, null, 2));
    } catch (e) {
      console.error('live-sessions: scrittura fallita:', e.message || e);
    }
    return list;
  }

  function clear() {
    return write([]);
  }

  return { file, read, write, clear };
}

/**
 * Cosa proporre di ripristinare: le sessioni che il registro dava per vive e
 * che tmux non ha piu'.
 *
 * Se tmux ha ancora QUALCHE sessione, quelle mancanti sono state uccise di
 * proposito (un kill-session a mano): non si propone niente e il registro va
 * riallineato. Se tmux e' vuoto ma il registro no, e' sparito tutto insieme
 * — riavvio, logout — e si propone. Il registro e' aggiornato a ogni ⏻,
 * quindi "tutto terminato dall'utente" lascia un registro vuoto, non pieno.
 */
function restorableSessions(snapshot, live) {
  const snap = Array.isArray(snapshot) ? snapshot : [];
  const alive = new Set((Array.isArray(live) ? live : []).map((s) => s.name));
  if (alive.size > 0) return { restorable: [], reconciled: snap.filter((s) => alive.has(s.name)) };
  return { restorable: snap, reconciled: snap };
}

/** Come ricreare una sessione persa: con id si riprende, senza si riparte pulita nella stessa directory. */
function restorePlan(session) {
  const type = session.type || 'shell';
  const base = {
    type,
    cwd: session.cwd || undefined,
    commandProfileId: session.profileId || null,
    claudeAccountId: session.accountId || null,
    name: session.label || null,
  };
  if (type !== 'shell' && session.resumeId) return { ...base, resumeId: session.resumeId, mode: 'resume' };
  return { ...base, resumeId: null, mode: 'fresh' };
}

module.exports = { createLiveSessionsStore, restorableSessions, restorePlan, LIVE_FILE };
