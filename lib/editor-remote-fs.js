'use strict';
/* I file della sessione editor su un server SSH (docs/plans/94). Stesse
 * risposte di lib/editor-fs.js, ma ogni operazione è una richiesta
 * all'helper sul server (lib/remote-helper.py, via lib/remote-channel.js):
 * è lì che i percorsi si risolvono e si confinano nella radice. Qui si
 * decide solo come mostrare i byte (decode di editor-fs: binari, BOM, non
 * UTF-8) e si traducono gli errori negli stessi messaggi.
 *
 * In più: `run`, git sul server con il contratto di lib/git-run.js, così
 * editor-git, editor-index ed editor-definition girano invariati;
 * `walkFiles` per Ctrl+P fuori da git; `statMany` per il polling dei file
 * aperti, che sul server sostituisce fs.watch. */
const { decode, MESSAGES } = require('./editor-fs');
const { safeRel, validName } = require('./editor-paths');

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byKindThenName = (a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1);

const coded = (code, message) => Object.assign(new Error(MESSAGES[code] || message || code), { code });
/** Una risposta `ok: false` dell'helper, o un canale caduto, come la darebbe editor-fs. */
const failure = (r) => ({ ok: false, error: MESSAGES[r && r.code] || String((r && (r.error || r.message)) || r) });

function readFailure(r) {
  if (r && r.code === 'EOUTSIDE') return { ok: false, reason: 'outside' };
  if (r && (r.code === 'ENOENT' || r.code === 'ENOTDIR')) return { ok: false, reason: 'missing' };
  return { ok: false, reason: 'error', error: failure(r).error };
}

/* Un percorso che il server rifiuterebbe comunque: si ferma qui, senza un giro di rete */
const badRel = (rel) => safeRel(rel) === null;
const OUTSIDE = { code: 'EOUTSIDE' };

/**
 * @param {{ channel: {request: (op: string, args: object, o?: object) => Promise<object>}, dir: string }} o
 *   `dir` la cartella della scheda sul server (`~` ammessa), già passata da
 *   validateRemoteDir di lib/remote-env.js
 */
function createEditorRemoteFs({ channel, dir }) {
  if (!channel || typeof channel.request !== 'function') throw new Error('canale remoto mancante');
  if (typeof dir !== 'string' || !dir) throw new Error('cartella della sessione mancante');
  let rootPromise = null;

  /** La radice risolta sul server (realpath, `~` espansa); una volta per istanza. */
  function realRoot() {
    if (!rootPromise) {
      rootPromise = channel.request('root', { dir }).then((r) => {
        if (!r.ok) throw coded(r.code === 'ENOENT' ? 'ENOENT' : r.code, r.error);
        return r.path;
      });
      rootPromise.catch(() => { rootPromise = null; }); // al prossimo giro si riprova
    }
    return rootPromise;
  }

  /* Rifiuta solo se il canale cade o la radice non c'è: le risposte
     `ok: false` dell'helper tornano com'è, le decide chi chiama */
  async function call(op, args, o) {
    const root = await realRoot();
    return channel.request(op, { root, ...args }, o);
  }
  // canale caduto o radice sparita → la stessa forma di una risposta negativa
  const settle = (p) => p.catch((e) => ({ ok: false, code: e.code, error: e.message }));

  async function list(rel = '') {
    if (badRel(rel)) return failure(OUTSIDE);
    const r = await settle(call('list', { rel }));
    if (!r.ok) return failure(r);
    return { ok: true, entries: r.entries.map(({ name, kind, ignored }) => ({ name, kind, ignored })).sort(byKindThenName) };
  }

  async function read(rel) {
    if (badRel(rel)) return readFailure(OUTSIDE);
    const r = await settle(call('read', { rel }));
    if (!r.ok) return r.reason ? { ok: false, reason: r.reason } : readFailure(r);
    const decoded = decode(Buffer.from(r.data, 'base64'));
    return decoded.ok ? { ...decoded, mtime: r.mtime, path: r.path } : decoded;
  }

  async function write(rel, text, { expectedMtime = null, bom = false } = {}) {
    if (typeof text !== 'string') return { ok: false, error: 'Testo mancante.' };
    if (badRel(rel)) return failure(OUTSIDE);
    const body = Buffer.from(text, 'utf8');
    const data = (bom ? Buffer.concat([BOM, body]) : body).toString('base64');
    const r = await settle(call('write', { rel, data, expectedMtime }));
    if (r.conflict) return { ok: false, conflict: true, mtime: r.mtime };
    return r.ok ? { ok: true, mtime: r.mtime } : failure(r);
  }

  async function stat(rel) {
    if (badRel(rel)) return failure(OUTSIDE);
    const r = await settle(call('stat', { rel }));
    return r.ok ? { ok: true, exists: r.exists, mtime: r.mtime } : failure(r);
  }

  /** mtime di più file in un giro: `null` se non c'è (o è fuori). */
  async function statMany(rels) {
    const r = await settle(call('stat_many', { rels: rels.filter((x) => !badRel(x)) }));
    return r.ok ? { ok: true, mtimes: r.mtimes } : failure(r);
  }

  const simple = (op) => async (rel) => {
    if (badRel(rel)) return failure(OUTSIDE);
    const r = await settle(call(op, { rel }));
    return r.ok ? { ok: true } : failure(r);
  };

  async function rename(rel, name) {
    if (!validName(name, 'linux')) return failure({ code: 'EINVALNAME' });
    if (badRel(rel)) return failure(OUTSIDE);
    const r = await settle(call('rename', { rel, name }));
    return r.ok ? { ok: true, rel: r.rel } : failure(r);
  }

  /** Assoluto sul server, confinato: per editor-git. Lancia come resolveInside di editor-fs. */
  async function resolveInside(rel) {
    if (badRel(rel)) throw coded('EOUTSIDE');
    const r = await call('resolve', { rel });
    if (!r.ok) throw coded(r.code, r.error);
    return r.path;
  }

  /**
   * git sul server col contratto di runGit: stdout (stringa o Buffer), e su
   * errore un'eccezione con `code` (uscita), `stderr`, `stdout`, `missing`, `killed`.
   * `env` non viaggia: sul server valgono le variabili fisse dell'helper.
   */
  async function run(args, { cwd, timeout = 0, buffer = false, input = null } = {}) {
    const extra = timeout ? { timeoutMs: timeout + 5000 } : undefined; // il server interrompe prima
    const r = await call('git', { cwd, args, timeout, buffer, input }, extra);
    if (!r.ok) throw coded(r.code, r.error);
    if (r.missing) throw Object.assign(new Error('git non trovato sul server'), { missing: true });
    if (r.killed) throw Object.assign(new Error('git interrotto: tempo scaduto'), { killed: true, stderr: '', stdout: '' });
    if (r.status !== 0) {
      const stderr = String(r.stderr || '');
      throw Object.assign(new Error(stderr.trim() || `git uscito con ${r.status}`), { code: r.status, stderr, stdout: buffer ? '' : String(r.stdout || '') });
    }
    return buffer ? Buffer.from(r.stdout, 'base64') : String(r.stdout);
  }

  /** Fuori da git, l'elenco per Ctrl+P letto sul server (la radice la sa già l'helper). */
  async function walkFiles(_root, max) {
    const r = await settle(call('walk', { max }));
    return r.ok ? { files: r.files, truncated: r.truncated } : { files: [], truncated: false };
  }

  return {
    realRoot, list, read, write, stat, statMany, rename, resolveInside, run, walkFiles,
    create: simple('create'), mkdir: simple('mkdir'), trash: simple('trash'),
  };
}

module.exports = { createEditorRemoteFs };
