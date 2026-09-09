'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ACCOUNTS_FILE = 'claude-accounts.json';
const FILE_MODE = 0o600;

/**
 * Claude Code non ha profili integrati: c'è un solo login OAuth in
 * ~/.claude/.credentials.json, oppure ANTHROPIC_API_KEY nell'ambiente.
 * Qui si gestiscono il rilevamento dell'OAuth e i profili a chiave API.
 */

/** Cifratura di default: nessuna. Il branch 3 inietterà safeStorage al suo posto. */
const plainEncryptor = {
  encrypt: (s) => s,
  decrypt: (s) => s,
  get isAvailable() { return false; },
};

function detectOauth(home = os.homedir()) {
  try {
    const f = path.join(home, '.claude', '.credentials.json');
    if (!fs.existsSync(f)) return { available: false };
    const o = JSON.parse(fs.readFileSync(f, 'utf8')).claudeAiOauth;
    if (o && (o.accessToken || o.refreshToken)) {
      return {
        available: true,
        label: o.subscriptionType ? `login corrente (${o.subscriptionType})` : 'login corrente',
      };
    }
  } catch {
    // credenziali assenti o illeggibili: si considera l'OAuth non disponibile
  }
  return { available: false };
}

function newAccountId() {
  return 'acc_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * Profili Claude a chiave API, su file con permessi 600.
 *
 * `dir` e `encryptor` arrivano dall'esterno: il primo rende il modulo
 * verificabile su una directory temporanea, il secondo permetterà al branch 3
 * di sostituire il salvataggio in chiaro con safeStorage senza toccare qui.
 */
function createAccountStore({ dir, encryptor = plainEncryptor, home = os.homedir() } = {}) {
  if (!dir) throw new Error('createAccountStore richiede una directory');
  const file = path.join(dir, ACCOUNTS_FILE);

  /** Uso interno: include le chiavi. Non deve mai raggiungere il renderer. */
  function readAll() {
    try {
      if (!fs.existsSync(file)) return [];
      const parsed = JSON.parse(encryptor.decrypt(fs.readFileSync(file, 'utf8')));
      return Array.isArray(parsed) ? parsed.filter((a) => a && a.id && a.apiKey) : [];
    } catch {
      // file assente, illeggibile o non decifrabile: nessun profilo disponibile
      return [];
    }
  }

  function writeAll(accounts) {
    fs.writeFileSync(file, encryptor.encrypt(JSON.stringify(accounts, null, 2)), { mode: FILE_MODE });
    // writeFileSync applica mode solo alla creazione: su file esistente serve chmod
    try { fs.chmodSync(file, FILE_MODE); } catch {}
  }

  /** Proiezione sicura per la UI: le chiavi non escono da qui. */
  function list() {
    return readAll().map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt || null }));
  }

  function add({ name, apiKey } = {}) {
    const n = String(name || '').trim();
    const k = String(apiKey || '').trim();
    if (!n) return { ok: false, error: 'Nome account obbligatorio.' };
    if (!k) return { ok: false, error: 'API key obbligatoria.' };
    const accounts = readAll();
    if (accounts.some((a) => a.name.toLowerCase() === n.toLowerCase())) {
      return { ok: false, error: `Esiste già un account chiamato "${n}".` };
    }
    try {
      writeAll([...accounts, { id: newAccountId(), name: n, apiKey: k, createdAt: new Date().toISOString() }]);
    } catch (e) {
      return { ok: false, error: 'Salvataggio fallito: ' + (e.message || e) };
    }
    return { ok: true };
  }

  function remove(id) {
    try {
      writeAll(readAll().filter((a) => a.id !== id));
    } catch (e) {
      return { ok: false, error: 'Eliminazione fallita: ' + (e.message || e) };
    }
    return { ok: true };
  }

  /**
   * Variabili d'ambiente per il pty di una sessione Claude.
   * ANTHROPIC_API_KEY ha precedenza sul login OAuth di Claude Code.
   */
  function envFor(accountId) {
    if (!accountId || accountId === 'oauth') return { vars: {}, name: 'OAuth' };
    const acc = readAll().find((a) => a.id === accountId);
    if (!acc) return { vars: {}, name: null, error: 'Account Claude non trovato (forse eliminato).' };
    return { vars: { ANTHROPIC_API_KEY: acc.apiKey }, name: acc.name };
  }

  return { file, list, add, remove, envFor, detectOauth: () => detectOauth(home) };
}

module.exports = { createAccountStore, detectOauth, plainEncryptor, ACCOUNTS_FILE, FILE_MODE };
