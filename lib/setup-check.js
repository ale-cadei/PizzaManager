'use strict';
const { resolveAllBinaries } = require('./binaries');
const { getLoginPathSync } = require('./login-path');

/* Che cosa manca per usare l'app: il resoconto che la schermata vuota mostra
 * al primo avvio (docs/plans/20-onboarding.md).
 *
 * `setupReport` è puro: riceve i binari già risolti e la piattaforma, non
 * tocca il filesystem. `checkDeps` è quello che il main espone al renderer
 * (che non potrebbe importarlo): cerca i binari e ci aggiunge il resoconto.
 *
 * I comandi sono quelli di lib/commands.js#INSTALL_HINTS, qui separati dal
 * testo perché la UI li mostra da soli, pronti da copiare. */

/** Gli agenti nell'ordine in cui la schermata li elenca: prima i più usati. */
const AGENTS = [
  { type: 'claude', label: 'Claude Code', install: { command: 'npm i -g @anthropic-ai/claude-code', url: 'https://github.com/anthropics/claude-code' } },
  { type: 'codex', label: 'Codex', install: { command: 'npm i -g @openai/codex', url: 'https://github.com/openai/codex' } },
  { type: 'opencode', label: 'OpenCode', install: { command: null, url: 'https://opencode.ai' } },
  // `antigravity` è l'IDE: la CLI è `agy`, e dopo l'installer va messa nel PATH
  { type: 'antigravity', label: 'Antigravity', install: { command: null, url: 'https://antigravity.google', note: 'Poi esegui `agy install` per metterlo nel PATH.' } },
];

const TMUX_INSTALL = {
  darwin: 'brew install tmux',
  linux: 'sudo apt install tmux',
};

/**
 * @param {{binaries?: Record<string, {found?: boolean, path?: string|null}>,
 *   tmuxAvailable?: boolean, platform?: string}} [input]
 * @returns {{agents: Array<{type: string, label: string, found: boolean, path: string|null,
 *   install: {command: string|null, url: string, note?: string}}>,
 *   tmux: {found: boolean, install: {command: string|null}, note: string}|null,
 *   ready: boolean, complete: boolean}}
 *   `ready`: c'è almeno un agente, si può cominciare. `complete`: non manca niente.
 *   `tmux` è null dove l'app non lo usa (Windows).
 */
function setupReport({ binaries = {}, tmuxAvailable = false, platform = process.platform } = {}) {
  const agents = AGENTS.map(({ type, label, install }) => {
    const b = binaries[type] || {};
    return { type, label, found: Boolean(b.found), path: b.path || null, install };
  });
  // tmux legge la sua configurazione e decide il backend solo all'avvio
  // dell'app (app/pty.js): installarlo non basta, va detto.
  const tmux = platform === 'win32' ? null : {
    found: Boolean(tmuxAvailable),
    install: { command: TMUX_INSTALL[platform] || null },
    note: 'Senza tmux le sessioni muoiono con la finestra. Dopo averlo installato riavvia l\'app.',
  };
  const ready = agents.some((a) => a.found);
  const complete = agents.every((a) => a.found) && (!tmux || tmux.found);
  return { agents, tmux, ready, complete };
}

/**
 * Quello che restituisce l'handler `check-deps`: i binari per i pallini della
 * sidebar, il PATH per il loro tooltip e il resoconto per la schermata vuota.
 * I binari si cercano una volta sola per tutti e tre.
 * @param {{tmuxAvailable?: boolean, platform?: string,
 *   resolveAll?: () => object, loginPath?: () => string}} [opts]
 */
function checkDeps({ tmuxAvailable = false, platform = process.platform,
  resolveAll = resolveAllBinaries, loginPath = getLoginPathSync } = {}) {
  const binaries = resolveAll();
  return { ...binaries, path: loginPath(), setup: setupReport({ binaries, tmuxAvailable, platform }) };
}

module.exports = { setupReport, checkDeps, AGENTS };
