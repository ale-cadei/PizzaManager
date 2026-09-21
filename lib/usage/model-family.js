/* Dal nome di un modello alla sua famiglia.
 *
 * I nomi veri portano una data (`claude-opus-4-20250514`) o un suffisso di
 * provider: le tabelle (prezzi, finestra di contesto) sono per famiglia. Si
 * cerca il prefisso piu' lungo che combacia, cosi' un modello nuovo della
 * stessa famiglia resta riconosciuto invece di diventare sconosciuto al primo
 * aggiornamento del CLI.
 *
 * Sta in un modulo suo perche' lo usano due tabelle: se la regola di
 * abbinamento cambia, cambia in un posto solo.
 */
'use strict';

function normalizeModel(model) {
  return String(model || '').trim().toLowerCase();
}

/**
 * Valore della famiglia a cui appartiene il modello, o null se fuori tabella.
 * @template T
 * @param {Record<string, T>} table chiavi = famiglie
 * @param {string} model
 * @returns {T|null} null = sconosciuto (mai un valore di ripiego)
 */
function lookupFamily(table, model) {
  const name = normalizeModel(model);
  if (!name || !table) return null;
  if (table[name]) return table[name];
  const match = Object.keys(table)
    .filter((key) => name.startsWith(key))
    .reduce((best, key) => (best && best.length >= key.length ? best : key), null);
  return match ? table[match] : null;
}

module.exports = { lookupFamily, normalizeModel };
