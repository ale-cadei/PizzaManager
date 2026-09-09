'use strict';
const fs = require('fs');

/**
 * Shell interattiva di default per la piattaforma corrente.
 * Piattaforma ed env sono parametri per poter essere verificati nei test
 * senza dipendere dalla macchina su cui girano.
 */
function getDefaultShell(platform = process.platform, env = process.env) {
  if (platform === 'win32') return 'powershell.exe';
  if (platform === 'darwin') {
    // macOS: preferisci zsh, ripiega su bash
    return fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
  }
  // Linux: $SHELL o bash
  return env.SHELL || '/bin/bash';
}

module.exports = { getDefaultShell };
