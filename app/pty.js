'use strict';
const fs = require('fs');
const os = require('os');
const { buildCommand, installHint } = require('../lib/commands');
const { augmentedEnv } = require('../lib/binaries');

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
 * Sta in app/ e non in lib/ perche' dipende da node-pty e dal canale verso il
 * renderer. E' anche il modulo che il branch 6 riscrivera' per far vivere le
 * sessioni dentro tmux: averlo isolato e' il motivo per cui vale la pena
 * tenerlo separato dal wiring IPC.
 */
function createPtyManager({ accounts, history, profiles, sendToRenderer }) {
  const ptys = new Map();

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

  function spawn({ id, type, cwd, resumeId, claudeAccountId, commandProfileId, cols, rows }) {
    if (!pty) return { ok: false, error: 'node-pty non installato. Esegui: npm install' };

    const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
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

    try {
      const p = pty.spawn(cmd, args, {
        name: 'xterm-color',
        cols: cols || DEFAULT_COLS,
        rows: rows || DEFAULT_ROWS,
        cwd: workdir,
        // Le variabili del profilo vengono per ultime: sono la scelta esplicita
        // dell'utente (es. CLAUDE_CONFIG_DIR) e devono vincere sui default.
        env: { ...augmentedEnv([cmd], identity.vars), ...(profileEnv || {}) },
      });
      ptys.set(id, p);
      p.onData((data) => sendToRenderer('pty-data', { id, data }));
      p.onExit(({ exitCode, signal }) => {
        ptys.delete(id);
        sendToRenderer('pty-exit', { id, exitCode, signal });
      });
      history().append({
        type,
        cwd: workdir,
        resumeId: resumeId || null,
        claudeAccountId: claudeAccountId || null,
        claudeAccountName: identity.name,
        commandProfileId: (profile && profile.id) || null,
        commandProfileLabel: (profile && profile.label) || null,
        cmd: [...Object.entries(profileEnv || {}).map(([k, v]) => `${k}=${v}`), cmd, ...args].join(' '),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  function write(id, data) {
    const p = ptys.get(id);
    if (p) p.write(data);
  }

  function resize(id, cols, rows) {
    const p = ptys.get(id);
    if (!p || !(cols > 0) || !(rows > 0)) return;
    try { p.resize(cols, rows); } catch {}
  }

  function kill(id) {
    const p = ptys.get(id);
    if (p) {
      try { p.kill(); } catch {}
      ptys.delete(id);
    }
    return { ok: true };
  }

  /** Chiamata alla chiusura dell'ultima finestra. Il branch 6 la sostituira'. */
  function killAll() {
    for (const [, p] of ptys) {
      try { p.kill(); } catch {}
    }
    ptys.clear();
  }

  return { spawn, write, resize, kill, killAll, get size() { return ptys.size; } };
}

module.exports = { createPtyManager, isPtyAvailable: () => !!pty };
