/* Disegna la bacheca delle segnalazioni (docs/plans/48-segnalazioni.md).
 *
 * Disegno e filtri (`filterBy`): la rete invece la fa il main, perché la CSP
 * della pagina ha connect-src 'none'. Qui arrivano voci già pronte.
 * I filtri stanno qui e non in lib/feedback-source.js perché il renderer gira
 * sandboxed e non può importare da lib/ (regola di CLAUDE.md, come
 * session-groups.js): il perché per esteso è in lib/feedback-source.js.
 *
 * `textContent`, mai `innerHTML`: titoli, descrizioni e nomi li scrivono
 * estranei che aprono una issue.
 *
 * Wrapper UMD come session-groups.js: globale nella pagina, modulo sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessFeedbackView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Il badge accanto al titolo. Senza voce qui lo stato non si vede: deve
   *  restare allineato a STATI in lib/feedback-source.js. */
  const ETICHETTE = {
    pianificato: 'Pianificato',
    'in-corso': 'In corso',
    completato: 'Completato',
    'non-lo-faremo': 'Non lo faremo',
  };

  const quando = (v) => Date.parse(v.creata || '') || 0;

  /** Stati di una cosa gia' decisa: non chiede piu' voti a nessuno. */
  const CHIUSE = ['completato', 'non-lo-faremo'];

/**
 * Le quattro linguette. Una sconosciuta ricade su «Di tendenza»: meglio di una
 * lista vuota, che sembrerebbe «non c'e' niente» invece di «non ho capito».
 */
  function filterBy(voci, linguetta) {
    const tutte = Array.isArray(voci) ? [...voci] : [];
    if (linguetta === 'recenti') return tutte.sort((a, b) => quando(b) - quando(a));
  // «Pianificato» risponde a «ci state lavorando?»: comprende anche cio' che
  // e' gia' in corso, altrimenti servirebbe guardare in due posti.
    if (linguetta === 'pianificato') return tutte.filter((v) => v.stato === 'pianificato' || v.stato === 'in-corso').sort((a, b) => b.voti - a.voti);
    if (linguetta === 'rilasciate') return tutte.filter((v) => v.stato === 'completato').sort((a, b) => quando(b) - quando(a));
  // Di tendenza risponde a «cosa c'e' ancora sul tavolo»: quello che e' gia'
  // stato deciso — fatto o scartato — non ci sta, altrimenti una riga chiusa
  // con tanti voti ci resterebbe in cima per sempre. Si ritrova in «Recenti»,
  // e il completato anche in «Rilasciate». Piu' votate in cima, a parita' di
  // voti la piu' recente.
    return tutte.filter((v) => !CHIUSE.includes(v.stato)).sort((a, b) => b.voti - a.voti || quando(b) - quando(a));
  }


  function el(tag, cls, testo) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (testo !== undefined) e.textContent = String(testo);
    return e;
  }

  /** @param host dove disegnare · voci già filtrate · onOpen(numero) */
  function renderFeedback(host, { voci, errore, onOpen } = {}) {
    if (!host) return;
    while (host.children.length) host.removeChild(host.children[0]);

    // Un errore non butta via le voci che avevamo: si dice sopra e sotto
    // resta la bacheca di prima.
    if (errore) host.appendChild(el('p', 'fb-errore', `Non sono riuscito a leggere la bacheca: ${errore}`));

    const lista = Array.isArray(voci) ? voci : [];
    if (!lista.length) {
      // Una finestra bianca sembra rotta: si dice che non c'è niente.
      host.appendChild(el('p', 'muted small', errore
        ? 'Nessuna segnalazione da mostrare.'
        : 'Ancora nessuna segnalazione. Il « + » qui sopra ne apre una.'));
      return;
    }

    for (const v of lista) {
      const riga = el('div', `fb-voce tipo-${v.tipo}`);

      const voto = el('button', 'fb-voto');
      voto.type = 'button';
      voto.setAttribute('data-numero', String(v.numero));
      // Da un link non si può aggiungere una reazione su GitHub: il pulsante
      // porta alla issue, e lo dice invece di fingere di votare.
      voto.title = 'Apre la segnalazione su GitHub, dove puoi mettere 👍';
      voto.appendChild(el('span', 'fb-freccia', '▲'));
      voto.appendChild(el('span', 'fb-voti', v.voti));
      voto.addEventListener('click', () => { if (onOpen) onOpen(v.numero); });
      riga.appendChild(voto);

      // Anche il corpo apre la issue: cercare di leggerne una premendo un
      // pulsante che dice «vota» era il contrario di quello che uno si
      // aspetta (piano 50). Fratello del riquadro, non dentro: un <button>
      // dentro un <button> non è HTML valido.
      const corpo = el('button', 'fb-corpo');
      corpo.type = 'button';
      corpo.title = 'Apri la segnalazione su GitHub';
      corpo.setAttribute('data-numero', String(v.numero));
      corpo.addEventListener('click', () => { if (onOpen) onOpen(v.numero); });
      corpo.appendChild(el('span', 'fb-titolo', v.titolo));
      const sotto = el('span', 'fb-sotto');
      if (ETICHETTE[v.stato]) sotto.appendChild(el('span', `fb-stato stato-${v.stato}`, ETICHETTE[v.stato]));
      if (v.autore) sotto.appendChild(el('span', 'fb-autore', `di ${v.autore}`));
      corpo.appendChild(sotto);
      riga.appendChild(corpo);

      host.appendChild(riga);
    }
  }

  return { renderFeedback, filterBy, ETICHETTE };
});
