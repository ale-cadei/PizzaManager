/* Barra dell'uso, sotto il terminale.
 *
 * Tre riquadri, tre limiti: il contesto della sessione in primo piano, la
 * finestra di fatturazione di 5 ore, la settimana mobile. Nessun costo in
 * dollari: la domanda a cui la barra risponde e' «quanto manca al limite»,
 * e i limiti non sono in dollari.
 *
 * Ogni riquadro ha una barra solo quando esiste una quota vera da disegnare
 * (un limite di contesto noto, una percentuale dichiarata dal CLI, il tempo
 * trascorso in una finestra aperta). Quando manca, la barra sparisce: una
 * barra a zero direbbe «sei all'inizio», che e' un'altra cosa da «non lo so».
 *
 * Il DOM si costruisce con createElement e textContent, mai con innerHTML:
 * nei riquadri finiscono nomi di modello che arrivano dai log dei CLI, cioe'
 * da fuori. La CSP e' la rete di sicurezza, non il primo presidio.
 *
 * Espone il globale `AisessUsageBar`; sotto Node esporta lo stesso oggetto,
 * per poterlo provare su un DOM finto.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessUsageBar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const EMPTY = '—';
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;

  /** 1.234 -> "1.2K", 1.234.567 -> "1.2M": la barra e' alta una riga. */
  function formatTokens(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '0';
    if (v < 1000) return String(Math.round(v));
    if (v < 1_000_000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  /** Quota in percento, da una frazione 0..1. */
  function formatPercent(ratio) {
    if (ratio === null || ratio === undefined) return '';
    const v = Number(ratio);
    if (!Number.isFinite(v)) return '';
    return Math.round(Math.min(1, Math.max(0, v)) * 100) + '%';
  }

  function two(n) {
    return String(n).padStart(2, '0');
  }

  /** Ora del reset, nel fuso locale. */
  function formatClock(ts) {
    if (!Number.isFinite(Number(ts))) return '';
    const d = new Date(Number(ts));
    return `${two(d.getHours())}:${two(d.getMinutes())}`;
  }

  /**
   * Quanto manca al reset della finestra di 5 ore: "reset fra 1h 12m".
   * Non si arrotonda all'ora come formatDelta: su una finestra di 5 ore il
   * minuto e' proprio il dato che interessa.
   */
  function formatReset(ms) {
    const v = Number(ms);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v < MINUTE_MS) return 'reset fra <1m';
    const minuti = Math.floor(v / MINUTE_MS);
    const ore = Math.floor(minuti / 60);
    return ore ? `reset fra ${ore}h ${minuti % 60}m` : `reset fra ${minuti}m`;
  }

  /**
   * Quanto manca, per finestre lunghe: "fra 3 g", "fra 5 h", "fra 20 min".
   * Un'ora esatta di orologio non direbbe niente su una finestra settimanale.
   */
  function formatDelta(ms) {
    const v = Number(ms);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v >= DAY_MS) return `fra ${Math.round(v / DAY_MS)} g`;
    if (v >= HOUR_MS) return `fra ${Math.round(v / HOUR_MS)} h`;
    return `fra ${Math.max(1, Math.round(v / MINUTE_MS))} min`;
  }

  /**
   * Quanto e' pieno il contesto dell'ultimo scambio, da 0 a 1.
   * Senza contesto noto (modello fuori tabella, o totali aggregati) vale null:
   * la barra si nasconde invece di mostrare un avanzamento inventato.
   */
  function contextProgress(session) {
    const ctx = session && session.context;
    if (!ctx || !Number.isFinite(Number(ctx.ratio))) return null;
    return Math.min(1, Math.max(0, Number(ctx.ratio)));
  }

  /**
   * Quanto e' piena la finestra di 5 ore in token, da 0 a 1.
   * Il conto lo fa lib/usage (quota dichiarata dal CLI, o tetto calibrato sul
   * massimo osservato): qui si disegna e basta. `null` = nessun tetto ancora,
   * e la barra sparisce invece di mostrare uno zero che sembrerebbe "vuoto".
   */
  function blockProgress(block) {
    // `Number(null)` vale 0: senza questo controllo un tetto mancante
    // diventerebbe uno 0% che si legge come "finestra ancora vuota".
    if (!block || block.ratio === null || block.ratio === undefined) return null;
    if (!Number.isFinite(Number(block.ratio))) return null;
    return Math.min(1, Math.max(0, Number(block.ratio)));
  }

  /** Quota dichiarata dal CLI per una finestra, da 0 a 1, o null. */
  function declaredProgress(window) {
    if (!window || !Number.isFinite(Number(window.usedPercent))) return null;
    return Math.min(1, Math.max(0, Number(window.usedPercent) / 100));
  }

  /** Conteggio token per il tooltip: fuori dal testo, ma non buttato via. */
  function tokensLine(totals) {
    return `${formatTokens(totals && totals.total)} token`;
  }

  /** Dettaglio per il tooltip: una riga per agente, piu' le sorgenti mancanti. */
  function detailText(snapshot) {
    if (!snapshot) return '';
    const bySource = snapshot.bySource || {};
    const righe = Object.keys(bySource).sort()
      .map((name) => `${name}: ${formatTokens(bySource[name].total)} tok`);
    const sources = snapshot.sources || {};
    const problemi = Object.keys(sources).sort()
      .filter((name) => !sources[name].ok)
      .map((name) => `${name}: ${sources[name].error || 'non disponibile'}`);
    return [...righe, ...(problemi.length ? ['', ...problemi] : [])].join('\n')
      || 'Nessun consumo registrato in questa settimana.';
  }

  /**
   * Un riquadro: etichetta, valore e (se richiesto) barra di avanzamento.
   * @param {boolean} withBar
   */
  function cell(document, root, label, withBar, withSub) {
    const box = document.createElement('div');
    box.className = 'usage-cell';
    const lab = document.createElement('span');
    lab.className = 'usage-label';
    lab.textContent = label;
    const val = document.createElement('span');
    val.className = 'usage-value';
    val.textContent = EMPTY;
    box.appendChild(lab);
    box.appendChild(val);
    let bar = null;
    let fill = null;
    if (withBar) {
      bar = document.createElement('span');
      bar.className = 'usage-progress';
      fill = document.createElement('i');
      fill.className = 'usage-progress-fill';
      bar.appendChild(fill);
      box.appendChild(bar);
    }
    let sub = null;
    if (withSub) {
      sub = document.createElement('span');
      sub.className = 'usage-sub';
      sub.textContent = '';
      box.appendChild(sub);
    }
    root.appendChild(box);
    return { box, val, bar, fill, sub };
  }

  /** Riga secondaria; stringa vuota la nasconde. */
  function setSub(c, text) {
    if (!c || !c.sub) return;
    c.sub.textContent = text || '';
    c.sub.style.display = text ? '' : 'none';
  }

  /** Larghezza della barra; `null` la nasconde (nessun dato, non "zero"). */
  function setProgress(c, ratio) {
    if (!c || !c.fill) return;
    c.bar.style.display = ratio === null ? 'none' : '';
    c.fill.style.width = ratio === null ? '0%' : formatPercent(ratio);
  }

  /* I tre riquadri dicono una cosa sola: quanto e' pieno. Il conteggio dei
     token non entra nel testo — e' un numero senza scala («8.4M» e' tanto o
     poco?), mentre la percentuale e la barra rispondono subito. I dettagli
     (token per agente, ora del reset, quale quota si sta disegnando) restano
     nel tooltip, dove chi vuole li cerca. */

  /** Testo del riquadro SESSIONE: quanto e' pieno il contesto. */
  function sessionText(session) {
    const ratio = contextProgress(session);
    return ratio === null ? EMPTY : formatPercent(ratio);
  }

  /** Testo del riquadro FINESTRA 5h: quanto e' pieno, in token. */
  function blockText(block) {
    const ratio = blockProgress(block);
    return ratio === null ? EMPTY : formatPercent(ratio);
  }

  /** Riga secondaria del riquadro FINESTRA 5h: di chi parla e quando si azzera. */
  function blockSub(block) {
    if (!block) return '';
    const reset = formatReset(block.resetsIn);
    return [block.source, reset].filter(Boolean).join(' · ');
  }

  /** Data corta del massimo osservato, per il tooltip: "19/09". */
  function formatDay(ts) {
    if (!Number.isFinite(Number(ts))) return '';
    const d = new Date(Number(ts));
    return `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
  }

  /**
   * Tooltip del riquadro FINESTRA 5h. Dice sempre **da dove viene il numero**:
   * una stima calibrata sul proprio uso e una quota dichiarata dal fornitore
   * si leggono uguali, ma non valgono uguale.
   */
  function blockTitle(block, snapshot) {
    if (!block || !block.active) {
      return 'Nessuna attivita\' nelle ultime 5 ore: la prossima richiesta apre una finestra nuova.';
    }
    const chi = block.source ? `${block.source}: ` : '';
    const quando = `Finestra aperta alle ${formatClock(block.start)}, si azzera alle ${formatClock(block.resetsAt || block.end)}.`;
    const dettaglio = `\n\n${detailText(snapshot)}`;
    if (block.limitKind === 'declared') {
      return `${chi}quota dichiarata dal CLI.\n${tokensLine(block.totals)} in questa finestra.\n${quando}${dettaglio}`;
    }
    if (block.limitKind === 'calibrated') {
      const visto = formatDay(block.peakObservedAt);
      const oltre = block.overPeak ? '\nSei oltre il massimo osservato: la barra resta piena.' : '';
      return `${chi}${tokensLine(block.totals)} sul massimo osservato di ${formatTokens(block.limit)}`
        + `${visto ? ` (${visto})` : ''}.\nStima calibrata sul tuo uso, non una quota del fornitore.${oltre}\n${quando}${dettaglio}`;
    }
    return `${chi}${tokensLine(block.totals)} in questa finestra, senza percentuale: il tetto si calibra`
      + ` sulla prima finestra di 5 ore conclusa, e non ce n'e' ancora una.\n${quando}${dettaglio}`;
  }

  /** Testo del riquadro SETTIMANA: solo se un CLI dichiara la quota. */
  function weekText(declared) {
    const ratio = declaredProgress(declared);
    return ratio === null ? EMPTY : formatPercent(ratio);
  }

  const SEP_RE = /[\\/]+/;

  /** Ultima cartella di un percorso, Unix o Windows: "/r/app/" -> "app". */
  function baseName(p) {
    const parts = String(p || '').split(SEP_RE).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  /**
   * Che cosa dire nel riquadro "dove sono": la cartella del progetto (la
   * radice del repository se nota, altrimenti la cartella di lavoro) e il
   * nome della chat, cioè quello della scheda in primo piano.
   * @param {{name?: string, cwd?: string, projectRoot?: string|null}|null} tab
   * @returns {{folder: string, name: string, title: string}|null}
   */
  function currentChat(tab) {
    if (!tab) return null;
    const name = String(tab.name || '');
    const folder = baseName(tab.projectRoot || tab.cwd);
    return { folder, name, title: [name, tab.cwd].filter(Boolean).join('\n') };
  }

  /** Il riquadro "dove sono": cartella smorzata, nome della chat in chiaro. */
  function currentCell(document, root) {
    const box = document.createElement('div');
    box.className = 'usage-current';
    const folder = document.createElement('span');
    folder.className = 'usage-current-folder';
    const name = document.createElement('span');
    name.className = 'usage-current-name';
    box.appendChild(folder);
    box.appendChild(name);
    box.hidden = true;
    root.appendChild(box);
    return { box, folder, name };
  }

  /**
   * Costruisce la barra dentro `root` e restituisce l'oggetto per aggiornarla.
   * @param {{ root: object, document?: object }} deps
   */
  function createUsageBar({ root, document: doc = (typeof document !== 'undefined' ? document : null) }) {
    if (!root || !doc) throw new Error('createUsageBar: servono root e document');
    root.innerHTML = '';
    const current = currentCell(doc, root);
    const session = cell(doc, root, 'SESSIONE', true);
    const block = cell(doc, root, 'FINESTRA 5h', true, true);
    const week = cell(doc, root, 'SETTIMANA', true);
    const cells = [session, block, week];

    /** @param {object|null} snapshot quello che restituisce collectUsage() */
    function update(snapshot) {
      if (!snapshot) {
        for (const c of cells) {
          c.val.textContent = EMPTY;
          setProgress(c, null);
          setSub(c, '');
        }
        root.title = 'Dati d\'uso non disponibili.';
        return;
      }
      const limits = snapshot.rateLimits || {};

      const ctx = snapshot.session && snapshot.session.context;
      session.val.textContent = sessionText(snapshot.session);
      setProgress(session, contextProgress(snapshot.session));
      session.box.title = !snapshot.session
        ? 'La scheda in primo piano non e\' una conversazione riconosciuta (shell, o conversazione non ancora abbinata a un log).'
        : ctx
          ? `Contesto dell'ultimo scambio: ${formatTokens(ctx.tokens)} dei ${formatTokens(ctx.limit)} token di ${ctx.model}.\nQuando si riempie, la conversazione va compattata o ripartita.\n${tokensLine(snapshot.session)} spesi in tutta la sessione.`
          : `Contesto non calcolabile: modello fuori tabella o totali gia aggregati.\n${tokensLine(snapshot.session)} spesi in questa sessione.`;

      const b = snapshot.block || {};
      block.val.textContent = blockText(b);
      setProgress(block, blockProgress(b));
      setSub(block, blockSub(b));
      block.box.title = blockTitle(b, snapshot);

      const w = snapshot.week || {};
      const resetSettimana = limits.weekly ? formatDelta(Number(limits.weekly.resetsAt) - Number(w.now)) : '';
      week.val.textContent = weekText(limits.weekly);
      setProgress(week, declaredProgress(limits.weekly));
      week.box.title = limits.weekly
        ? `Quota settimanale dichiarata dal CLI${resetSettimana ? `, reset ${resetSettimana}` : ''}.\n${tokensLine(w.totals)} negli ultimi 7 giorni.\n\n${detailText(snapshot)}`
        : `Nessun CLI dichiara il limite settimanale: ${tokensLine(w.totals)} negli ultimi 7 giorni, senza percentuale da mostrare.\n\n${detailText(snapshot)}`;
      root.title = '';
    }

    /** @param {object|null} tab la scheda in primo piano, o null se non ce n'è */
    function setCurrent(tab) {
      const info = currentChat(tab);
      current.box.hidden = !info;
      current.folder.textContent = info ? info.folder : '';
      current.name.textContent = info ? info.name : '';
      current.box.title = info ? info.title : '';
    }

    return { update, setCurrent, elements: { current, session, block, week } };
  }

  return {
    createUsageBar, currentChat, formatTokens, formatPercent, formatClock, formatDelta, formatReset,
    blockProgress, contextProgress, declaredProgress,
    sessionText, blockText, blockSub, blockTitle, weekText, detailText, tokensLine, EMPTY,
  };
});
