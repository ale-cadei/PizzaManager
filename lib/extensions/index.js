'use strict';
/* Plugin e skill installati per ogni CLI (docs/plans/29). Si legge solo il
 * disco. Un CLI che fallisce riporta il suo errore senza svuotare gli altri. */
const os = require('os');
const { readClaude } = require('./claude');
const { readCodex } = require('./codex');
const { readOpencode } = require('./opencode');

const READERS = [
  { id: 'claude', label: 'Claude Code', read: readClaude },
  { id: 'codex', label: 'Codex', read: readCodex },
  { id: 'opencode', label: 'opencode', read: readOpencode },
];

/**
 * @param {{home?: string, env?: Record<string, string|undefined>}} o
 * @returns {Promise<{ok: true, clis: Array<{id: string, label: string, ok: boolean, error?: string, plugins: object[], skillDirs: object[]}>}>}
 */
async function listExtensions({ home = os.homedir(), env = process.env } = {}) {
  const clis = await Promise.all(READERS.map(async ({ id, label, read }) => {
    try {
      return { id, label, ok: true, ...(await read({ home, env })) };
    } catch (e) {
      console.error(`[extensions] ${id}:`, e);
      return { id, label, ok: false, error: String((e && e.message) || e).slice(0, 300), plugins: [], skillDirs: [] };
    }
  }));
  return { ok: true, clis };
}

module.exports = { listExtensions };
