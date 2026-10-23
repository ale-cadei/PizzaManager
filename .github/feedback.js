'use strict';
/*
 * Legge le issue aperte e chiuse e scrive feedback.json, che è ciò che l'app
 * scarica per disegnare la bacheca (📣 Segnalazioni).
 *
 * Gira dentro una GitHub Action, dove `GH_TOKEN` c'è ed esiste `gh`: qui si
 * usa l'API REST con fetch, senza dipendenze da installare.
 *
 * Lo stato esce dalle etichette `stato:*`; i voti dalle reazioni 👍.
 */
const { writeFileSync, readFileSync, existsSync } = require('fs');

const REPO = process.env.REPO;
const TOKEN = process.env.GH_TOKEN;
const PER_PAGINA = 100;
/* Oltre un certo punto la bacheca non si scorre più: si tengono le più
   votate, non tutte. Il numero è generoso e il file resta piccolo. */
const MAX_VOCI = 300;

async function api(percorso) {
  const res = await fetch(`https://api.github.com${percorso}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'pizzamanager-feedback',
    },
  });
  if (!res.ok) throw new Error(`GitHub ha risposto ${res.status} per ${percorso}`);
  return res.json();
}

/*
 * Le etichette di questo repo sono il vocabolario dell'app: `bug` ed
 * `enhancement` decidono il tipo, `stato:*` il badge. Un'etichetta che l'app
 * non conosce qui passa, ma lì non si vede, e la richiesta resta una riga
 * aperta che continua a raccogliere voti anche dopo che è stata decisa. Per
 * questo le etichette predefinite di GitHub (wontfix, duplicate, question…)
 * sono state tolte: gli stati veri stanno in STATI, in
 * lib/feedback-source.js nel repo del codice.
 */

/** `stato:in-corso` → `in-corso`. Senza etichetta: 'aperta'. */
function statoDa(labels) {
  const nomi = (labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const stato = nomi.find((n) => String(n).startsWith('stato:'));
  return stato ? String(stato).slice('stato:'.length) : 'aperta';
}

function tipoDa(labels) {
  const nomi = (labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  return nomi.includes('bug') ? 'segnalazione' : 'richiesta';
}

async function main() {
  const voci = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const lotto = await api(`/repos/${REPO}/issues?state=all&per_page=${PER_PAGINA}&page=${pagina}`);
    if (!lotto.length) break;
    for (const i of lotto) {
      // Le pull request arrivano dallo stesso endpoint: non sono segnalazioni.
      if (i.pull_request) continue;
      voci.push({
        numero: i.number,
        titolo: i.title,
        autore: (i.user && i.user.login) || '',
        voti: (i.reactions && i.reactions['+1']) || 0,
        stato: statoDa(i.labels),
        tipo: tipoDa(i.labels),
        url: i.html_url,
        creata: i.created_at,
      });
    }
    if (lotto.length < PER_PAGINA) break;
  }

  voci.sort((a, b) => b.voti - a.voti || Date.parse(b.creata) - Date.parse(a.creata));
  const nuove = voci.slice(0, MAX_VOCI);

  // `generato` cambierebbe a ogni giro, quindi il file risulterebbe sempre
  // diverso e l'Action committerebbe ogni ora per sempre. Si confrontano le
  // VOCI: se sono le stesse non si tocca il file, e il commit non avviene.
  let vecchie = null;
  try {
    if (existsSync('feedback.json')) vecchie = JSON.parse(readFileSync('feedback.json', 'utf8')).voci;
  } catch { /* file rotto: si riscrive */ }
  if (vecchie && JSON.stringify(vecchie) === JSON.stringify(nuove)) {
    console.log(`feedback.json: ${nuove.length} voci, nessun cambiamento`);
    return;
  }

  const dati = { generato: new Date().toISOString(), voci: nuove };
  writeFileSync('feedback.json', JSON.stringify(dati, null, 2) + '\n');
  console.log(`feedback.json: ${nuove.length} voci, aggiornato`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
