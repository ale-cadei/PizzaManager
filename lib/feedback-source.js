'use strict';

/**
 * La bacheca delle segnalazioni: da dove arrivano le voci e dove si va per
 * scriverne una.
 *
 * `filterBy` NON sta qui ma in renderer/feedback-view.js: il renderer gira
 * sandboxed e non puo' importare da lib/, e i filtri servono a ogni clic su
 * una linguetta (regola di CLAUDE.md, come session-groups.js).
 *
 * Puro: nessun require di electron e nessuna rete. Il feed arriva come testo
 * (lo scarica app/feedback.js), gli indirizzi li apre il main. Cosi' le
 * regole si verificano senza avviare l'app ne' toccare internet.
 *
 * Il magazzino e' GitHub: le issue del repo pubblico hanno gia' i voti
 * (reazioni), gli stati (etichette) e l'autore. L'interfaccia qui sotto —
 * `parseFeed`, `filterBy`, `createUrl`, `voteUrl` — e' pero' indipendente da
 * quella scelta: il giorno in cui servisse un backend si riscrive questo
 * modulo e il pannello non se ne accorge (docs/plans/48-segnalazioni.md).
 */

/** Il repo pubblico: contiene solo le Release e, da qui, le segnalazioni. */
const REPO = 'JackGrieco/PizzaManager-releases';

/** Stati, dedotti dalle etichette `stato:*`. Senza etichetta: 'aperta'. */
const STATI = ['aperta', 'pianificato', 'in-corso', 'completato'];

/**
 * Legge il file generato dall'Action. Un feed rotto non deve far cadere il
 * pannello: lo genera un programma, e se un giorno sbaglia meglio una
 * bacheca vuota che una finestra bianca.
 */
function parseFeed(text) {
  let data = null;
  try {
    data = JSON.parse(String(text || ''));
  } catch {
    return { generato: null, voci: [] };
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.voci)) return { generato: null, voci: [] };
  const voci = data.voci
    // Numero e titolo sono il minimo per disegnare una riga e saperci tornare.
    .filter((v) => v && Number.isFinite(Number(v.numero)) && typeof v.titolo === 'string' && v.titolo.trim())
    .map((v) => ({
      numero: Number(v.numero),
      titolo: String(v.titolo),
      autore: v.autore ? String(v.autore) : '',
      voti: Number.isFinite(Number(v.voti)) ? Number(v.voti) : 0,
      stato: STATI.includes(v.stato) ? v.stato : 'aperta',
      tipo: v.tipo === 'segnalazione' ? 'segnalazione' : 'richiesta',
      url: v.url ? String(v.url) : `https://github.com/${REPO}/issues/${Number(v.numero)}`,
      creata: v.creata ? String(v.creata) : '',
    }));
  return { generato: data.generato ? String(data.generato) : null, voci };
}

/**
 * L'indirizzo per aprire una issue gia' compilata. Il modulo vero sta nel
 * pannello; qui si impacchetta cio' che l'utente ha scritto piu' la
 * diagnostica, che altrimenti andrebbe chiesta a mano a ogni scambio.
 *
 * `URLSearchParams` sfugge tutto: nel titolo e nel corpo finiscono & # ?
 * accenti e a capo scritti da una persona.
 */
function createUrl({ tipo, titolo, corpo, diagnostica } = {}) {
  const template = tipo === 'segnalazione' ? 'segnalazione.yml' : 'richiesta.yml';
  const body = [corpo || '', diagnostica ? `\n\n---\n${diagnostica}` : ''].join('');
  const q = new URLSearchParams({ template, title: String(titolo || ''), body });
  return `https://github.com/${REPO}/issues/new?${q}`;
}

/**
 * Dove si va per votare. **GitHub non permette di aggiungere una reazione da
 * un link**: si apre la issue e la persona preme 👍 li'. Il pannello deve
 * dirlo, non fingere una freccia che vota.
 */
function voteUrl(numero) {
  const n = Number(numero);
  return Number.isFinite(n) && n > 0 ? `https://github.com/${REPO}/issues/${n}` : null;
}

/** Dove sta il file che l'Action rigenera a ogni issue aperta o etichettata. */
const FEED_URL = `https://raw.githubusercontent.com/${REPO}/main/feedback.json`;

module.exports = { parseFeed, createUrl, voteUrl, REPO, FEED_URL, STATI };
