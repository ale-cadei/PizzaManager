'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Il testo del terminale delle shell, salvato per sopravvivere a un riavvio
 * della macchina.
 *
 * tmux protegge dalla chiusura dell'app, non dal reboot: il ripristino
 * (lib/live-sessions.js) ricrea la shell nella stessa cartella, ma vuota.
 * Qui si tiene cosa c'era scritto, per rimetterlo sopra la shell nuova.
 * Il processo non torna: torna il testo.
 *
 * Il contenuto e' quello che si e' visto a schermo, quindi puo' contenere
 * token, chiavi, un export sbagliato: i file si scrivono 0600 e si cancellano
 * appena la sessione finisce davvero.
 */

const DIR_NAME = 'scrollback';
const EXT = '.txt';
/** 2000 righe ~ 0,2-0,6 MB a sessione (misura in docs/plans/26-scrollback-shell.md). */
const MAX_LINES = 2000;
/** In grigio: e' un'annotazione dell'app, non output di un comando. */
const SEPARATOR = '\r\n\x1b[2m── cronologia ripristinata ──\x1b[0m\r\n';

/** Solo le shell, e non mentre un pager tiene l'alternate screen (sarebbe un fotogramma, non una cronologia). */
function shouldCapture({ type, alternate } = {}) {
  return type === 'shell' && !alternate;
}

/**
 * La chiave e' il nome della sessione (`ais-shell-...`), generato dall'app.
 * Si valida lo stesso: diventa un nome di file, e un nome che arriva da fuori
 * non deve poter indicare un'altra cartella.
 */
function safeKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error(`chiave di scrollback non valida: ${JSON.stringify(key)}`);
  }
  return key;
}

function createScrollbackStore({ dir } = {}) {
  if (!dir) throw new Error('createScrollbackStore richiede una directory');
  const base = path.join(dir, DIR_NAME);

  const fileFor = (key) => path.join(base, safeKey(key) + EXT);

  function save(key, text) {
    const file = fileFor(key);
    try {
      fs.mkdirSync(base, { recursive: true, mode: 0o700 });
      // Il mode di writeFileSync vale solo alla creazione: su un file gia'
      // esistente i permessi resterebbero quelli di prima (regola CLAUDE.md).
      fs.writeFileSync(file, String(text == null ? '' : text), { mode: 0o600 });
      fs.chmodSync(file, 0o600);
      return true;
    } catch (e) {
      console.error('scrollback: scrittura fallita:', e.message || e);
      return false;
    }
  }

  /** null se non c'e' niente di salvato: e' il caso normale, non un errore. */
  function read(key) {
    try {
      return fs.readFileSync(fileFor(key), 'utf8');
    } catch {
      return null;
    }
  }

  function remove(key) {
    try {
      fs.rmSync(fileFor(key), { force: true });
    } catch (e) {
      console.error('scrollback: cancellazione fallita:', e.message || e);
    }
  }

  /**
   * Via i file di sessioni che non esistono piu'. Senza, la cartella cresce
   * per sempre — di file che possono contenere segreti — ogni volta che l'app
   * viene uccisa prima di poter cancellare i suoi.
   */
  function sweep(validKeys) {
    const keep = new Set(Array.isArray(validKeys) ? validKeys : []);
    let names = [];
    try {
      names = fs.readdirSync(base);
    } catch {
      return; // cartella mai creata: niente da pulire
    }
    for (const name of names) {
      if (!name.endsWith(EXT)) continue;
      if (keep.has(name.slice(0, -EXT.length))) continue;
      try { fs.rmSync(path.join(base, name), { force: true }); } catch {}
    }
  }

  return { dir: base, fileFor, save, read, remove, sweep };
}

module.exports = { createScrollbackStore, shouldCapture, safeKey, SEPARATOR, MAX_LINES, DIR_NAME };
