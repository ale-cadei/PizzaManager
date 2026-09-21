'use strict';
const { execFile } = require('child_process');

/**
 * Sessioni dentro tmux: il processo appartiene al server tmux, non all'app,
 * e sopravvive alla chiusura della finestra. L'app e' un client che si
 * riattacca. Vedi docs/plans/05-risultati.md per le prove.
 *
 * Il server e' su un socket dedicato: `tmux -f <config>` da solo NON isola
 * — se un server tmux e' gia' attivo la sessione si aggancia a quello e ne
 * eredita la configurazione. Col socket l'app ha un server tutto suo, e
 * `tmux ls` mostra solo le sue sessioni. Corollario: ogni comando tmux passa
 * da `-L SOCKET`, altrimenti un kill-server colpirebbe le sessioni personali
 * dell'utente.
 */
const SOCKET = 'aisession';
const NAME_PREFIX = 'ais-';

/**
 * I metadati della sessione vivono nelle user option di tmux (@ais_*), che si
 * salvano sulla sessione stessa: tmux e' l'unica fonte di verita' per le
 * sessioni vive, niente registro parallelo da tenere allineato.
 */
const META_KEYS = ['type', 'cwd', 'label', 'profile_id', 'profile_label', 'resume_id', 'account_id', 'account_name'];
// Separatore dei campi in list-sessions. Deve essere STAMPABILE: tmux fino
// alla 3.3 (Ubuntu 24.04) sostituisce con `_` i caratteri di controllo
// nell'output dei comandi, e con il vecchio unit separator (0x1f) ogni riga
// diventava un campo solo. La sequenza non compare in percorsi ne' in titoli
// normali; se un titolo la contenesse, solo quella sessione si leggerebbe male.
const FIELD_SEP = '<|>';
const LIST_FORMAT = ['#{session_name}', '#{session_created}', '#{session_attached}', ...META_KEYS.map((k) => `#{@ais_${k}}`)].join(FIELD_SEP);

/** Nome univoco e riconoscibile: il tipo aiuta a leggere `tmux ls` a occhio. */
function sessionName(type, now = Date.now(), rand = Math.random()) {
  const slug = String(type || 'x').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'x';
  return `${NAME_PREFIX}${slug}-${now.toString(36)}${Math.floor(rand * 1e6).toString(36)}`;
}

function isAisSession(name) {
  return typeof name === 'string' && name.startsWith(NAME_PREFIX);
}

function baseArgs({ confPath, socket = SOCKET }) {
  return ['-L', socket, ...(confPath ? ['-f', confPath] : [])];
}

/**
 * Argomenti per avviare `cmd args` in una sessione tmux nuova e attaccarcisi.
 * `-A` riattacca se il nome esiste gia': e' la primitiva su cui poggia il
 * riattacco all'avvio dell'app.
 *
 * `env` va passato con `-e`, esplicitamente: il server tmux cattura l'ambiente
 * alla SUA nascita e le sessioni successive ereditano quello, non l'ambiente
 * del client che le crea. Senza -e, un secondo profilo Claude con un'altra
 * CLAUDE_CONFIG_DIR prenderebbe in silenzio la config dir del primo
 * (verificato su tmux 3.7).
 *
 * Eccezione: il PATH. Al comando iniziale tmux da' il PATH del CLIENT che
 * esegue new-session, e `-e PATH` finisce solo nell'ambiente di sessione
 * (verificato su tmux 3.7). Per questo `createTmuxControl.create` lancia il
 * client con il PATH di `env`, oltre a passarlo con -e.
 */
function spawnArgs({ confPath, socket, name, cmd, args = [], cwd, env = {}, detached = false }) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const mode = detached ? ['-d'] : ['-A'];
  return [...baseArgs({ confPath, socket }), 'new-session', ...mode, '-s', name, ...(cwd ? ['-c', cwd] : []), ...envArgs, '--', cmd, ...args];
}

/** Argomenti per riattaccarsi a una sessione esistente. `=` forza il match esatto del nome. */
function attachArgs({ confPath, socket, name }) {
  return [...baseArgs({ confPath, socket }), 'attach-session', '-t', `=${name}`];
}

/**
 * Argomenti per salvare i metadati sulla sessione, un set-option per chiave.
 * Qui il nome va nudo: set-option, a differenza di has/kill/attach-session,
 * non accetta il prefisso `=` (verificato su tmux 3.7). tmux prova comunque
 * il match esatto prima di quello per prefisso.
 */
function metaArgs({ confPath, socket, name, meta }) {
  return META_KEYS
    .filter((k) => meta[k] !== undefined && meta[k] !== null)
    .map((k) => [...baseArgs({ confPath, socket }), 'set-option', '-t', name, `@ais_${k}`, String(meta[k])]);
}

function listArgs({ confPath, socket }) {
  return [...baseArgs({ confPath, socket }), 'list-sessions', '-F', LIST_FORMAT];
}

/** Riapplica la config a un server gia' vivo (tmux legge -f solo alla nascita). */
function sourceArgs({ confPath, socket }) {
  return [...baseArgs({ confPath, socket }), 'source-file', confPath];
}

