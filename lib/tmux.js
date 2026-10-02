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
/* turn_tree / turn_at: la fotografia dei file all'ultimo prompt inviato
   (pannello delle modifiche, «ultimo giro», docs/plans/32) */
const META_KEYS = ['type', 'cwd', 'label', 'profile_id', 'profile_label', 'resume_id', 'account_id', 'account_name', 'icon_key', 'icon_mode', 'turn_tree', 'turn_at'];
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
function spawnArgs({ confPath, socket, name, cmd, args = [], cwd, env = {}, detached = false, cols, rows }) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const mode = detached ? ['-d'] : ['-A'];
  return [...baseArgs({ confPath, socket }), 'new-session', ...mode, '-s', name, ...sizeArgs(cols, rows), ...(cwd ? ['-c', cwd] : []), ...envArgs, '--', cmd, ...args];
}

/**
 * La sessione nasce staccata e il client si attacca dopo: senza -x/-y il pane
 * e' 80x24 finche' non arriva il client. Per una shell qualsiasi non cambia
 * nulla, ma il testo ripristinato (piano 26) verrebbe mandato a capo a 80
 * colonne DENTRO la history, dove nessun resize lo raddrizza piu'.
 */
const MAX_PANE = 10000;
function sizeArgs(cols, rows) {
  const ok = (n) => Number.isInteger(n) && n > 0 && n <= MAX_PANE;
  return ok(cols) && ok(rows) ? ['-x', String(cols), '-y', String(rows)] : [];
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

/**
 * Argomenti per leggere il testo del pane: `-p` sullo stdout, `-e` con i
 * colori, `-S -N` per partire N righe indietro nella history. Su una history
 * piu' corta tmux restituisce quello che c'e', non N righe di vuoto.
 *
 * Il bersaglio e' un pane, quindi `=nome:` coi due punti: con `=nome` nudo
 * tmux risponde "can't find pane" (verificato su 3.7c), come per la copy-mode.
 */
function captureArgs({ confPath, socket, name, lines = SCROLLBACK_LINES }) {
  const n = Number.isFinite(lines) && lines > 0 ? Math.min(Math.trunc(lines), MAX_SCROLL_STEP) : SCROLLBACK_LINES;
  return [...baseArgs({ confPath, socket }), 'capture-pane', '-p', '-e', '-S', `-${n}`, '-t', paneTarget(name)];
}

function killArgs({ confPath, socket, name }) {
  return [...baseArgs({ confPath, socket }), 'kill-session', '-t', `=${name}`];
}

function hasArgs({ confPath, socket, name }) {
  return [...baseArgs({ confPath, socket }), 'has-session', '-t', `=${name}`];
}

/*
 * Scorrimento. tmux ridisegna il terminale esterno scorrendolo con `CSI n S`,
 * e quelle righe xterm.js non le mette nello scrollback: dietro tmux la
 * history di xterm e' vuota o a buchi (tmux salta i fotogrammi intermedi).
 * La history vera e' quella di tmux (`history-limit`), e ci si muove dentro
 * con la copy-mode. `-e`: tornati in fondo la copy-mode si chiude da sola.
 *
 * Il bersaglio e' un pane: `=nome:` (match esatto, finestra corrente). Con
 * `=nome` nudo tmux 3.2 risponde "can't find pane".
 */
const SCROLL_FORMAT = ['#{pane_in_mode}', '#{scroll_position}', '#{history_size}', '#{pane_height}', '#{alternate_on}'].join(FIELD_SEP);
// Oltre la history non si va comunque: il limite evita solo numeri assurdi.
const MAX_SCROLL_STEP = 100000;
// Righe salvate per il ripristino dopo un riavvio (docs/plans/26-scrollback-shell.md).
const SCROLLBACK_LINES = 2000;

const paneTarget = (name) => `=${name}:`;

/** Piu' comandi in una sola invocazione: meno processi a ogni scatto di rotella, stato letto a cose fatte. */
function chain(opts, cmds) {
  return [...baseArgs(opts), ...cmds.flatMap((c, i) => (i ? [';', ...c] : c))];
}

function stateCmd(name) {
  return ['display-message', '-p', '-t', paneTarget(name), SCROLL_FORMAT];
}

/** `lines` > 0 verso l'alto, < 0 verso il basso. null se non c'e' niente da fare. */
function scrollArgs({ confPath, socket, name, lines }) {
  if (typeof lines !== 'number' || !Number.isFinite(lines) || Math.trunc(lines) === 0) return null;
  const n = Math.min(MAX_SCROLL_STEP, Math.abs(Math.trunc(lines)));
  const t = paneTarget(name);
  return chain({ confPath, socket }, [
    ['copy-mode', '-e', '-t', t],
    ['send-keys', '-t', t, '-X', '-N', String(n), lines > 0 ? 'scroll-up' : 'scroll-down'],
    stateCmd(name),
  ]);
}

/** Salto a `fromBottom` righe dal fondo (0 = fondo: esce dalla copy-mode). goto-line si ferma da solo in cima. */
function scrollToArgs({ confPath, socket, name, fromBottom }) {
  if (!Number.isInteger(fromBottom) || fromBottom < 0) return null;
  const t = paneTarget(name);
  const move = fromBottom === 0 ? ['send-keys', '-t', t, '-X', 'cancel'] : ['send-keys', '-t', t, '-X', 'goto-line', String(Math.min(fromBottom, MAX_SCROLL_STEP))];
  return chain({ confPath, socket }, [['copy-mode', '-e', '-t', t], move, stateCmd(name)]);
}

function scrollStateArgs({ confPath, socket, name }) {
  return chain({ confPath, socket }, [stateCmd(name)]);
}

/** Chiude la copy-mode. Fuori dalla copy-mode tmux risponde "not in a mode": innocuo. */
function cancelScrollArgs({ confPath, socket, name }) {
  return chain({ confPath, socket }, [['send-keys', '-t', paneTarget(name), '-X', 'cancel']]);
}

/** Output di SCROLL_FORMAT. null se la sessione non c'e' (tmux stampa campi vuoti). */
function parseScrollState(stdout) {
  const parts = String(stdout || '').trim().split(FIELD_SEP);
  if (parts.length < 5) return null;
  const [mode, position, history, rows, alternate] = parts;
  if (history === '' || rows === '') return null;
  return {
    inMode: mode === '1',
    position: Number(position) || 0,
    history: Number(history) || 0,
    rows: Number(rows) || 0,
    alternate: alternate === '1',
  };
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
      iconKey: meta.icon_key,
      iconMode: meta.icon_mode,
      turnTree: meta.turn_tree,
      turnAt: Number(meta.turn_at) || null,
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
    async create({ name, cmd, args, cwd, env, meta, cols, rows }) {
      // Il PATH del comando iniziale e' quello del client (vedi spawnArgs):
      // il client eredita l'ambiente del processo, ma col PATH della sessione.
      const clientEnv = env && env.PATH ? { ...process.env, PATH: env.PATH } : undefined;
      const r = await exec(spawnArgs({ confPath, socket, name, cmd, args, cwd, env, detached: true, cols, rows }), { env: clientEnv });
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
    /** Il testo del pane, colori compresi. null se tmux non risponde: si tiene il file di prima. */
    async capture(name, lines) {
      const r = await exec(captureArgs({ confPath, socket, name, lines }));
      return r.ok ? r.stdout : null;
    },
    scroll(name, lines) {
      return readState(scrollArgs({ confPath, socket, name, lines }));
    },
    scrollTo(name, fromBottom) {
      return readState(scrollToArgs({ confPath, socket, name, fromBottom }));
    },
    scrollState(name) {
      return readState(scrollStateArgs({ confPath, socket, name }));
    },
    async cancelScroll(name) {
      await exec(cancelScrollArgs({ confPath, socket, name }));
    },
  };

  /** Esegue e legge lo stato dello scorrimento; null se non c'era niente da fare o tmux ha fallito. */
  async function readState(args) {
    if (!args) return null;
    const r = await exec(args);
    return r.ok ? parseScrollState(r.stdout) : null;
  }
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
  parseSessionList, createTmuxControl, captureArgs, SCROLLBACK_LINES,
  SCROLL_FORMAT, MAX_SCROLL_STEP, scrollArgs, scrollToArgs, scrollStateArgs, cancelScrollArgs, parseScrollState,
};
