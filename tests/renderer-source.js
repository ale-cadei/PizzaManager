// Sorgente del renderer per i test che ne leggono il testo (non ha una
// controparte eseguibile fuori da Electron). Il renderer è diviso in più
// script classici (docs/plans/21-split-renderer.md): i test li leggono come
// un solo testo, nell'ordine in cui index.html li carica.
const fs = require('fs');
const path = require('path');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

/** Ordine di caricamento: app-state.js per primo, renderer.js per ultimo. */
const RENDERER_APP_FILES = [
  'app-state.js',
  'signals.js',
  'tabs.js',
  'git-tab.js',
  'tab-names.js',
  'session-list.js',
  'new-session.js',
  'claude-accounts-ui.js',
  'resume.js',
  'restore.js',
  'menu-actions.js',
  'panels.js',
  'extensions-panel.js',
  'renderer.js',
];

/** @returns {string} i file del renderer concatenati nell'ordine di caricamento */
function readRendererApp() {
  return RENDERER_APP_FILES
    .map((f) => fs.readFileSync(path.join(RENDERER_DIR, f), 'utf8'))
    .join('\n');
}

module.exports = { RENDERER_APP_FILES, readRendererApp };
