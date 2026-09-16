'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Directory davvero usata dal pty.
 *
 * La scheda deve conoscerla: il titolo automatico riconosce la conversazione
 * confrontando le directory, quindi un `~/progetto` non espanso o una directory
 * inesistente gli farebbero cercare a vuoto. Tutto cio' che non e' una
 * directory esistente finisce nella home, che e' dove il pty parte davvero.
 */
function resolveWorkdir(cwd, { home = os.homedir(), isDir = defaultIsDir } = {}) {
  const raw = String(cwd || '').trim();
  if (!raw) return home;
  const expanded = raw === '~' || raw.startsWith('~/') ? path.join(home, raw.slice(1)) : raw;
  const abs = path.resolve(expanded);
  return isDir(abs) ? abs : home;
}

function defaultIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

module.exports = { resolveWorkdir };
