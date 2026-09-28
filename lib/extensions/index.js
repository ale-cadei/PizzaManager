'use strict';
/* Plugin e skill installati per ogni CLI (docs/plans/29). Si legge solo il
 * disco. Un CLI che fallisce riporta il suo errore senza svuotare gli altri. */
const os = require('os');
const path = require('path');
const { findProjectRoot } = require('../project-root');
const { tildify } = require('./common');
const { readClaude } = require('./claude');
const { readCodex } = require('./codex');
const { readOpencode } = require('./opencode');

const READERS = [
  { id: 'claude', label: 'Claude Code', read: readClaude },
  { id: 'codex', label: 'Codex', read: readCodex },
  { id: 'opencode', label: 'opencode', read: readOpencode },
];

/**
 * Il progetto della sessione in primo piano (docs/plans/30): la radice del
 * repository di `cwd`. La home non conta come progetto: le sue cartelle sono
 * già quelle globali, si vedrebbero due volte.
 * @returns {string|null}
 */
function projectOf(cwd, home, pathImpl = path) {
  const root = typeof cwd === 'string' && cwd ? findProjectRoot(cwd, { pathImpl }) : null;
  if (!root || pathImpl.resolve(root) === pathImpl.resolve(home)) return null;
  return root;
}

/**
 * @param {{home?: string, env?: Record<string, string|undefined>, cwd?: string|null}} o
 *   `cwd`: cartella della sessione in primo piano, per le skill del progetto
 * @returns {Promise<{ok: true, project: string|null, clis: Array<{id: string, label: string, ok: boolean, error?: string, plugins: object[], skillDirs: object[]}>}>}
 */
async function listExtensions({ home = os.homedir(), env = process.env, cwd = null } = {}) {
  const project = projectOf(cwd, home);
  const clis = await Promise.all(READERS.map(async ({ id, label, read }) => {
    try {
      return { id, label, ok: true, ...(await read({ home, env, project })) };
    } catch (e) {
      console.error(`[extensions] ${id}:`, e);
      return { id, label, ok: false, error: String((e && e.message) || e).slice(0, 300), plugins: [], skillDirs: [] };
    }
  }));
  return { ok: true, project: project && tildify(project, home), clis };
}

module.exports = { listExtensions, projectOf };
