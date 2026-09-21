/* Quanto e' grande la finestra di contesto di un modello, in token.
 *
 * Serve alla barra della sessione: i token consumati in totale non hanno un
 * tetto contro cui disegnare un avanzamento (si puo' spendere all'infinito),
 * il contesto si'. La quota mostrata e' quindi "quanto e' pieno il contesto
 * dell'ultima richiesta", che e' anche l'unica soglia che l'utente puo'
 * davvero colpire durante una conversazione.
 *
 * Modello fuori tabella -> null, e la barra non si disegna: meglio nessuna
 * barra che una barra su un limite inventato.
 */
'use strict';
const { lookupFamily } = require('./model-family');

/* Valori al 2026-09, finestra standard (non le varianti "long context" a
   pagamento, che si attivano con un header e non risultano dai log). */
const TABLE = Object.freeze({
  // --- Anthropic ---
  'claude-opus-5': 200_000,
  'claude-opus-4': 200_000,
  'claude-opus-3': 200_000,
  'claude-sonnet-5': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-3-7-sonnet': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-haiku-4': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-fable-5': 200_000,
  // --- OpenAI (Codex CLI) ---
  'gpt-5.5': 400_000,
  'gpt-5.1': 400_000,
  'gpt-5-codex': 400_000,
  'gpt-5': 400_000,
  'o4-mini': 200_000,
  // --- Google (Gemini / Antigravity) ---
  'gemini-3': 1_000_000,
  'gemini-2-5': 1_000_000,
});

/**
 * Finestra di contesto della famiglia del modello.
 * @param {string} model
 * @returns {number|null} null = modello sconosciuto
 */
function contextLimitFor(model) {
  const limit = lookupFamily(TABLE, model);
  return Number.isFinite(limit) ? limit : null;
}

/** Le famiglie in tabella, per i test e per la diagnostica. */
function knownContextModels() {
  return Object.keys(TABLE);
}

module.exports = { contextLimitFor, knownContextModels };
