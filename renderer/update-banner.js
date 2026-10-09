/* Banner dell'aggiornamento, in cima alla finestra.
 *
 * Non un modal: un aggiornamento non è una domanda a cui rispondere adesso,
 * e bloccare la finestra per dirlo sarebbe sproporzionato. Si mostra in alto,
 * si può rimandare, e il lavoro sotto continua.
 *
 * Il banner non decide niente: riceve già pronti il testo e quale tasto
 * mostrare (lib/update-policy.js, bannerText), così la regola «macOS può
 * riavviarsi, il .deb no» vive in un posto solo e si verifica senza DOM.
 *
 * Il DOM si costruisce con createElement e textContent, mai con innerHTML:
 * nel messaggio finisce la versione e, in prospettiva, le note di rilascio
 * scritte su GitHub — cioè dati che arrivano da fuori (regola di CLAUDE.md).
 *
 * Wrapper UMD come session-groups.js: globale nella pagina, modulo sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessUpdateBanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /**
   * @param host    dove appoggiare il banner (un contenitore vuoto)
   * @param onApply premuto «Riavvia ora» o «Scarica»: decide il main
   * @param onDismiss premuto «Più tardi»
   */
  function createUpdateBanner({ host, onApply, onDismiss } = {}) {
    if (!host) throw new Error('createUpdateBanner richiede un host');

    const svuota = () => { while (host.children.length) host.removeChild(host.children[0]); };

    function bottone(etichetta, classe, azione) {
      const b = document.createElement('button');
      b.className = classe;
      b.textContent = etichetta;
      b.addEventListener('click', () => { if (azione) azione(); });
      return b;
    }

    /** `null` significa «niente da dire»: il banner sparisce del tutto. */
    function render(state) {
      svuota();
      if (!state || !state.message) return;

      const riga = document.createElement('div');
      riga.className = `update-banner state-${state.state || 'idle'}`;

      const testo = document.createElement('span');
      testo.className = 'update-message';
      testo.textContent = state.message;
      riga.appendChild(testo);

      // La barra c'è solo mentre si scarica: a scaricamento finito non
      // aggiunge nulla, e a riposo direbbe «sono all'inizio di qualcosa».
      if (state.state === 'downloading' && Number.isFinite(state.percent)) {
        const pista = document.createElement('span');
        pista.className = 'update-progress';
        const dentro = document.createElement('span');
        dentro.className = 'update-progress-fill';
        dentro.style.width = `${Math.max(0, Math.min(100, state.percent))}%`;
        pista.appendChild(dentro);
        riga.appendChild(pista);
      }

      if (state.action === 'restart') riga.appendChild(bottone('Riavvia ora', 'update-apply', onApply));
      if (state.action === 'download') riga.appendChild(bottone('Scarica', 'update-apply', onApply));
      // «Più tardi» c'è sempre tranne che durante lo scaricamento, dove non
      // c'è ancora niente da rimandare e il banner è solo un avviso.
      if (state.state !== 'downloading') riga.appendChild(bottone('Più tardi', 'update-dismiss', onDismiss));

      host.appendChild(riga);
    }

    return { render };
  }

  return { createUpdateBanner };
});
