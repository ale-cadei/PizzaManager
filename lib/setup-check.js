'use strict';
const { resolveAllBinaries, resolveBinary } = require('./binaries');
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
  { type: 'antigravity', label: 'Antigravity', install: { command: null, url: 'https://antigravity.google', note: 'Poi esegui «agy install» per metterlo nel PATH.' } },
];

const TMUX_INSTALL = {
  darwin: 'brew install tmux',
  linux: 'sudo apt install tmux',
};

/** Come si riavvia davvero: su macOS chiudere la finestra lascia l'app aperta. */
function restartHow(platform) {
  return platform === 'darwin'
    ? 'chiudila con ⌘Q (chiudere la finestra non basta) e riaprila'
    : 'chiudila e riaprila';
}

/**
 * @param {{binaries?: Record<string, {found?: boolean, path?: string|null}>,
 *   tmuxAvailable?: boolean, tmuxInstalled?: boolean, tmuxPath?: string|null,
 *   platform?: string}} [input]
 *   `tmuxAvailable`: le sessioni passano da tmux. `tmuxInstalled`: il binario
 *   c'è adesso, anche se installato ad app già aperta.
 * @returns {{agents: Array<{type: string, label: string, found: boolean, path: string|null,
 *   install: {command: string|null, url: string, note?: string}}>,
 *   tmux: {found: boolean, pending: boolean, path: string|null,
 *     install: {command: string|null}, note: string}|null,
 *   ready: boolean, complete: boolean}}
 *   `ready`: c'è almeno un agente, si può cominciare. `complete`: non manca niente.
 *   `tmux` è null dove l'app non lo usa (Windows). `pending`: installato ma
 *   non ancora in uso, finché l'app non riparte.
 */
function setupReport({ binaries = {}, tmuxAvailable = false, tmuxInstalled = tmuxAvailable,
  tmuxPath = null, platform = process.platform } = {}) {
  const agents = AGENTS.map(({ type, label, install }) => {
    const b = binaries[type] || {};
    return { type, label, found: Boolean(b.found), path: b.path || null, install };
  });
  // tmux legge la sua configurazione e decide il backend solo all'avvio
  // dell'app (app/pty.js): installarlo non basta, va detto.
  const pending = Boolean(tmuxInstalled) && !tmuxAvailable;
  const tmux = platform === 'win32' ? null : {
    found: Boolean(tmuxAvailable),
    pending,
    path: tmuxPath,
    install: { command: TMUX_INSTALL[platform] || null },
    note: pending
      ? `Installato: si attiva quando riavvii l'app, ${restartHow(platform)}.`
      : `Senza tmux le sessioni muoiono con la finestra. Dopo averlo installato riavvia l'app: ${restartHow(platform)}.`,
  };
  const ready = agents.some((a) => a.found);
  const complete = agents.every((a) => a.found) && (!tmux || tmux.found);
  return { agents, tmux, ready, complete };
}

/**
 * Quello che restituisce l'handler `check-deps`: i binari per i pallini della
 * sidebar, il PATH per il loro tooltip e il resoconto per la schermata vuota.
 * I binari si cercano una volta sola per tutti e tre.
 *
 * tmux invece si cerca a ogni chiamata se l'app non lo sta usando: chi lo
 * installa e preme «Ricontrolla» deve sapere che è stato trovato e che manca
 * solo il riavvio, non vedere ancora una ✘.
 * @param {{tmuxAvailable?: boolean, platform?: string,
 *   resolveAll?: () => object, loginPath?: () => string,
 *   resolveTmux?: (searchPath: string) => {path: string|null}}} [opts]
 */
function checkDeps({ tmuxAvailable = false, platform = process.platform,
  resolveAll = resolveAllBinaries, loginPath = getLoginPathSync,
  resolveTmux = (searchPath) => resolveBinary('tmux', { searchPath, platform }) } = {}) {
  const binaries = resolveAll();
  const searchPath = loginPath();
  const tmuxPath = tmuxAvailable || platform === 'win32' ? null : resolveTmux(searchPath).path;
  const setup = setupReport({ binaries, tmuxAvailable, tmuxInstalled: tmuxAvailable || Boolean(tmuxPath), tmuxPath, platform });
  return { ...binaries, path: searchPath, setup };
}

module.exports = { setupReport, checkDeps, AGENTS };
