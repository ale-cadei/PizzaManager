/* Lettura incrementale di file JSONL append-only.
 *
 * I log di Claude e di Codex hanno formati diversi ma lo stesso problema: sono
 * grossi, crescono in coda e vengono riletti ogni pochi secondi. La regola e'
 * la stessa per entrambi, quindi sta scritta una volta sola qui: si tiene
 * l'offset dell'ultima riga *completa* letta e si rileggono solo i byte nuovi.
 *
 * Perche' l'offset e non la dimensione: il CLI puo' essere a meta' di una riga
 * quando leggiamo. Quella riga si scarta (JSON troncato) e si riparte da dove
 * finiva l'ultima riga intera, altrimenti andrebbe persa per sempre.
 */
'use strict';
const fs = require('fs');

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

/**
 * @param {(lines: Array<string>, ctx: object) => Array<object>} parseLines
 *        trasforma righe complete in eventi; riceve `{ file }` come contesto
 * @returns {{ read: Function, clear: Function, size: Function }}
 */
function createJsonlReader(parseLines) {
  /* Map file -> { mtime, size, offset, events }. Sostituita, mai mutata. */
  let cache = new Map();

  /**
   * Eventi del file, rileggendo solo la parte nuova.
   * @returns {{ events: Array<object>, bytes: number }} bytes = quanti byte letti ora
   */
  function read(file, stat) {
    const hit = cache.get(file);
    if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return { events: hit.events, bytes: 0 };
    // File rimpicciolito: e' stato troncato o sostituito, la cache non vale piu'.
    const grown = hit && stat.size >= hit.size;
    const from = grown ? hit.offset : 0;
    const before = grown ? hit.events : [];
    const length = stat.size - from;
    if (length <= 0) {
      const entry = { mtime: stat.mtimeMs, size: stat.size, offset: from, events: before };
      cache = new Map(cache).set(file, entry);
      return { events: entry.events, bytes: 0 };
    }
    const chunk = readRange(file, from, length);
    const lastNewline = chunk.lastIndexOf('\n');
    const complete = lastNewline >= 0 ? chunk.slice(0, lastNewline) : '';
    const fresh = complete ? parseLines(complete.split('\n'), { file }) : [];
    const entry = {
      mtime: stat.mtimeMs,
      size: stat.size,
      offset: from + (lastNewline >= 0 ? lastNewline + 1 : 0),
      events: [...before, ...fresh],
    };
    cache = new Map(cache).set(file, entry);
    return { events: entry.events, bytes: length };
  }

  function clear() {
    cache = new Map();
  }

  function size() {
    return cache.size;
  }

  return { read, clear, size };
}

module.exports = { createJsonlReader, readRange };
