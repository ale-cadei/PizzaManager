/* La schermata vuota: quello che si vede quando non c'è nessuna sessione
 * aperta, cioè sempre al primo avvio (docs/plans/20-onboarding.md).
 *
 * Qui si dice che cosa manca per usare l'app: il resoconto lo calcola
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
  function setupRow(doc, tool, onCopy, extraNote) {
    const row = el(doc, 'li', `setup-row ${tool.found ? 'is-ok' : 'is-missing'}`);
    row.appendChild(el(doc, 'span', 'setup-mark', tool.found ? '✔' : '✘'));
    row.appendChild(el(doc, 'span', 'setup-name', tool.label));
    const detail = el(doc, 'span', 'setup-detail');
    if (tool.found) {
      detail.appendChild(el(doc, 'span', 'setup-path', tool.path || ''));
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
  function setupSection(doc, report, { onCopy, onRecheck }) {
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
      list.appendChild(setupRow(doc, tool, onCopy, extra));
    }
    box.appendChild(list);
    const recheck = el(doc, 'button', 'btn btn--outline setup-recheck', 'Ricontrolla');
    recheck.type = 'button';
    recheck.onclick = () => onRecheck();
    box.appendChild(recheck);
    return box;
  }

  /**
   * @param {{root: object, document?: object,
   *   onCopy: (text: string) => void, onRecheck: () => void}} deps
   */
  function createWelcome(deps) {
    const doc = deps.document || (typeof document !== 'undefined' ? document : null);
    const { root } = deps;
    if (!root || !doc) throw new Error('createWelcome: servono root e document');
    const handlers = {
      onCopy: typeof deps.onCopy === 'function' ? deps.onCopy : () => {},
      onRecheck: typeof deps.onRecheck === 'function' ? deps.onRecheck : () => {},
    };

    /** Ridisegna la schermata per il resoconto dato (null: non ancora noto). */
    function update(report) {
      root.innerHTML = '';
      const box = el(doc, 'div', 'welcome');
      box.appendChild(el(doc, 'p', 'muted welcome-empty', 'Nessuna sessione aperta — usa la sidebar a sinistra per avviarne una o fare resume.'));
      const setup = setupSection(doc, report, handlers);
      if (setup) box.appendChild(setup);
      root.appendChild(box);
    }

    return { update };
  }

  return { createWelcome, copyTarget };
});
