/* La quota vera di Claude, quella che mostra /usage.
 *
 * Claude non scrive da nessuna parte quanto hai consumato: il numero lo tiene
 * il server e il CLI lo chiede a GET /api/oauth/usage con il token OAuth che
 * sta gia' in ~/.claude/.credentials.json (docs/plans/16-risultati.md).
 * E' l'unica fonte sincronizzata fra dispositivi: la calibrazione del piano 15
 * vede solo i log di questa macchina e per forza sottostima.
 *
 * Tre cose da non perdere di vista:
 * - l'endpoint non e' documentato: qualunque errore ricade sulla stima, non
 *   svuota la barra;
 * - il token non esce da qui: si legge, si mette in un header, non si registra
 *   e non finisce nell'oggetto restituito;
 * - la barra si aggiorna ogni 8 secondi, la rete no: c'e' una cache.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const TTL_MS = 5 * 60 * 1000;
/* Dopo un errore si riprova presto ma non subito: un endpoint che risponde 429
   va lasciato respirare, e la barra nel frattempo mostra la stima. */
const RETRY_MS = 60 * 1000;
const TIMEOUT_MS = 10_000;
const FIVE_HOUR_MINUTES = 300;
const WEEK_MINUTES = 7 * 24 * 60;

function defaultCredentialsPath(home = os.homedir()) {
  return path.join(home, '.claude', '.credentials.json');
}

/* Il file e' scritto da un altro programma: puo' mancare, essere a meta' o
   avere una forma diversa dopo un aggiornamento. Nessuno di questi casi e' un
   errore da propagare: vuol dire solo "niente token, usa la stima". */
function readToken(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const oauth = raw && typeof raw === 'object' ? raw.claudeAiOauth : null;
    const token = oauth && typeof oauth.accessToken === 'string' ? oauth.accessToken : '';
    return token.length > 20 ? token : null;
  } catch {
    return null;
  }
}

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
 * @param {{ credentialsPath?: string, fetchImpl?: Function, ttlMs?: number,
 *           retryMs?: number, endpoint?: string }} [opts]
 *           tutto iniettabile: i test non toccano ne' rete ne' home
 */
function createClaudeQuota({
  credentialsPath = defaultCredentialsPath(),
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  ttlMs = TTL_MS,
  retryMs = RETRY_MS,
  endpoint = ENDPOINT,
} = {}) {
  // Unico stato mutabile del modulo, e sta qui dentro: la cache.
  let cached = null;
  let nextAttempt = 0;

  async function fetchQuota(now) {
    const token = readToken(credentialsPath);
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
   * @param {{ now?: number }} [opts]
   * @returns {Promise<object|null>} quota dichiarata, o null se non c'e'
   */
  async function read({ now = Date.now() } = {}) {
    if (cached && now - cached.ts < ttlMs) return cached;
    if (now < nextAttempt) return cached;
    try {
      const fresh = await fetchQuota(now);
      if (fresh) {
        cached = fresh;
        nextAttempt = 0;
        return cached;
      }
    } catch {
      // rete assente, timeout, JSON storto: si tiene l'ultimo valore buono
    }
    nextAttempt = now + retryMs;
    return cached;
  }

  return { read, endpoint };
}

module.exports = {
  createClaudeQuota, parseOauthUsage, defaultCredentialsPath,
  ENDPOINT, TTL_MS, FIVE_HOUR_MINUTES, WEEK_MINUTES,
};
