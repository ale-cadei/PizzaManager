/* La schermata vuota: quello che si vede quando non c'è nessuna sessione
 * aperta, cioè sempre al primo avvio (docs/plans/20-onboarding.md).
 *
 * È il posto giusto per le cose che guardando l'app non si scoprono: si vede
 * proprio quando serve e sparisce da sola alla prima sessione, senza un tour
 * da saltare.
 *
 * Qui si dice anche che cosa manca per usare l'app: il resoconto lo calcola
 * lib/setup-check.js nel main, questo modulo lo disegna. Un comando mancante
 * ha il suo «Copia»; niente link cliccabili, perché dentro Electron
 * aprirebbero la pagina nella finestra dell'app al posto dei terminali.
 *
 * Il DOM si costruisce con createElement e textContent: percorsi e nomi
 * arrivano da fuori (il filesystem dell'utente).
 *
 * Wrapper UMD come usage-bar.js: globale `AisessWelcome` nella pagina,
 * module.exports sotto Node per provarlo sul DOM finto. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessWelcome = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Quanto resta scritto «Copiato» sul pulsante dopo il click. */
  const COPIED_MS = 1500;

  function el(doc, tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /** Il valore da copiare per uno strumento mancante: il comando, o l'indirizzo. */
  function copyTarget(install) {
    return (install && (install.command || install.url)) || '';
  }

  /**
   * Una riga dello strumento: segno, nome, e il dettaglio — il percorso se
   * c'è, altrimenti come installarlo.
   * @param {{label: string, found: boolean, path?: string|null,
   *   install?: {command?: string|null, url?: string, note?: string}}} tool
   */
  function setupRow(doc, tool, { onCopy, onRestart }, extraNote) {
    // `pending`: installato ad app aperta (solo tmux), manca il riavvio
    const state = tool.found ? 'is-ok' : tool.pending ? 'is-pending' : 'is-missing';
    const row = el(doc, 'li', `setup-row ${state}`);
    row.appendChild(el(doc, 'span', 'setup-mark', tool.found ? '✔' : tool.pending ? '↻' : '✘'));
    row.appendChild(el(doc, 'span', 'setup-name', tool.label));
    const detail = el(doc, 'span', 'setup-detail');
    if (tool.found) {
      detail.appendChild(el(doc, 'span', 'setup-path', tool.path || ''));
    } else if (tool.pending) {
      detail.appendChild(el(doc, 'span', 'setup-path', tool.path || ''));
      // Riavviare è sicuro: questa schermata c'è solo senza sessioni aperte
      const restart = el(doc, 'button', 'btn btn--ghost setup-restart', 'Riavvia ora');
      restart.type = 'button';
      restart.onclick = () => onRestart();
      detail.appendChild(restart);
      if (extraNote) detail.appendChild(el(doc, 'span', 'setup-note', extraNote));
    } else {
      const target = copyTarget(tool.install);
      if (target) {
        detail.appendChild(el(doc, 'code', 'setup-command', target));
        const copy = el(doc, 'button', 'btn btn--ghost setup-copy', 'Copia');
        copy.type = 'button';
        copy.onclick = () => {
          onCopy(target);
          // Gli appunti non si vedono: senza una conferma si clicca due volte
          copy.textContent = 'Copiato ✔';
          setTimeout(() => { copy.textContent = 'Copia'; }, COPIED_MS);
        };
        detail.appendChild(copy);
      }
      const note = [tool.install && tool.install.note, extraNote].filter(Boolean).join(' ');
      if (note) detail.appendChild(el(doc, 'span', 'setup-note', note));
    }
    row.appendChild(detail);
    return row;
  }

  /**
   * La sezione «Strumenti». Vuota se non manca niente: a installazione
   * completa cinque spunte verdi sarebbero rumore ogni volta che si chiude
   * l'ultima sessione.
   * @param {object|null} report quello di lib/setup-check.js#setupReport
   */
  function setupSection(doc, report, { onCopy, onRecheck, onRestart }) {
    if (!report || report.complete) return null;
    const box = el(doc, 'section', 'setup');
    box.appendChild(el(doc, 'h3', 'welcome-heading', 'Strumenti'));
    box.appendChild(el(doc, 'p', 'setup-lead', report.ready
      ? 'Puoi già cominciare. Quelli con ✘ mancano, se ti servono:'
      : 'Per cominciare installa almeno un assistente, poi premi «Ricontrolla».'));
    const list = el(doc, 'ul', 'setup-list');
    const tools = [...report.agents];
    if (report.tmux) tools.push({ label: 'tmux', ...report.tmux });
    // Anche i presenti: accanto ai mancanti dicono a che punto si è.
    for (const tool of tools) {
      const extra = tool.label === 'tmux' ? report.tmux.note : '';
      list.appendChild(setupRow(doc, tool, { onCopy, onRestart }, extra));
    }
    box.appendChild(list);
    const recheck = el(doc, 'button', 'btn btn--outline setup-recheck', 'Ricontrolla');
    recheck.type = 'button';
    recheck.onclick = () => onRecheck();
    box.appendChild(recheck);
    return box;
  }

  /**
   * Le cose da sapere. Quella su tmux solo se tmux c'è: senza, le sessioni
   * muoiono con la finestra e prometterlo sarebbe falso.
   * @param {object|null} report
   * @returns {string[]}
   */
  function tips(report) {
    const withTmux = Boolean(report && report.tmux && report.tmux.found);
    return [
      'Doppio click su una chat per rinominarla.',
      'Trascina le chat per riordinarle; in modalità Progetto anche le cartelle, per la linguetta. L\'ordine resta dopo la chiusura.',
      'In modalità Progetto il «+» accanto alla cartella apre una nuova sessione lì.',
      withTmux ? 'Chiudere l\'app non chiude le sessioni: restano vive e tornano alla riapertura. Per terminarle davvero c\'è la ✕ sulla chat.' : null,
      '⟲ Resume riprende una conversazione passata, di qualunque assistente.',
      'La barra in basso dice in che chat sei, quanto è pieno il suo contesto e quanto resta della finestra di 5 ore e della settimana.',
    ].filter(Boolean);
  }

  function tipsSection(doc, report) {
    const box = el(doc, 'section', 'tips');
    box.appendChild(el(doc, 'h3', 'welcome-heading', 'Da sapere'));
    const list = el(doc, 'ul', 'tips-list');
    for (const t of tips(report)) list.appendChild(el(doc, 'li', 'tip', t));
    box.appendChild(list);
    return box;
  }

  function actionsRow(doc, { onNew, onResume }) {
    const row = el(doc, 'div', 'welcome-actions');
    const make = (cls, glyph, label, fn) => {
      const b = el(doc, 'button', `btn ${cls}`);
      b.type = 'button';
      b.appendChild(el(doc, 'span', 'btn-glyph', glyph));
      b.appendChild(el(doc, 'span', 'btn-label', label));
      b.onclick = () => fn();
      return b;
    };
    row.appendChild(make('btn--outline welcome-new', '+', 'Nuova sessione', onNew));
    row.appendChild(make('btn--ghost welcome-resume', '⟲', 'Resume', onResume));
    return row;
  }

  /**
   * @param {{root: object, document?: object,
   *   onCopy: (text: string) => void, onRecheck: () => void,
   *   onRestart?: () => void, onNew?: () => void, onResume?: () => void}} deps
   */
  function createWelcome(deps) {
    const doc = deps.document || (typeof document !== 'undefined' ? document : null);
    const { root } = deps;
    if (!root || !doc) throw new Error('createWelcome: servono root e document');
    const handlers = {
      onCopy: typeof deps.onCopy === 'function' ? deps.onCopy : () => {},
      onRecheck: typeof deps.onRecheck === 'function' ? deps.onRecheck : () => {},
      onRestart: typeof deps.onRestart === 'function' ? deps.onRestart : () => {},
      onNew: typeof deps.onNew === 'function' ? deps.onNew : () => {},
      onResume: typeof deps.onResume === 'function' ? deps.onResume : () => {},
    };

    /** Ridisegna la schermata per il resoconto dato (null: non ancora noto). */
    function update(report) {
      root.innerHTML = '';
      const box = el(doc, 'div', 'welcome');
      box.appendChild(el(doc, 'p', 'muted welcome-empty', 'Nessuna sessione aperta.'));
      box.appendChild(actionsRow(doc, handlers));
      const setup = setupSection(doc, report, handlers);
      if (setup) box.appendChild(setup);
      box.appendChild(tipsSection(doc, report));
      root.appendChild(box);
    }

    return { update };
  }

  return { createWelcome, copyTarget, tips };
});
