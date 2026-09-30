/* La quota vera di Claude, quella che mostra /usage.
 *
 * Claude non scrive da nessuna parte quanto hai consumato: il numero lo tiene
 * il server e il CLI lo chiede a GET /api/oauth/usage con il token OAuth che
 * il CLI ha gia' salvato (docs/plans/16-risultati.md). Dove sta il token, e di
 * quale account, lo decide la config dir: lib/usage/claude-token.js (piano 35).
 * E' l'unica fonte sincronizzata fra dispositivi: la calibrazione del piano 15
 * vede solo i log di questa macchina e per forza sottostima.
 *
 * Tre cose da non perdere di vista:
 * - l'endpoint non e' documentato: qualunque errore ricade sulla stima, non
 *   svuota la barra;
 * - il token non esce da qui: si legge, si mette in un header, non si registra
 *   e non finisce nell'oggetto restituito;
 * - la barra si aggiorna ogni 8 secondi, la rete no: c'e' una cache, una per
 *   config dir (cioe' per account).
 */
'use strict';
const { readClaudeToken } = require('./claude-token');

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const TTL_MS = 5 * 60 * 1000;
/* Dopo un errore si riprova presto ma non subito: un endpoint che risponde 429
   va lasciato respirare, e la barra nel frattempo mostra la stima. */
const RETRY_MS = 60 * 1000;
const TIMEOUT_MS = 10_000;
const FIVE_HOUR_MINUTES = 300;
const WEEK_MINUTES = 7 * 24 * 60;

function windowOf(node, windowMinutes) {
  if (!node || typeof node !== 'object') return null;
  const used = Number(node.utilization);
  if (!Number.isFinite(used)) return null;
  const resetsAt = Date.parse(node.resets_at);
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    windowMinutes,
    ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
  };
}

/**
 * Dalla risposta dell'endpoint alla forma che usa gia' la barra per Codex.
 * Si leggono **solo** five_hour e seven_day: la risposta porta una decina di
 * campi sperimentali (nimbus_quill, tangelo, iguana_necktie...) quasi sempre
 * null, che cambieranno senza preavviso.
 * @param {unknown} body
 * @returns {{fiveHour: object|null, weekly: object|null}|null}
 */
function parseOauthUsage(body) {
  if (!body || typeof body !== 'object') return null;
  const fiveHour = windowOf(body.five_hour, FIVE_HOUR_MINUTES);
  const weekly = windowOf(body.seven_day, WEEK_MINUTES);
  if (!fiveHour && !weekly) return null;
  return { fiveHour, weekly };
}

/**
 * Lettore con cache della quota di Claude.
 * @param {{ readToken?: (configDir: string|null) => Promise<string|null>,
 *           fetchImpl?: Function, ttlMs?: number, retryMs?: number,
 *           endpoint?: string }} [opts]
 *           tutto iniettabile: i test non toccano ne' rete ne' Keychain
 */
function createClaudeQuota({
  readToken = (configDir) => readClaudeToken({ configDir }),
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  ttlMs = TTL_MS,
  retryMs = RETRY_MS,
  endpoint = ENDPOINT,
} = {}) {
  /* Unico stato mutabile del modulo, e sta qui dentro: la cache, una voce per
     config dir. Due account non si rubano ne' il numero ne' l'attesa dopo un
     errore. Le voci sono sostituite, mai modificate. */
  const entries = new Map();

  async function fetchQuota(configDir, now) {
    const token = await readToken(configDir);
    if (!token || !fetchImpl) return null;
    const res = await fetchImpl(endpoint, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Senza token l'endpoint risponde 429, non 401: un errore qui non dice
    // quale dei due sia, e in nessuno dei due casi c'e' un numero da mostrare.
    if (!res || !res.ok) return null;
    const parsed = parseOauthUsage(await res.json());
    return parsed ? { ts: now, source: 'claude', ...parsed } : null;
  }

  /**
   * @param {{ now?: number, configDir?: string|null }} [opts]
   *   `configDir` null = `claude` senza CLAUDE_CONFIG_DIR
   * @returns {Promise<object|null>} quota dichiarata, o null se non c'e'
   */
  async function read({ now = Date.now(), configDir = null } = {}) {
    const key = configDir || '';
    const { cached = null, nextAttempt = 0 } = entries.get(key) || {};
    if (cached && now - cached.ts < ttlMs) return cached;
    if (now < nextAttempt) return cached;
    try {
      const fresh = await fetchQuota(configDir, now);
      if (fresh) {
        entries.set(key, { cached: fresh, nextAttempt: 0 });
        return fresh;
      }
    } catch {
      // token illeggibile, rete assente, timeout, JSON storto: si tiene
      // l'ultimo valore buono
    }
    entries.set(key, { cached, nextAttempt: now + retryMs });
    return cached;
  }

  return { read, endpoint };
}

module.exports = {
  createClaudeQuota, parseOauthUsage,
  ENDPOINT, TTL_MS, FIVE_HOUR_MINUTES, WEEK_MINUTES,
};
