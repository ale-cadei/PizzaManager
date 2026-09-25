'use strict';
const os = require('os');
const { buildCommand, installHint } = require('../lib/commands');
const { augmentedEnv } = require('../lib/binaries');
const { resolveWorkdir } = require('../lib/workdir');
const tmuxLib = require('../lib/tmux');
const { shouldCapture } = require('../lib/scrollback');
const { replayCommand } = require('../lib/scrollback-command');

let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty non disponibile:', e.message);
}

const TERM_NAME = 'xterm-256color';
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/* Ogni mezzo minuto, e solo sulle sessioni che hanno scritto qualcosa: dieci
   shell ferme non fanno nulla. Al massimo si perde mezzo minuto di output in
   uno spegnimento brusco (docs/plans/26-scrollback-shell.md). */
const CAPTURE_EVERY_MS = 30000;

/**
 * Ciclo di vita dei processi in pty.
 *
 * Con `tmux` disponibile ogni sessione vive dentro il server tmux dell'app
 * (socket dedicato) e il pty che l'app apre e' solo un *client* attaccato:
 * chiudere la scheda o la finestra stacca il client, il processo continua.
 * All'avvio successivo `listLive()` ritrova le sessioni e `attach()` le
 * riaggancia. Senza tmux si ricade sul comportamento classico: il processo
 * e' figlio dell'app e muore con lei.
 *
 * Sta in app/ perche' dipende da node-pty e dal canale verso il renderer.
 */
/* `systemLocale` (es. `it-IT`, da app.getLocale(), anche come funzione) serve
   a scegliere LANG per i processi quando l'app, avviata dal Finder, non ce
   l'ha (lib/locale.js). */
