'use strict';
/* Cambi dei file aperti su un server SSH (docs/plans/94). fs.watch non
 * arriva sul server: ogni `intervalMs` si chiedono gli mtime di tutti i
 * file guardati, un giro per server (`statMany` di lib/editor-remote-fs.js),
 * e si avvisa per quelli cambiati. Stessa forma di evento di
 * lib/editor-watch.js; `path` è una chiave scelta da chi chiama (app/editor.js
 * mette davanti l'ambiente: due server possono avere lo stesso percorso).
 * Un giro fallito (server giù) non avvisa: al giro dopo si riprova. */

const INTERVAL_MS = 3000;

/**
 * @param {{ onChange: (c: {path: string, exists: boolean, mtime: number|null}) => void,
 *   intervalMs?: number, timers?: {setInterval: Function, clearInterval: Function} }} o
 */
function createEditorRemoteWatch({ onChange, intervalMs = INTERVAL_MS, timers = globalThis } = {}) {
  const entries = new Map(); // chiave → { files, rel, mtime, count }
  let timer = null;
  let polling = false;

  function startOrStop() {
    if (entries.size && !timer) {
      timer = timers.setInterval(() => { poll(); }, intervalMs);
      if (timer && timer.unref) timer.unref();
    } else if (!entries.size && timer) {
      timers.clearInterval(timer);
      timer = null;
    }
  }

  /**
   * @param {string} key
   * @param {{statMany: Function, stat: Function}} files il backend remoto della scheda
   * @param {string} rel
   * @returns {Promise<boolean>} armato
   */
  async function watch(key, files, rel) {
    const known = entries.get(key);
    if (known) { known.count += 1; return true; }
    const st = await files.stat(rel);
    if (entries.has(key)) { entries.get(key).count += 1; return true; } // un'altra watch nel frattempo
    entries.set(key, { files, rel, mtime: st.ok ? st.mtime : null, count: 1 });
    startOrStop();
    return true;
  }

  function unwatch(key) {
    const e = entries.get(key);
    if (!e) return;
    e.count -= 1;
    if (e.count <= 0) entries.delete(key);
    startOrStop();
  }

  function notify(key, mtime) {
    try {
      onChange({ path: key, exists: mtime !== null, mtime });
    } catch (err) {
      console.error('[editor-remote-watch] onChange:', err);
    }
  }

  /** Un giro: per ogni server una richiesta con tutti i suoi file. */
  async function poll() {
    if (polling) return; // un server lento non accumula giri
    polling = true;
    try {
      const byFiles = new Map();
      for (const [key, e] of entries) {
        if (!byFiles.has(e.files)) byFiles.set(e.files, []);
        byFiles.get(e.files).push(key);
      }
      await Promise.all([...byFiles].map(async ([files, keys]) => {
        const r = await files.statMany([...new Set(keys.map((k) => entries.get(k).rel))]);
        if (!r || !r.ok) return;
        for (const key of keys) {
          const e = entries.get(key);
          if (!e || !(e.rel in r.mtimes)) continue;
          const mtime = r.mtimes[e.rel];
          if (mtime === e.mtime) continue;
          entries.set(key, { ...e, mtime });
          notify(key, mtime);
        }
      }));
    } catch (err) {
      console.warn('[editor-remote-watch] giro fallito:', err && err.message);
    } finally {
      polling = false;
    }
  }

  function close() {
    entries.clear();
    startOrStop();
  }

  return { watch, unwatch, poll, close, get size() { return entries.size; } };
}

module.exports = { createEditorRemoteWatch, INTERVAL_MS };
