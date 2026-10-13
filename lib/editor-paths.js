'use strict';
/* Percorsi e nomi della sessione editor (docs/plans/60). Funzioni pure con
 * `platform` come parametro: i casi Windows si provano da Unix
 * (tests/windows.test.js). Le usano lib/editor-fs.js e lib/editor-sessions.js. */
const path = require('path');

const MAX_NAME = 255;
const MAX_REL = 1024;
const CONTROL = /[\x00-\x1f\x7f]/;
const WIN_FORBIDDEN = /[<>:"|?*]/;
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Un nome di file o cartella (non un percorso) che si può creare.
 * @param {unknown} name
 * @param {string} [platform]
 * @returns {boolean}
 */
function validName(name, platform = process.platform) {
  if (typeof name !== 'string' || !name || name.length > MAX_NAME) return false;
  if (name === '.' || name === '..' || /[\\/]/.test(name) || CONTROL.test(name)) return false;
  if (platform !== 'win32') return true;
  return !WIN_FORBIDDEN.test(name) && !WIN_RESERVED.test(name) && !/[. ]$/.test(name);
}

/**
 * `target` è `root` o sta sotto. Su Windows senza badare alle maiuscole.
 * @param {string} root
 * @param {string} target
 * @param {string} [platform]
 * @returns {boolean}
 */
function isInside(root, target, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const fold = (s) => (platform === 'win32' ? String(s).toLowerCase() : String(s));
  const rel = p.relative(p.resolve(fold(root)), p.resolve(fold(target)));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel));
}

/**
 * Un percorso relativo che arriva dal renderer o da un file: niente `..`,
 * niente assoluti, niente caratteri di controllo. `..` si rifiuta anche se
 * resterebbe dentro (`a/../b`): nessun chiamante onesto lo manda.
 * @param {unknown} rel
 * @returns {string|null} con `/`; `''` è la radice
 */
function safeRel(rel) {
  if (typeof rel !== 'string' || rel.length > MAX_REL || CONTROL.test(rel)) return null;
  if (path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const parts = rel.split(/[\\/]/).filter((s) => s && s !== '.');
  if (parts.includes('..')) return null;
  return parts.join('/');
}

module.exports = { validName, isInside, safeRel, MAX_NAME, MAX_REL };
