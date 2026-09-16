'use strict';
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = 'sessions-history.json';
const MAX_ENTRIES = 200;

/**
 * Cronologia delle sessioni aperte, su file JSON.
 *
 * La directory arriva dall'esterno invece di essere letta da Electron: è ciò
 * che rende il modulo utilizzabile (e verificabile) fuori dall'app.
 */
function createHistoryStore({ dir, maxEntries = MAX_ENTRIES } = {}) {
  if (!dir) throw new Error('createHistoryStore richiede una directory');
  const file = path.join(dir, HISTORY_FILE);

  function load() {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // file assente o illeggibile: la cronologia riparte vuota
    }
    return [];
  }

  function append(entry, now = new Date()) {
    try {
      const updated = [{ ...entry, lastOpened: now.toISOString() }, ...load()].slice(0, maxEntries);
      fs.writeFileSync(file, JSON.stringify(updated, null, 2));
      return updated;
    } catch (e) {
      console.error('Scrittura cronologia fallita:', e.message || e);
      return load();
    }
  }

  return { file, load, append };
}

module.exports = { createHistoryStore, HISTORY_FILE, MAX_ENTRIES };
