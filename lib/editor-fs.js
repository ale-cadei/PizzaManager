'use strict';
/* File della sessione editor (docs/plans/60). Ogni percorso arriva relativo
 * dal renderer e passa da qui: si risolve sotto la cartella della sessione,
 * symlink compresi, e si rifiuta se esce. Le letture rifiutano quello che
 * l'editor non sa mostrare (binari, > 5 MB, non UTF-8); le scritture sono
 * atomiche e non sovrascrivono un file cambiato da quando lo si è letto. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');
const { validName, isInside, safeRel } = require('./editor-paths');

const MAX_READ = 5 * 1024 * 1024;
const SNIFF = 8 * 1024;
const MAX_IGNORE_CHECK = 5000;
const IGNORE_TIMEOUT = 5000;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const HIDDEN = new Set(['.git']);

const MESSAGES = {
  EOUTSIDE: 'Il percorso esce dalla cartella della sessione.',
  EINVALNAME: 'Nome non valido.',
  EEXIST: 'Esiste già un file o una cartella con quel nome.',
  ENOENT: 'Non esiste più.',
  ENOTDIR: 'Non esiste più.',
  EACCES: 'Permesso negato.',
  EPERM: 'Permesso negato.',
  ENOSPC: 'Disco pieno.',
  EISDIR: 'È una cartella.',
  ENOTFILE: 'Non è un file.',
};

const coded = (code) => Object.assign(new Error(MESSAGES[code] || code), { code });
const failure = (e) => ({ ok: false, error: MESSAGES[e && e.code] || String((e && e.message) || e) });

function readFailure(e) {
  if (e && e.code === 'EOUTSIDE') return { ok: false, reason: 'outside' };
  if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { ok: false, reason: 'missing' };
  return { ok: false, reason: 'error', error: failure(e).error };
}

async function statOrNull(abs) {
  try { return await fs.promises.stat(abs); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byKindThenName = (a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1);

/** Testo UTF-8 o il motivo per cui non lo è. */
function decode(buf) {
  if (buf.subarray(0, SNIFF).includes(0)) return { ok: false, reason: 'binary' };
  const bom = buf.subarray(0, 3).equals(BOM);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? buf.subarray(3) : buf);
    return { ok: true, text, bom };
  } catch {
    return { ok: false, reason: 'not-utf8' };
  }
}

async function kindOf(dir, dirent) {
  if (dirent.isDirectory()) return 'dir';
  if (!dirent.isSymbolicLink()) return 'file';
  try { return (await fs.promises.stat(path.join(dir, dirent.name))).isDirectory() ? 'dir' : 'file'; } catch { return 'file'; }
}

/* Quali nomi della cartella git ignora. Exit 1 = nessuno, 128 = fuori da un
 * repository, git assente: in tutti i casi nessuno è attenuato, che è la
 * cosa giusta da mostrare. Oltre MAX_IGNORE_CHECK voci non si chiede. */
