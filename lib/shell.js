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

const PLATFORM_NAMES = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
const SHELL_NAMES = { powershell: 'PowerShell', pwsh: 'PowerShell' };

/**
 * Etichetta sotto il logo: "macOS · zsh" invece di "darwin · /bin/zsh".
 * Il percorso completo resta nel tooltip, lo compone il renderer.
 * @param {string} platform come process.platform
 * @param {string} shell percorso o nome dell'eseguibile
 * @returns {string}
 */
function platformLabel(platform, shell) {
  const system = PLATFORM_NAMES[platform] || platform;
  const base = String(shell || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');
  const name = SHELL_NAMES[base.toLowerCase()] || base;
  return name ? `${system} · ${name}` : system;
}

module.exports = { getDefaultShell, platformLabel };
