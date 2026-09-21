/* Uso di OpenCode, chiesto al CLI stesso.
 *
 * OpenCode tiene tutto in un SQLite (`~/.local/share/opencode/opencode.db`) che
 * non possiamo aprire da qui: Electron 33 monta Node 20, senza `node:sqlite`, e
 * aggiungere un modulo nativo per una barra di stato non vale il prezzo (va
 * ricompilato a ogni versione di Electron, su tre sistemi operativi).
 * Il CLI espone pero' `opencode db "<SQL>" --format json`: una sola query
 * restituisce tutto quello che serve, con un solo processo.
 *
 * Si leggono solo i token: la barra non mostra costi (vedi
 * docs/plans/13-barra-usage.md), quindi non serve interrogare `data.cost`.
 */
'use strict';
const { execFile } = require('child_process');
const { resolveBinary, augmentedEnv } = require('../binaries');
const { getLoginPathSync } = require('../login-path');

const SOURCE = 'opencode';
const EXEC_TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Query di aggregazione. `since` entra come intero validato, non come testo:
 * e' l'unico valore che arriva da fuori e finisce in SQL.
 * @param {number} since millisecondi epoch
 */
function usageQuery(since) {
  const ms = Number(since);
  if (!Number.isFinite(ms) || ms < 0 || Math.floor(ms) !== ms) {
    throw new Error(`since non valido: atteso un intero di millisecondi, ricevuto ${JSON.stringify(since)}`);
  }
  // Si aggrega gia' in SQL, per ora e per sessione: `opencode db` tronca
  // l'output quando e' lungo (esce prima di svuotare stdout), e una riga per
  // messaggio supera il limite dopo poche settimane d'uso. L'ora e' la
  // granularita' piu' fine che serve: le finestre che la barra mostra sono
  // di 5 ore e di una settimana.
  return [
    "select session_id as sessionId,",
    ` min(time_created) as ts,`,
    " json_extract(data,'$.modelID') as model,",
    " json_extract(data,'$.providerID') as provider,",
    " sum(coalesce(json_extract(data,'$.tokens.input'),0)) as input,",
    " sum(coalesce(json_extract(data,'$.tokens.output'),0)) as output,",
    " sum(coalesce(json_extract(data,'$.tokens.reasoning'),0)) as reasoning,",
    " sum(coalesce(json_extract(data,'$.tokens.cache.read'),0)) as cacheRead,",
    " sum(coalesce(json_extract(data,'$.tokens.cache.write'),0)) as cacheWrite,",
    " max(json_extract(data,'$.path.cwd')) as cwd",
    " from message",
    " where json_extract(data,'$.role') = 'assistant'",
    ` and time_created >= ${ms}`,
    " group by sessionId, model, provider, time_created / 3600000",
  ].join('');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Righe JSON del CLI -> eventi. Solleva se l'output non e' JSON: e' il caso in
 * cui il CLI ha stampato un errore, e chi chiama lo trasforma in messaggio.
 * @param {string} stdout
 * @returns {Array<object>}
 */
function parseUsageRows(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return []; // nessuna riga: il CLI non stampa nemmeno "[]"
  let rows = null;
  try {
    rows = JSON.parse(text);
  } catch {
    // Un elenco che inizia bene e non finisce e' output tagliato, non un
    // errore del CLI: sono due diagnosi diverse e vanno dette diverse.
    if (text.startsWith('[')) throw new Error('opencode ha restituito un elenco JSON troncato (output tagliato dal CLI).');
    throw new Error('opencode ha restituito qualcosa che non e JSON: ' + text.slice(0, 120));
  }
  if (!Array.isArray(rows)) throw new Error('opencode ha restituito un formato inatteso (non un elenco).');
  return rows.filter((r) => r && typeof r === 'object').map((r) => {
    const model = String(r.model || '');
    const input = num(r.input);
    const output = num(r.output);
    const cacheRead = num(r.cacheRead);
    const cacheWrite = num(r.cacheWrite);
    return {
      source: SOURCE,
      ts: num(r.ts),
      model: model || String(r.provider || ''),
      input,
      output,
      cacheWrite,
      cacheRead,
      // La query somma i messaggi di un'ora: i totali restano giusti, ma questi
      // token non sono il contesto di un singolo scambio. Chi disegna la barra
      // del contesto (aggregate.sessionContext) deve poterlo sapere.
      aggregated: true,
      sessionId: String(r.sessionId || ''),
      cwd: String(r.cwd || ''),
      key: `${r.sessionId}:${r.ts}:${model}`,
    };
  });
}

/**
 * Eventi d'uso di OpenCode.
 * `run` e `binary` sono iniettabili: i test verificano la gestione degli errori
 * senza avere opencode installato.
 * @param {{ since?: number, run?: Function, binary?: string|null }} [opts]
 * @returns {Promise<{ok:boolean, available:boolean, error?:string, events:Array<object>}>}
 */
function collectOpencodeUsage({ since = 0, run = execFile, binary } = {}) {
  const resolved = binary === undefined ? resolveBinary('opencode') : { path: binary, searchedPath: '' };
  if (!resolved.path) {
    return Promise.resolve({
      ok: false,
      available: false,
      error: `Binario 'opencode' non trovato nel PATH (${resolved.searchedPath || getLoginPathSync()}).`,
      events: [],
    });
  }
  let query = '';
  try {
    query = usageQuery(Math.floor(Number(since) || 0));
  } catch (e) {
    return Promise.resolve({ ok: false, available: true, error: String(e.message), events: [] });
  }
  const args = ['db', query, '--format', 'json'];
  return new Promise((resolve) => {
    run(resolved.path, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env: augmentedEnv([resolved.path]) },
      (err, stdout, stderr) => {
        if (err) {
          return resolve({ ok: false, available: true, error: `opencode errore (${resolved.path}): ${stderr || err.message}`, events: [] });
        }
        try {
          return resolve({ ok: true, available: true, events: parseUsageRows(stdout) });
        } catch (e) {
          return resolve({ ok: false, available: true, error: String(e.message), events: [] });
        }
      });
  });
}

module.exports = { collectOpencodeUsage, parseUsageRows, usageQuery, SOURCE };
