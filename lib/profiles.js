'use strict';
const fs = require('fs');
const path = require('path');
const commandProfiles = require('./command-profiles');
const { getDefaultShell } = require('./shell');

const PROFILES_FILE = 'command-profiles.json';

/**
 * Profili di comando su file JSON, sullo stesso modello di accounts e history:
 * la directory arriva dall'esterno, così il modulo si verifica su una tmpdir.
 *
 * La logica pura (tokenizer, validazione, normalizzazione) sta in
 * command-profiles.js; qui solo la persistenza e le regole d'insieme.
 */
function createProfileStore({ dir, shell = getDefaultShell(), platform = process.platform } = {}) {
  if (!dir) throw new Error('createProfileStore richiede una directory');
  const file = path.join(dir, PROFILES_FILE);

  /** Profili predefiniti: primo avvio e pulsante "Ripristina". */
  function defaults() {
    return commandProfiles.defaultProfiles({ shell, platform });
  }

  function load() {
    const d = defaults();
    try {
      if (fs.existsSync(file)) return commandProfiles.normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')), { defaults: d });
    } catch (e) {
      console.error('command-profiles: lettura fallita, uso i default:', e.message || e);
    }
    return commandProfiles.normalizeConfig(null, { defaults: d });
  }

  function save(raw) {
    const cfg = commandProfiles.normalizeConfig(raw, { defaults: defaults() });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    return cfg;
  }

  /**
   * Regole d'insieme su una configurazione arrivata dalla UI, con il primo
   * errore utile: normalizeConfig scarterebbe in silenzio, qui si spiega.
   */
  function validate(profiles) {
    if (!profiles || typeof profiles !== 'object') return { ok: false, error: 'Configurazione non valida.' };
    for (const type of commandProfiles.SESSION_TYPES) {
      const list = profiles[type];
      if (list === undefined) continue;
      if (!Array.isArray(list)) return { ok: false, error: `Elenco comandi non valido per '${type}'.` };
      if (!list.length) return { ok: false, error: `Serve almeno un comando per '${type}'.` };
      if (list.length > commandProfiles.MAX_PROFILES_PER_TYPE) {
        return { ok: false, error: `Massimo ${commandProfiles.MAX_PROFILES_PER_TYPE} comandi per tipo.` };
      }
      const labels = new Set();
      for (const item of list) {
        const v = commandProfiles.validateProfile(type, item);
        if (!v.ok) return { ok: false, error: v.error };
        const key = v.profile.label.toLowerCase();
        if (labels.has(key)) return { ok: false, error: `Nome duplicato per '${type}': "${v.profile.label}".` };
        labels.add(key);
      }
    }
    return { ok: true };
  }

  return { file, defaults, load, save, validate };
}

module.exports = { createProfileStore, PROFILES_FILE };
