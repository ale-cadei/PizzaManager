'use strict';
/* File copiati nel file manager del sistema → percorsi assoluti
 * (docs/plans/61). Puro: riceve chi legge gli appunti (`read(format)` →
 * Buffer; in app/editor.js è clipboard.readBuffer) e la piattaforma.
 * Formati: GNOME `x-special/gnome-copied-files` («copy»/«cut» e un URI per
 * riga), `text/uri-list` (KDE e altri), `FileNameW` su Windows (UTF-16LE,
 * un solo file: è quello che Electron sa leggere). */
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const GNOME = 'x-special/gnome-copied-files';
const URI_LIST = 'text/uri-list';
const WINDOWS = 'FileNameW';

const formatsFor = (platform) => (platform === 'win32' ? [WINDOWS] : [GNOME, URI_LIST]);

/** Un URI `file://` locale → percorso assoluto; null per tutto il resto. */
function fileUriToPath(uri, platform = process.platform) {
  const windows = platform === 'win32';
  try {
    const url = new URL(String(uri).trim());
    if (url.protocol !== 'file:') return null;
    if (url.hostname && url.hostname !== 'localhost') return null; // solo file locali
    const p = fileURLToPath(url, { windows });
    return (windows ? path.win32 : path.posix).isAbsolute(p) ? p : null;
  } catch {
    return null; // non è un URI, o un %2F nel percorso: non è un file nostro
  }
}

const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function gnomeLines(text) {
  const all = lines(text);
  return all[0] === 'copy' || all[0] === 'cut' ? all.slice(1) : all;
}

// Solo GNOME scrive se è un «taglia»; null = gli appunti non lo dicono
function cutFrom(format, buf) {
  if (format !== GNOME) return null;
  const first = lines(buf.toString('utf8').replace(/\0/g, ''))[0];
  return first === 'cut' ? true : first === 'copy' ? false : null;
}

function pathsFrom(format, buf, platform) {
  if (!buf || !buf.length) return [];
  if (format === WINDOWS) {
    return buf.toString('utf16le').split('\0').map((s) => s.trim()).filter((p) => p && path.win32.isAbsolute(p));
  }
  const text = buf.toString('utf8').replace(/\0/g, '');
  const uris = format === GNOME ? gnomeLines(text) : lines(text).filter((l) => !l.startsWith('#'));
  return uris.map((u) => fileUriToPath(u, platform)).filter(Boolean);
}

/**
 * @param {(format: string) => Buffer} read
 * @param {string} [platform]
 * @returns {string[]} percorsi assoluti, senza doppioni; il primo formato con dei file vince
 */
function filesFromClipboard(read, platform = process.platform) {
  return clipboardSelection(read, platform).paths;
}

/**
 * Come filesFromClipboard, con il «taglia» del formato GNOME (docs/plans/95).
 * @returns {{paths: string[], cut: boolean|null}}
 */
function clipboardSelection(read, platform = process.platform) {
  for (const format of formatsFor(platform)) {
    let buf;
    try {
      buf = read(format);
    } catch (e) {
      console.warn('[clipboard-files]', format, e && e.message); // formato non supportato: si prova il prossimo
      continue;
    }
    const paths = pathsFrom(format, buf, platform);
    if (paths.length) return { paths: [...new Set(paths)], cut: cutFrom(format, buf) };
  }
  return { paths: [], cut: null };
}

/**
 * Gli appunti come li scrive il file manager, per Ctrl+C / Ctrl+X
 * nell'albero dell'editor (docs/plans/95). Electron scrive un formato per
 * volta: GNOME (lo leggono Nautilus e clipboardSelection), FileNameW su
 * Windows (un solo file, come in lettura).
 * @param {string[]} paths assoluti
 * @param {'copy'|'cut'} mode
 * @returns {{format: string, buffer: Buffer}} lancia se l'input non va
 */
function clipboardPayload(paths, mode, platform = process.platform) {
  const windows = platform === 'win32';
  const absolute = (p) => typeof p === 'string' && (windows ? path.win32 : path.posix).isAbsolute(p);
  if (!Array.isArray(paths) || !paths.length || !paths.every(absolute)) throw new Error('Serve un percorso assoluto.');
  if (mode !== 'copy' && mode !== 'cut') throw new Error('Modo: copy o cut.');
  if (windows) {
    if (paths.length > 1) throw new Error('Su Windows un solo file per volta.');
    return { format: WINDOWS, buffer: Buffer.from(`${paths[0]}\0`, 'utf16le') };
  }
  const uris = paths.map((p) => pathToFileURL(p).href);
  return { format: GNOME, buffer: Buffer.from([mode, ...uris].join('\n'), 'utf8') };
}

module.exports = { filesFromClipboard, clipboardSelection, clipboardPayload, fileUriToPath, formatsFor };
