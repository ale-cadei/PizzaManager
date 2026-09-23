const assert = require('node:assert');
const { test: ok } = require('node:test');

/* L'etichetta sotto il logo: sistema e shell con i nomi che l'utente conosce,
   non quelli di Node («darwin», «/bin/zsh»). */
const { platformLabel } = require('../lib/shell');

ok('etichetta: nome del sistema leggibile e nome corto della shell', () => {
  assert.strictEqual(platformLabel('darwin', '/bin/zsh'), 'macOS · zsh');
  assert.strictEqual(platformLabel('linux', '/usr/bin/bash'), 'Linux · bash');
  assert.strictEqual(platformLabel('win32', 'powershell.exe'), 'Windows · PowerShell');
  assert.strictEqual(platformLabel('win32', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'Windows · PowerShell');
});

ok('etichetta: sistema sconosciuto o shell mancante non lanciano', () => {
  assert.strictEqual(platformLabel('freebsd', '/usr/local/bin/fish'), 'freebsd · fish');
  assert.strictEqual(platformLabel('darwin', ''), 'macOS');
});
