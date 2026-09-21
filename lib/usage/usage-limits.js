/* I tetti osservati, uno per assistente, conservati fra un avvio e l'altro.
 *
 * La barra della finestra di 5 ore mostra token consumati su un tetto, e il
 * tetto nessuno lo dichiara: Claude e opencode non scrivono nessuna quota nei
 * loro log. Si calibra allora sul massimo consumo mai visto in una finestra
 * conclusa (`peakOf` in aggregate.js) — un fatto misurato, non un numero
 * inventato per far tornare una percentuale.
 *
 * Perche' un file e non solo la lettura corrente: la barra legge una settimana
 * di log, il massimo storico puo' essere piu' vecchio. Senza memoria il tetto
 * calerebbe da solo e le percentuali si gonfierebbero.
 *
 * Come gli altri store la cartella arriva dalla factory (`{ dir }`): main.js
 * passa quella di Electron, i test una tmpdir.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LIMITS_FILE = 'usage-limits.json';
const VERSION = 1;
/* I nomi delle sorgenti li scrive lib/usage, ma il file e' su disco e puo'
   essere modificato a mano: si accetta solo quello che somiglia a un nome. */
const SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

function validPeak(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Il contenuto del file, ridotto a quello che ha senso. */
function sanitize(parsed) {
  const sources = parsed && typeof parsed === 'object' ? parsed.sources : null;
  if (!sources || typeof sources !== 'object') return {};
  return Object.keys(sources).reduce((acc, name) => {
    const row = sources[name];
    const peak = row && typeof row === 'object' ? validPeak(row.fiveHourPeak) : null;
    if (!SOURCE_RE.test(name) || peak === null) return acc;
    const at = Number(row.observedAt);
    return { ...acc, [name]: { fiveHourPeak: peak, observedAt: Number.isFinite(at) ? at : null } };
  }, {});
}

function createUsageLimitsStore({ dir } = {}) {
  if (!dir) throw new Error('createUsageLimitsStore richiede una directory');
  const file = path.join(dir, LIMITS_FILE);

  /** @returns {Object<string, {fiveHourPeak:number, observedAt:number|null}>} */
  function read() {
    try {
      if (!fs.existsSync(file)) return {};
      return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      return {}; // file corrotto: si riparte dalla calibrazione, non si crolla
    }
  }

  /** Solo i numeri, come li vuole aggregate(). */
  function peaks() {
    const rows = read();
    return Object.keys(rows).reduce((acc, name) => ({ ...acc, [name]: rows[name].fiveHourPeak }), {});
  }

  /** Quando e' stato visto ogni massimo, per il tooltip. */
  function peaksAt() {
    const rows = read();
    return Object.keys(rows).reduce((acc, name) => ({ ...acc, [name]: rows[name].observedAt }), {});
  }

  function write(rows) {
    try {
      fs.writeFileSync(file, JSON.stringify({ version: VERSION, sources: rows }, null, 2));
    } catch (e) {
      console.error('usage-limits: scrittura fallita:', e.message || e);
    }
    return rows;
  }

  /**
   * Registra i massimi appena osservati. Il tetto sale e non scende: quello
   * salvato resta se e' piu' alto. Si scrive solo quando qualcosa e'
   * cresciuto — la barra chiama questo metodo ogni 8 secondi.
   * @param {Object<string, number>} candidates massimi per sorgente
   * @param {{ now?: number }} [opts]
   * @returns {Object<string, number>} i tetti dopo l'aggiornamento
   */
  function observe(candidates, { now = Date.now() } = {}) {
    const rows = read();
    const list = candidates && typeof candidates === 'object' ? candidates : {};
    const next = Object.keys(list).reduce((acc, name) => {
      const peak = validPeak(list[name]);
      if (!SOURCE_RE.test(name) || peak === null) return acc;
      const before = acc[name];
      if (before && before.fiveHourPeak >= peak) return acc;
      return { ...acc, [name]: { fiveHourPeak: peak, observedAt: now } };
    }, rows);
    const cambiato = Object.keys(next).some((n) => !rows[n] || rows[n].fiveHourPeak !== next[n].fiveHourPeak);
    if (cambiato) write(next);
    return Object.keys(next).reduce((acc, name) => ({ ...acc, [name]: next[name].fiveHourPeak }), {});
  }

  return { file, read, peaks, peaksAt, observe };
}

module.exports = { createUsageLimitsStore, LIMITS_FILE };
