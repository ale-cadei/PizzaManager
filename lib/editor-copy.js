'use strict';
/* Copiare file e cartelle da fuori dentro la cartella della sessione editor
 * (docs/plans/61). Due fasi: planCopy controlla e trova i conflitti,
 * runCopy (Task 3) copia con le decisioni dell'utente. Fra le due il disco
 * può cambiare: runCopy rifà i controlli. I link non si seguono mai. Mai
 * sovrascrivere: chi sostituisce passa da `trash` (shell.trashItem). */
const fs = require('fs');
const path = require('path');
const { isInside } = require('./editor-paths');

const MAX_FILES = 10000;
const MAX_BYTES = 1024 ** 3;
const MAX_SOURCES = 1000;
const MAX_NUMBERED = 1000;

const MESSAGES = {
  EOUTSIDE: 'Il percorso esce dalla cartella della sessione.',
  ENOENT: 'Non esiste più.',
  ENOTDIR: 'Non esiste più.',
  EACCES: 'Permesso negato.',
  EPERM: 'Permesso negato.',
  ENOSPC: 'Disco pieno.',
  EEXIST: 'Esiste già.',
};

/** Un errore il cui messaggio è già per l'utente. */
function userError(message) {
  const e = new Error(message);
  e.code = 'EUSER';
  return e;
}

const messageOf = (e) => (e && e.code === 'EUSER' ? e.message : MESSAGES[e && e.code] || String((e && e.message) || e));

// Su Windows e macOS i nomi che differiscono solo per le maiuscole sono lo stesso file
const foldName = (name, platform) => (platform === 'win32' || platform === 'darwin' ? name.toLowerCase() : name);

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${+(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${+(n / 1024 ** 2).toFixed(1)} MB`;
  return `${n} byte`;
}

/** «a.txt» → «a (2).txt»; «.env» e le cartelle prendono il numero in fondo. */
function numberedName(name, n, isDir) {
  const dot = isDir ? -1 : name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** Linux e Windows non mescolano file e cartelle nella stessa finestra di scelta. */
const pickProperties = (platform) => (platform === 'darwin'
  ? ['openFile', 'openDirectory', 'multiSelections']
  : ['openFile', 'multiSelections']);

function kindOf(info) {
  if (info.isSymbolicLink()) return 'link';
  if (info.isDirectory()) return 'dir';
  if (info.isFile()) return 'file';
  return 'other';
}

async function lstatOrNull(abs) {
  try {
    return await fs.promises.lstat(abs);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

/**
 * @param {{editorFs: {resolveInside: (rel: string) => string},
 *   trash: (absPath: string) => Promise<void>, platform?: string,
 *   maxFiles?: number, maxBytes?: number}} opts
 */
function createEditorCopy({ editorFs, trash, platform = process.platform, maxFiles = MAX_FILES, maxBytes = MAX_BYTES }) {
  async function destination(rel) {
    if (typeof rel !== 'string') throw userError('La destinazione non è una cartella.');
    const abs = editorFs.resolveInside(rel); // lancia EOUTSIDE
    const info = await fs.promises.stat(abs).catch(() => null);
    if (!info || !info.isDirectory()) throw userError('La destinazione non è una cartella.');
    return abs;
  }

  /** I sorgenti validati; con `missingOk` uno sparito resta con `kind: null`. */
  async function sourceEntries(sources, { missingOk = false } = {}) {
    if (!Array.isArray(sources) || !sources.length) throw userError('Niente da copiare.');
    if (sources.length > MAX_SOURCES) throw userError(`Troppi elementi: più di ${MAX_SOURCES}.`);
    const entries = [];
    const names = new Set();
    for (const raw of sources) {
      if (typeof raw !== 'string' || !path.isAbsolute(raw)) throw userError('Percorso non valido.');
      const abs = path.resolve(raw);
      if (entries.some((e) => e.abs === abs)) continue;
      const name = path.basename(abs);
      if (!name) throw userError('Non si copia la radice di un disco.');
      const key = foldName(name, platform);
      if (names.has(key)) throw userError(`Due elementi si chiamano «${name}»: copiali uno alla volta.`);
      names.add(key);
      const info = await lstatOrNull(abs);
      if (!info && !missingOk) throw userError(`«${name}» non esiste più.`);
      entries.push({ abs, name, kind: info ? kindOf(info) : null });
    }
    return entries;
  }

  /** Conta senza seguire i link; si ferma appena passa un limite. */
  async function measure(entries) {
    let count = 0;
    let bytes = 0;
    const stack = entries.map((e) => e.abs);
    while (stack.length) {
      const abs = stack.pop();
      const info = await fs.promises.lstat(abs);
      const kind = kindOf(info);
      if (kind === 'other') throw userError(`«${path.basename(abs)}» non è un file né una cartella.`);
      count += 1;
      if (kind === 'file') bytes += info.size;
      if (count > maxFiles) throw userError(`Troppi file e cartelle: più di ${maxFiles}.`);
      if (bytes > maxBytes) throw userError(`Troppo grande: più di ${formatBytes(maxBytes)}.`);
      if (kind === 'dir') for (const name of await fs.promises.readdir(abs)) stack.push(path.join(abs, name));
    }
    return { count, bytes };
  }

  /** Tutti i controlli: li fa il piano e li rifà la copia. */
  async function checked(sources, destRel, { missingOk = false } = {}) {
    const dest = await destination(destRel);
    const entries = await sourceEntries(sources, { missingOk });
    const present = entries.filter((e) => e.kind);
    for (const e of present) {
      if (e.kind === 'dir' && isInside(await fs.promises.realpath(e.abs), dest, platform)) {
        throw userError(`«${e.name}» non si copia dentro se stessa.`);
      }
    }
    return { dest, entries, ...(await measure(present)) };
  }

  async function planCopy(sources, destRel) {
    try {
      const { dest, entries, count, bytes } = await checked(sources, destRel);
      const conflicts = [];
      for (const e of entries) {
        const existing = await lstatOrNull(path.join(dest, e.name));
        if (existing) conflicts.push({ name: e.name, kind: e.kind, existingKind: kindOf(existing) });
      }
      return { ok: true, items: entries.map(({ name, kind }) => ({ name, kind })), conflicts, count, bytes };
    } catch (e) {
      return { ok: false, error: messageOf(e) };
    }
  }

  return { planCopy };
}

module.exports = { createEditorCopy, numberedName, pickProperties, MAX_FILES, MAX_BYTES };