/**
 * Percorso leggibile da un processo esterno. Nell'app impacchettata i file
 * stanno in app.asar, un archivio che solo Electron sa aprire: tmux non ci
 * riesce e partirebbe con la config di default. electron-builder tiene una
 * copia dei file elencati in `asarUnpack` accanto all'archivio, in
 * app.asar.unpacked: e' quella da dare a tmux. Da sorgente non cambia nulla.
 */
function externalPath(p) {
  return String(p || '').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

function killArgs({ confPath, socket, name }) {
  return [...baseArgs({ confPath, socket }), 'kill-session', '-t', `=${name}`];
}

function hasArgs({ confPath, socket, name }) {
  return [...baseArgs({ confPath, socket }), 'has-session', '-t', `=${name}`];
}

/** Interpreta l'output di list-sessions con LIST_FORMAT. Righe malformate vengono saltate. */
function parseSessionList(stdout) {
  const out = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(FIELD_SEP);
    if (parts.length < 3) continue;
    const [name, created, attached, ...rest] = parts;
    if (!isAisSession(name)) continue;
    const meta = Object.fromEntries(META_KEYS.map((k, i) => [k, rest[i] || null]));
    out.push({
      name,
      createdAt: Number(created) * 1000 || null,
      attached: Number(attached) > 0,
      type: meta.type,
      cwd: meta.cwd,
      label: meta.label,
      profileId: meta.profile_id,
      profileLabel: meta.profile_label,
      resumeId: meta.resume_id,
      accountId: meta.account_id,
      accountName: meta.account_name,
    });
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Esecuzione dei comandi tmux di controllo (non i pty: quelli li apre app/pty.js).
 * `run` e' iniettabile per verificare la logica senza un tmux vero.
 */
function createTmuxControl({ bin, confPath, socket = SOCKET, run = execFile } = {}) {
  if (!bin) throw new Error('createTmuxControl richiede il percorso di tmux');
  const exec = (args, { env } = {}) => new Promise((resolve) => {
    run(bin, args, { timeout: 5000, ...(env ? { env } : {}) }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });

  return {
    /**
     * Crea la sessione staccata e vi salva i metadati, PRIMA che un client si
     * attacchi: fatto dopo lo spawn del client sarebbe una corsa contro la
     * nascita della sessione (e la si perdeva).
     */
    async create({ name, cmd, args, cwd, env, meta }) {
      // Il PATH del comando iniziale e' quello del client (vedi spawnArgs):
      // il client eredita l'ambiente del processo, ma col PATH della sessione.
      const clientEnv = env && env.PATH ? { ...process.env, PATH: env.PATH } : undefined;
      const r = await exec(spawnArgs({ confPath, socket, name, cmd, args, cwd, env, detached: true }), { env: clientEnv });
      if (!r.ok) return { ok: false, error: r.stderr.trim() || 'tmux new-session fallito' };
      // Se il server esisteva gia' (avviato a mano, senza -f) ha la config di
      // default: barra di stato, Ctrl+B. source-file la rimette a posto.
      if (confPath) await exec(sourceArgs({ confPath, socket }));
      for (const a of metaArgs({ confPath, socket, name, meta: meta || {} })) await exec(a);
      return { ok: true };
    },
    /** Sessioni vive dell'app, piu' recenti prima. Server assente = nessuna sessione, non un errore. */
    async list() {
      const r = await exec(listArgs({ confPath, socket }));
      return r.ok ? parseSessionList(r.stdout) : [];
    },
    async has(name) {
      return (await exec(hasArgs({ confPath, socket, name }))).ok;
    },
    async setMeta(name, meta) {
      for (const args of metaArgs({ confPath, socket, name, meta })) await exec(args);
    },
    async kill(name) {
      return (await exec(killArgs({ confPath, socket, name }))).ok;
    },
  };
}

/**
 * tmux disponibile su questa macchina? Restituisce cio' che serve a app/pty.js
 * (binario, config, controllo) oppure null: senza tmux l'app ricade sul
 * comportamento classico, con il processo figlio della finestra.
 */
function detectTmux({ confPath: rawConfPath, socket = SOCKET, resolve = require('./binaries').resolveBinary, platform = process.platform } = {}) {
  // Su Windows tmux non esiste: un tmux.exe di MSYS2/Cygwin nel PATH userebbe
  // socket e config POSIX che qui non hanno senso. Non si cerca nemmeno.
  if (platform === 'win32') return null;
  const r = resolve('tmux');
  if (!r.path) return null;
  const confPath = rawConfPath ? externalPath(rawConfPath) : rawConfPath;
  return { bin: r.path, confPath, socket, control: createTmuxControl({ bin: r.path, confPath, socket }) };
}

module.exports = {
  SOCKET, NAME_PREFIX, META_KEYS, LIST_FORMAT, FIELD_SEP, detectTmux,
  sessionName, isAisSession, spawnArgs, attachArgs, metaArgs, listArgs, killArgs, hasArgs, sourceArgs, externalPath,
  parseSessionList, createTmuxControl,
};