function createPtyManager({ accounts, history, profiles, sendToRenderer, tmux = null, liveStore = null, systemLocale = null, scrollbackStore = null }) {
  const localeOpts = () => {
    const v = typeof systemLocale === 'function' ? systemLocale() : systemLocale;
    return v ? { systemLocale: v } : {};
  };
  /** id scheda -> { p: pty, session: nome tmux | null } */
  const clients = new Map();
  const viaTmux = Boolean(tmux && tmux.bin && tmux.control && pty);

  /**
   * Variabili d'ambiente e nome dell'account per una sessione Claude.
   * Il profilo di comando puo' spostare la config dir (CLAUDE_CONFIG_DIR): e'
   * li' che sta il login di quel profilo, non per forza in ~/.claude.
   */
  function claudeIdentity(type, claudeAccountId, profile, profileEnv) {
    const profileConfigDir = (profileEnv && profileEnv.CLAUDE_CONFIG_DIR) || null;
    if (type !== 'claude') return { vars: {}, name: null };
    if (claudeAccountId && claudeAccountId !== 'oauth') {
      const ae = accounts().envFor(claudeAccountId);
      if (ae.error) return ae;
      // ANTHROPIC_API_KEY scavalca il login OAuth: con una config dir dedicata
      // l'isolamento fra profili sarebbe solo apparente, e si pagherebbe a consumo.
      if (profileConfigDir) {
        return {
          error: `Il comando "${profile.label}" usa già un profilo Claude separato (CLAUDE_CONFIG_DIR=${profileConfigDir}), `
            + `ma hai scelto l'account a chiave API "${ae.name}".\nANTHROPIC_API_KEY ha la precedenza sul login del profilo: `
            + "l'isolamento non varrebbe e il consumo verrebbe addebitato sulla chiave.\n"
            + "Scegli l'account \"OAuth (login corrente)\" per usare il login del profilo, oppure un comando senza CLAUDE_CONFIG_DIR.",
        };
      }
      // Stesso conflitto, con la chiave scritta direttamente nel profilo: l'env del
      // profilo viene applicato per ultimo e scavalcherebbe l'account scelto in silenzio.
      if (profileEnv && profileEnv.ANTHROPIC_API_KEY) {
        return {
          error: `Il comando "${profile.label}" imposta già ANTHROPIC_API_KEY, ma hai scelto anche l'account a chiave API "${ae.name}".\n`
            + "Vincerebbe la chiave del comando e il consumo verrebbe addebitato lì, non sull'account scelto.\n"
            + "Scegli \"OAuth (login corrente)\" oppure togli ANTHROPIC_API_KEY dal comando.",
        };
      }
      return ae;
    }
    const o = accounts().detectOauth(profileConfigDir);
    return { vars: {}, name: o.available ? (profileConfigDir ? `OAuth (${profileConfigDir})` : 'OAuth') : null };
  }

  /**
   * Riscrive il registro su disco con le sessioni vive di tmux. Fire-and-forget:
   * un riavvio non avvisa, quindi il file deve essere sempre aggiornato.
   */
  function syncSnapshot() {
    if (!viaTmux || !liveStore) return Promise.resolve();
    return tmux.control.list().then((live) => { liveStore().write(live); }).catch(() => {});
  }

  /** Le variabili di locale presenti nell'env, da passare a tmux con `-e`. */
  function localeVars(env) {
    const out = {};
    for (const k of ['LANG', 'LC_ALL', 'LC_CTYPE']) if (env[k]) out[k] = env[k];
    return out;
  }

  function track(id, p, session, type) {
    const c = { p, session, type, dirty: false };
    clients.set(id, c);
    p.onData((data) => {
      // Il segnale per la cattura periodica: senza output non c'e' niente di
      // nuovo da salvare.
      c.dirty = true;
      sendToRenderer('pty-data', { id, data });
    });
    p.onExit(({ exitCode, signal }) => {
      clients.delete(id);
      sendToRenderer('pty-exit', { id, exitCode, signal, session });
    });
  }

  /* `name` diventa il TERM del processo (node-pty lo sovrascrive anche se
     env.TERM e' impostato). Deve essere un terminfo con 256 colori e `dim`:
     tmux traduce gli attributi secondo il terminfo del client, e con
     `xterm-color` (senza `dim`) i suggerimenti grigi di Claude Code
     arrivavano a xterm.js come testo normale. Stesso valore di
     TERMINAL_ENV in lib/binaries.js. */
  function openPty(cmd, args, { cols, rows, cwd, env }) {
    return pty.spawn(cmd, args, {
      name: TERM_NAME,
      cols: cols || DEFAULT_COLS,
      rows: rows || DEFAULT_ROWS,
      cwd,
      env,
    });
  }

  async function spawn({ id, type, cwd, resumeId, claudeAccountId, commandProfileId, label, cols, rows, previousSession = null }) {
    if (!pty) return { ok: false, error: 'node-pty non installato. Esegui: npm install' };

    const workdir = resolveWorkdir(cwd);
    const { cmd, args, commandLine, profileEnv, missing, searchedPath, error, profile } = buildCommand(type, resumeId, commandProfileId, { profiles });
    if (!cmd) {
      if (error) return { ok: false, error };
      return {
        ok: false,
        error: `Binario '${missing}' non trovato nel PATH.\nPATH cercato: ${searchedPath}\n` + installHint(missing),
      };
    }

    const identity = claudeIdentity(type, claudeAccountId, profile, profileEnv);
    if (identity.error) return { ok: false, error: identity.error };

    // Le variabili del profilo vengono per ultime: sono la scelta esplicita
    // dell'utente (es. CLAUDE_CONFIG_DIR) e devono vincere sui default.
    const env = { ...augmentedEnv([cmd], identity.vars, process.env, localeOpts()), ...(profileEnv || {}) };
    const session = viaTmux ? tmuxLib.sessionName(type) : null;

    try {
      let p;
      if (viaTmux) {
        // Al processo dentro tmux arrivano esplicitamente le variabili che
        // contano; il resto lo eredita dal server (vedi lib/tmux.js, spawnArgs).
        const sessionEnv = { PATH: env.PATH, COLORTERM: env.COLORTERM, ...localeVars(env), ...identity.vars, ...(profileEnv || {}) };
        // Ripristino dopo un riavvio: la sessione stampa il testo di prima e
        // poi DIVENTA la shell (exec). Il testo finisce cosi' nella history di
        // tmux, che e' quella con cui scorre la rotella.
        const replay = restoreFor({ type, previousSession, cmd, args });
        const created = await tmux.control.create({
          name: session,
          cmd: replay ? replay.cmd : cmd,
          args: replay ? replay.args : args,
          cwd: workdir,
          env: replay ? { ...sessionEnv, ...replay.env } : sessionEnv,
          cols,
          rows,
          meta: {
            type,
            cwd: workdir,
            label: label || null,
            profile_id: (profile && profile.id) || null,
            profile_label: (profile && profile.label) || null,
            resume_id: resumeId || null,
            account_id: claudeAccountId || null,
            account_name: identity.name,
          },
        });
        if (!created.ok) return { ok: false, error: 'tmux: ' + created.error };
        // Il pty e' sempre e solo un client: uguale per sessioni nuove e riattaccate.
        p = openPty(tmux.bin, tmuxLib.attachArgs({ confPath: tmux.confPath, socket: tmux.socket, name: session }), { cols, rows, cwd: workdir, env });
      } else {
        // Su Windows un .cmd passa da cmd.exe con la riga gia' composta
        // (lib/win-command.js): node-pty la usa cosi' com'e' invece di
        // ricomporla dall'argv con regole che cmd.exe non capirebbe.
        p = openPty(cmd, commandLine || args, { cols, rows, cwd: workdir, env });
      }
      track(id, p, session, type);
      // Consumato: il file di prima ha fatto il suo mestiere e puo' contenere
      // segreti. Da qui in avanti si salva sotto il nome della sessione nuova.
      if (previousSession && scrollbackStore) scrollbackStore().remove(previousSession);
      if (session) syncSnapshot();
      history().append({
        type,
        cwd: workdir,
        resumeId: resumeId || null,
        claudeAccountId: claudeAccountId || null,
        claudeAccountName: identity.name,
        commandProfileId: (profile && profile.id) || null,
        commandProfileLabel: (profile && profile.label) || null,
        tmuxSession: session,
        cmd: [...Object.entries(profileEnv || {}).map(([k, v]) => `${k}=${v}`), cmd, ...args].join(' '),
      });
      // La directory risolta torna alla scheda: e' quella su cui il titolo
      // automatico cerca la conversazione, non quella digitata dall'utente.
      return { ok: true, cwd: workdir, session };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  /**
   * Riaggancia una sessione tmux esistente (riapertura dell'app).
   * Una sessione sparita nel frattempo e' un caso normale, non un errore:
   * il chiamante la degrada a "ricreabile via resume".
   */
  async function attach({ id, session, type, cols, rows }) {
    if (!viaTmux) return { ok: false, error: 'tmux non disponibile: niente a cui riattaccarsi.' };
    if (!tmuxLib.isAisSession(session)) return { ok: false, error: `Sessione non riconosciuta: ${session}` };
    if (!(await tmux.control.has(session))) return { ok: false, gone: true, error: `La sessione ${session} non esiste più.` };
    // Un client gia' attaccato a questa sessione appartiene a un renderer che
    // non c'e' piu' (hard refresh): si chiude, e la scheda nuova prende il suo posto.
    for (const [oldId, c] of clients) if (c.session === session) close(oldId);
    try {
      const p = openPty(tmux.bin, tmuxLib.attachArgs({ confPath: tmux.confPath, socket: tmux.socket, name: session }), {
        cols, rows, cwd: os.homedir(), env: augmentedEnv([tmux.bin], {}, process.env, localeOpts()),
      });
      track(id, p, session, type);
      syncSnapshot();
      return { ok: true, session };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  /**
   * Aggiorna i metadati salvati sulla sessione tmux. L'etichetta cosi' torna al
   * riattacco; l'id della conversazione (resume_id) arriva qui quando il
   * titolo automatico lo scopre — e' cio' che rende ripristinabile dopo un
   * riavvio una sessione nata "nuova".
   */
  function setMeta(id, { label, resumeId } = {}) {
    const c = clients.get(id);
    if (!c || !c.session) return { ok: false };
    const meta = {};
    if (label !== undefined) meta.label = String(label || '');
    if (resumeId !== undefined) meta.resume_id = String(resumeId || '');
    tmux.control.setMeta(c.session, meta).then(syncSnapshot).catch(() => {});
    return { ok: true };
  }

  function setLabel(id, label) {
    return setMeta(id, { label });
  }

  /** Sessioni vive nel server tmux dell'app, con i loro metadati. Vuoto senza tmux. */
  async function listLive() {
    if (!viaTmux) return [];
    const attachedNow = new Set([...clients.values()].map((c) => c.session).filter(Boolean));
    return (await tmux.control.list()).map((s) => ({ ...s, attachedHere: attachedNow.has(s.name) }));
  }

  /*
   * Con la copy-mode aperta dallo scorrimento i tasti andrebbero ai comandi
   * della copy-mode (q, spazio, frecce) e non al programma. Si chiude prima,
   * come un terminale che torna in fondo quando scrivi; i tasti che arrivano
   * nel frattempo aspettano in coda, per non scavalcarsi.
   */
  function write(id, data) {
    const c = clients.get(id);
    if (!c) return;
    if (c.inMode) {
      c.inMode = false;
      c.typedSinceScroll = true;
      // Uno scroll ancora in volo aprirebbe la copy-mode DOPO la chiusura: si aspetta lui.
      c.pending = Promise.resolve(c.scrolling).then(() => tmux.control.cancelScroll(c.session)).catch(() => {});
    }
    if (!c.pending) { c.p.write(data); return; }
    const next = c.pending.then(() => { try { c.p.write(data); } catch {} });
    c.pending = next;
    next.then(() => { if (c.pending === next) c.pending = null; });
  }

  /**
   * Scorrimento nella history di tmux (vedi lib/tmux.js): `lines` righe
   * (> 0 verso l'alto), oppure salto a `fromBottom` righe dal fondo, oppure
   * nessuno dei due per leggere soltanto lo stato. null senza tmux: allora la
   * history e' quella di xterm e il renderer scorre da se'.
   */
  async function scroll(id, { lines, fromBottom } = {}) {
    const c = clients.get(id);
    if (!viaTmux || !c || !c.session) return null;
    const ctl = tmux.control;
    const moving = fromBottom !== undefined || lines !== undefined;
    const move = fromBottom !== undefined ? ctl.scrollTo(c.session, fromBottom)
      : lines !== undefined ? ctl.scroll(c.session, lines)
        : ctl.scrollState(c.session);
    if (moving) {
      // Il comando e' un processo a parte: puo' arrivare a tmux prima che si
      // sappia com'e' andata. Da subito i tasti vanno trattati come in
      // copy-mode (write la chiude, dopo aver aspettato questo).
      c.inMode = true;
      c.typedSinceScroll = false;
      c.scrolling = move.catch(() => null);
    }
    const state = await move.catch(() => null);
    // Se nel frattempo si e' scritto, la copy-mode l'ha gia' chiusa write.
    if (state && !c.typedSinceScroll) c.inMode = state.inMode;
    return state;
  }

  /**
   * Il comando iniziale per una sessione che riparte con il testo di prima,
   * oppure null se non c'e' niente da ripristinare. Solo le shell: gli agenti
   * ricaricano la conversazione con --resume e sono TUI in alternate screen,
   * dove una cattura sarebbe un fotogramma, non una cronologia.
   */
  function restoreFor({ type, previousSession, cmd, args }) {
    if (!previousSession || !scrollbackStore || !shouldCapture({ type, alternate: false })) return null;
    const store = scrollbackStore();
    const text = store.read(previousSession);
    if (!text) return null;
    return replayCommand({ file: store.fileFor(previousSession), shell: cmd, args });
  }

  /**
   * Salva il testo di una sessione, se ha senso salvarlo. Si legge prima lo
   * stato del pane: con un pager o un vim aperto (alternate screen) si
   * terrebbe il file di prima, che e' piu' utile di un fotogramma.
   */
  async function captureOne(c) {
    if (!c.session || !scrollbackStore || !shouldCapture({ type: c.type, alternate: false })) return false;
    const state = await tmux.control.scrollState(c.session).catch(() => null);
    if (!state || !shouldCapture({ type: c.type, alternate: state.alternate })) return false;
    const text = await tmux.control.capture(c.session).catch(() => null);
    if (text == null) return false;
    scrollbackStore().save(c.session, text);
    c.dirty = false;
    return true;
  }

  /** Le sole sessioni che hanno scritto qualcosa dall'ultimo salvataggio. */
  function captureDirty() {
    if (!viaTmux || !scrollbackStore) return Promise.resolve();
    return Promise.all([...clients.values()].filter((c) => c.dirty).map((c) => captureOne(c).catch(() => false)));
  }

  /**
   * I file di sessioni che non esistono piu': l'app uccisa prima di poterli
   * cancellare li lascia indietro, e contengono cio' che si e' visto a
   * schermo. Senza questa passata la cartella cresce per sempre.
   *
   * Valide sono le sessioni vive E quelle del registro: dopo un riavvio tmux
   * non ne ha nessuna, e i file da ripristinare sono proprio di quelle che
   * vivono ormai solo nel registro. Questa passata gira prima del modal.
   */
  async function sweepScrollback() {
    if (!viaTmux || !scrollbackStore) return;
    try {
      const live = await tmux.control.list();
      const registered = liveStore ? liveStore().read() : [];
      scrollbackStore().sweep([...live, ...registered].map((s) => s.name));
    } catch { /* niente lista, niente pulizia: si riprova al prossimo avvio */ }
  }

  let captureTimer = null;
  /** Avvia il salvataggio periodico, dopo aver ripulito gli orfani dell'avvio precedente. */
  function startCapture(everyMs = CAPTURE_EVERY_MS) {
    if (captureTimer || !viaTmux || !scrollbackStore) return;
    sweepScrollback();
    captureTimer = setInterval(() => { captureDirty(); }, everyMs);
    // Il timer non deve tenere vivo il processo da solo.
    if (typeof captureTimer.unref === 'function') captureTimer.unref();
  }

  function stopCapture() {
    if (captureTimer) clearInterval(captureTimer);
    captureTimer = null;
  }

  function resize(id, cols, rows) {
    const c = clients.get(id);
    if (!c || !(cols > 0) || !(rows > 0)) return;
    try { c.p.resize(cols, rows); } catch {}
  }

  /**
   * Chiude il pty della scheda. Con tmux e' uno *stacco*: il client se ne va,
   * la sessione e il suo processo restano. Senza tmux il processo muore.
   */
  function close(id) {
    const c = clients.get(id);
    if (c) {
      try { c.p.kill(); } catch {}
      clients.delete(id);
    }
    return { ok: true, detached: Boolean(c && c.session) };
  }

  /** Dopo una kill-session tmux ha bisogno di un attimo per riflettere la lista. */
  const settle = () => new Promise((r) => setTimeout(r, 150));

  /** Termina davvero: uccide la sessione tmux (e con lei il processo), poi il client. */
  async function terminate(id) {
    const c = clients.get(id);
    if (c && c.session) { await tmux.control.kill(c.session); forget(c.session); }
    const r = close(id);
    if (c && c.session) { await settle(); await syncSnapshot(); }
    return r;
  }

  /** Termina una sessione tmux a cui non si e' attaccati (ripulitura dalla lista). */
  async function terminateSession(session) {
    if (!viaTmux || !tmuxLib.isAisSession(session)) return { ok: false };
    for (const [id, c] of clients) if (c.session === session) close(id);
    const ok = await tmux.control.kill(session);
    forget(session);
    await settle(); await syncSnapshot();
    return { ok };
  }

  /**
   * Sessioni da proporre in ripristino all'avvio: quelle nel registro che tmux
   * non ha piu'. Riallinea il registro nel farlo. Vedi lib/live-sessions.js.
   */
  async function restorable() {
    if (!viaTmux || !liveStore) return [];
    const { restorableSessions } = require('../lib/live-sessions');
    const live = await tmux.control.list();
    const { restorable: lost, reconciled } = restorableSessions(liveStore().read(), live);
    if (reconciled.length !== liveStore().read().length) liveStore().write(reconciled);
    return lost;
  }

  /** L'utente ha detto "non ora": il registro si svuota, altrimenti lo richiederebbe a ogni avvio. */
  function discardRestorable() {
    if (liveStore) liveStore().clear();
    return { ok: true };
  }

  /**
   * Il testo salvato di una sessione che non esiste piu'. Si cancella subito:
   * e' quello che si e' visto a schermo, e li' passano token e chiavi.
   */
  function forget(session) {
    if (session && scrollbackStore) scrollbackStore().remove(session);
  }

  /** Alla chiusura dell'ultima finestra: stacca tutti i client. Con tmux le sessioni sopravvivono. */
  function closeAll() {
    for (const [, c] of clients) {
      try { c.p.kill(); } catch {}
    }
    clients.clear();
  }

  return {
    spawn, attach, listLive, setLabel, setMeta, restorable, discardRestorable, write, scroll, resize, close, terminate, terminateSession, closeAll,
    startCapture, stopCapture, captureDirty, sweepScrollback,
    get viaTmux() { return viaTmux; },
    get size() { return clients.size; },
    // compatibilita' con il nome precedente
    kill: close, killAll: closeAll,
  };
}

module.exports = { createPtyManager, isPtyAvailable: () => !!pty };