async function ignoredNames(dir, names) {
  if (!names.length || names.length > MAX_IGNORE_CHECK) return new Set();
  try {
    const out = await runGit(['check-ignore', '-z', '--stdin'], { cwd: dir, input: names.join('\0'), timeout: IGNORE_TIMEOUT });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * @param {{root: string, platform?: string}} o la cartella della sessione
 */
function createEditorFs({ root, platform = process.platform } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('cartella della sessione mancante');
  let st;
  try { st = fs.statSync(root); } catch { throw new Error('la cartella non esiste: ' + root); }
  if (!st.isDirectory()) throw new Error('non è una cartella: ' + root);
  const realRoot = fs.realpathSync(root);

  const relOf = (rel) => {
    const clean = safeRel(rel);
    if (clean === null) throw coded('EOUTSIDE');
    return clean;
  };
  const check = (abs) => {
    if (!isInside(realRoot, abs, platform)) throw coded('EOUTSIDE');
    return abs;
  };

  /* realpath del percorso o, se non esiste ancora, dell'antenato più vicino che esiste */
  function realOrAncestor(abs) {
    const rest = [];
    let cur = abs;
    for (;;) {
      try {
        return path.join(fs.realpathSync(cur), ...rest);
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
        const parent = path.dirname(cur);
        if (parent === cur) throw e;
        rest.unshift(path.basename(cur));
        cur = parent;
      }
    }
  }

  /** Assoluto, symlink seguiti: dove si legge e si scrive il contenuto. */
  const resolveInside = (rel) => check(realOrAncestor(path.join(realRoot, relOf(rel))));

  /* La voce stessa, non il bersaglio di un symlink: padre risolto + nome.
     Serve a creare, rinominare, eliminare. La radice non si tocca. */
  function resolveEntry(rel) {
    const clean = relOf(rel);
    if (!clean) throw coded('EOUTSIDE');
    return check(path.join(resolveInside(path.posix.dirname(clean)), path.posix.basename(clean)));
  }

  function newEntry(rel) {
    const clean = relOf(rel);
    if (!validName(path.posix.basename(clean), platform)) throw coded('EINVALNAME');
    return resolveEntry(clean);
  }

  async function list(rel = '') {
    try {
      const dir = resolveInside(rel);
      const dirents = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((d) => !HIDDEN.has(d.name));
      const entries = await Promise.all(dirents.map(async (d) => ({ name: d.name, kind: await kindOf(dir, d) })));
      const ignored = await ignoredNames(dir, entries.map((e) => e.name));
      return { ok: true, entries: entries.map((e) => ({ ...e, ignored: ignored.has(e.name) })).sort(byKindThenName) };
    } catch (e) {
      return failure(e);
    }
  }

  async function read(rel) {
    try {
      const abs = resolveInside(rel);
      const info = await fs.promises.stat(abs);
      if (!info.isFile()) return { ok: false, reason: 'not-file' };
      if (info.size > MAX_READ) return { ok: false, reason: 'too-large' };
      const decoded = decode(await fs.promises.readFile(abs));
      return decoded.ok ? { ...decoded, mtime: info.mtimeMs, path: abs } : decoded;
    } catch (e) {
      return readFailure(e);
    }
  }

  /* Scrittura atomica: temporaneo nella stessa cartella e rename. Il mode
     dell'originale si rimette dopo (writeFile lo applica solo alla creazione,
     e passa dall'umask): un .env a 0600 resta a 0600. Un file in sola
     lettura si rifiuta («Permesso negato.»), come farebbe una scrittura sul posto. */
  async function write(rel, text, { expectedMtime = null, bom = false } = {}) {
    if (typeof text !== 'string') return { ok: false, error: 'Testo mancante.' };
    let tmp = null;
    try {
      const abs = resolveInside(rel);
      const before = await statOrNull(abs);
      if (before && !before.isFile()) throw coded('ENOTFILE');
      const diskMtime = before ? before.mtimeMs : null;
      if (diskMtime !== expectedMtime) return { ok: false, conflict: true, mtime: diskMtime };
      // Il rename guarda i permessi della cartella, non del file: un file in
      // sola lettura verrebbe sovrascritto. Si chiede prima (EACCES → messaggio)
      if (before) await fs.promises.access(abs, fs.constants.W_OK);
      tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.aisess-${process.pid}-${Date.now()}.tmp`);
      const body = Buffer.from(text, 'utf8');
      await fs.promises.writeFile(tmp, bom ? Buffer.concat([BOM, body]) : body, { flag: 'wx' });
      if (before) await fs.promises.chmod(tmp, before.mode & 0o777);
      await fs.promises.rename(tmp, abs);
      tmp = null;
      return { ok: true, mtime: (await fs.promises.stat(abs)).mtimeMs };
    } catch (e) {
      if (tmp) await fs.promises.rm(tmp, { force: true }).catch((err) => console.warn('[editor] temporaneo rimasto:', tmp, err.message));
      return failure(e);
    }
  }

  async function stat(rel) {
    try {
      const info = await statOrNull(resolveInside(rel));
      return { ok: true, exists: Boolean(info), mtime: info ? info.mtimeMs : null };
    } catch (e) {
      return failure(e);
    }
  }

  async function create(rel) {
    try {
      await fs.promises.writeFile(newEntry(rel), '', { flag: 'wx' });
      return { ok: true };
    } catch (e) {
      return failure(e);
    }
  }

  async function mkdir(rel) {
    try {
      await fs.promises.mkdir(newEntry(rel));
      return { ok: true };
    } catch (e) {
      return failure(e);
    }
  }

  async function rename(rel, newName) {
    try {
      if (!validName(newName, platform)) throw coded('EINVALNAME');
      const clean = relOf(rel);
      const from = resolveEntry(clean);
      const to = path.join(path.dirname(from), newName);
      const source = await fs.promises.lstat(from);
      const existing = await fs.promises.lstat(to).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
      // Stesso inode = cambia solo una maiuscola su un disco che non le distingue
      if (existing && !(existing.ino === source.ino && existing.dev === source.dev)) throw coded('EEXIST');
      await fs.promises.rename(from, to);
      const parent = path.posix.dirname(clean);
      return { ok: true, rel: parent === '.' ? newName : `${parent}/${newName}` };
    } catch (e) {
      return failure(e);
    }
  }

  /** Il percorso da mandare al cestino (app/editor.js): solo dopo i controlli. */
  function trashTarget(rel) {
    try {
      const abs = resolveEntry(rel);
      fs.lstatSync(abs);
      return { ok: true, path: abs };
    } catch (e) {
      return failure(e);
    }
  }

  return { realRoot, resolveInside, list, read, write, stat, create, mkdir, rename, trashTarget };
}

module.exports = { createEditorFs, MAX_READ };
