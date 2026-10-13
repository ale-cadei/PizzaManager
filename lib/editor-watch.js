'use strict';
/* Cambi sul disco dei file aperti nella sessione editor (docs/plans/60).
 * Un fs.watch per file, eventi raggruppati (un salvataggio di un altro
 * editor ne produce diversi). Dopo ogni evento il watcher si riarma: chi
 * salva scrivendo un temporaneo e rinominandolo (anche lib/editor-fs.js)
 * sostituisce l'inode, e il vecchio watcher resterebbe muto.
 * Un watcher che fallisce non fa cadere niente: il renderer ricontrolla i
 * file quando la scheda torna in primo piano. */
const fs = require('fs');

/**
 * @param {{onChange: (c: {path: string, exists: boolean, mtime: number|null}) => void,
 *   debounceMs?: number, watchFn?: typeof fs.watch}} o
 */
function createEditorWatch({ onChange, debounceMs = 150, watchFn = fs.watch } = {}) {
  const entries = new Map(); // percorso assoluto → { count, watcher, timer }

  function disarm(entry) {
    if (!entry.watcher) return;
    try { entry.watcher.close(); } catch (e) { console.warn('[editor-watch] chiusura fallita:', e.message); }
    entry.watcher = null;
  }

  function arm(abs, entry) {
    disarm(entry);
    try {
      const w = watchFn(abs, () => schedule(abs));
      w.on('error', () => { disarm(entry); schedule(abs); });
      entry.watcher = w;
    } catch (err) {
      // ENOENT è atteso (file non c'è): silenzioso
      // Altri errori vanno loggati
      if (err.code !== 'ENOENT') {
        console.error('[editor-watch] watch fallito:', abs, err.message);
      }
      entry.watcher = null;
    }
  }

  function schedule(abs) {
    const entry = entries.get(abs);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { notify(abs, entry); }, debounceMs);
  }

  async function notify(abs, entry) {
    entry.timer = null;
    disarm(entry);
    const info = await fs.promises.stat(abs).catch(() => null);
    if (entries.get(abs) !== entry) return; // tolto nel frattempo
    if (info) arm(abs, entry);
    try {
      onChange({ path: abs, exists: Boolean(info), mtime: info ? info.mtimeMs : null });
    } catch (e) {
      console.error('[editor-watch] onChange:', e);
    }
  }

  function watch(abs) {
    const entry = entries.get(abs);
    if (entry) {
      entry.count += 1;
      if (!entry.watcher) arm(abs, entry);
      return Boolean(entry.watcher);
    }
    const created = { count: 1, watcher: null, timer: null };
    entries.set(abs, created);
    arm(abs, created);
    return Boolean(created.watcher);
  }

  function unwatch(abs) {
    const entry = entries.get(abs);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    clearTimeout(entry.timer);
    disarm(entry);
    entries.delete(abs);
  }

  function close() {
    for (const entry of entries.values()) {
      clearTimeout(entry.timer);
      disarm(entry);
    }
    entries.clear();
  }

  return { watch, unwatch, close, size: () => entries.size };
}

module.exports = { createEditorWatch };
