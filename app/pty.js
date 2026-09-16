'use strict';
const os = require('os');
const { buildCommand, installHint } = require('../lib/commands');
const { augmentedEnv } = require('../lib/binaries');
const { resolveWorkdir } = require('../lib/workdir');
const tmuxLib = require('../lib/tmux');

let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty non disponibile:', e.message);
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

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
function createPtyManager({ accounts, history, profiles, sendToRenderer, tmux = null, liveStore = null }) {
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

  function track(id, p, session) {
    clients.set(id, { p, session });
    p.onData((data) => sendToRenderer('pty-data', { id, data }));
    p.onExit(({ exitCode, signal }) => {
      clients.delete(id);
      sendToRenderer('pty-exit', { id, exitCode, signal, session });
    });
  }

  function openPty(cmd, args, { cols, rows, cwd, env }) {
    return pty.spawn(cmd, args, {
      name: 'xterm-color',
      cols: cols || DEFAULT_COLS,
      rows: rows || DEFAULT_ROWS,
      cwd,
      env,
    });
  }

  async function spawn({ id, type, cwd, resumeId, claudeAccountId, commandProfileId, label, cols, rows }) {
    if (!pty) return { ok: false, error: 'node-pty non installato. Esegui: npm install' };

    const workdir = resolveWorkdir(cwd);
    const { cmd, args, profileEnv, missing, searchedPath, error, profile } = buildCommand(type, resumeId, commandProfileId, { profiles });
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
    const env = { ...augmentedEnv([cmd], identity.vars), ...(profileEnv || {}) };
    const session = viaTmux ? tmuxLib.sessionName(type) : null;

    try {
      let p;
      if (viaTmux) {
        // Al processo dentro tmux arrivano esplicitamente le variabili che
        // contano; il resto lo eredita dal server (vedi lib/tmux.js, spawnArgs).
        const sessionEnv = { PATH: env.PATH, COLORTERM: env.COLORTERM, ...identity.vars, ...(profileEnv || {}) };
        const created = await tmux.control.create({
          name: session, cmd, args, cwd: workdir, env: sessionEnv,
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
        p = openPty(cmd, args, { cols, rows, cwd: workdir, env });
      }
      track(id, p, session);
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
  async function attach({ id, session, cols, rows }) {
    if (!viaTmux) return { ok: false, error: 'tmux non disponibile: niente a cui riattaccarsi.' };
    if (!tmuxLib.isAisSession(session)) return { ok: false, error: `Sessione non riconosciuta: ${session}` };
    if (!(await tmux.control.has(session))) return { ok: false, gone: true, error: `La sessione ${session} non esiste più.` };
    // Un client gia' attaccato a questa sessione appartiene a un renderer che
    // non c'e' piu' (hard refresh): si chiude, e la scheda nuova prende il suo posto.
    for (const [oldId, c] of clients) if (c.session === session) close(oldId);
    try {
      const p = openPty(tmux.bin, tmuxLib.attachArgs({ confPath: tmux.confPath, socket: tmux.socket, name: session }), {
        cols, rows, cwd: os.homedir(), env: augmentedEnv([tmux.bin]),
      });
      track(id, p, session);
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

  function write(id, data) {
    const c = clients.get(id);
    if (c) c.p.write(data);
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
    if (c && c.session) await tmux.control.kill(c.session);
    const r = close(id);
    if (c && c.session) { await settle(); await syncSnapshot(); }
    return r;
  }

  /** Termina una sessione tmux a cui non si e' attaccati (ripulitura dalla lista). */
  async function terminateSession(session) {
    if (!viaTmux || !tmuxLib.isAisSession(session)) return { ok: false };
    for (const [id, c] of clients) if (c.session === session) close(id);
    const ok = await tmux.control.kill(session);
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

  /** Alla chiusura dell'ultima finestra: stacca tutti i client. Con tmux le sessioni sopravvivono. */
  function closeAll() {
    for (const [, c] of clients) {
      try { c.p.kill(); } catch {}
    }
    clients.clear();
  }

  return {
    spawn, attach, listLive, setLabel, setMeta, restorable, discardRestorable, write, resize, close, terminate, terminateSession, closeAll,
    get viaTmux() { return viaTmux; },
    get size() { return clients.size; },
    // compatibilita' con il nome precedente
    kill: close, killAll: closeAll,
  };
}

module.exports = { createPtyManager, isPtyAvailable: () => !!pty };
