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
function createPtyManager({ accounts, history, sendToRenderer }) {
  const ptys = new Map();

  /** Variabili d'ambiente e nome dell'account per una sessione Claude. */
  function claudeIdentity(type, claudeAccountId) {
    if (type !== 'claude') return { vars: {}, name: null };
    if (claudeAccountId && claudeAccountId !== 'oauth') return accounts().envFor(claudeAccountId);
    return { vars: {}, name: accounts().detectOauth().available ? 'OAuth' : null };
  }

  function spawn({ id, type, cwd, resumeId, claudeAccountId, cols, rows }) {
    if (!pty) return { ok: false, error: 'node-pty non installato. Esegui: npm install' };

    const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const { cmd, args, missing, searchedPath } = buildCommand(type, resumeId);
    if (!cmd) {
      return {
        ok: false,
        error: `Binario '${missing}' non trovato nel PATH.\nPATH cercato: ${searchedPath}\n` + installHint(missing),
      };
    }

    const identity = claudeIdentity(type, claudeAccountId);
    if (identity.error) return { ok: false, error: identity.error };

    try {
      const p = pty.spawn(cmd, args, {
        name: 'xterm-color',
        cols: cols || DEFAULT_COLS,
        rows: rows || DEFAULT_ROWS,
        cwd: workdir,
        env: augmentedEnv([cmd], identity.vars),
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
        cmd: cmd + ' ' + args.join(' '),
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
