/* Il fumetto di conferma che esce da una card.
 *
 * Chiudere una sessione termina il processo: è irreversibile, quindi si chiede.
 * Ma un modale che oscura la finestra per una domanda da due parole è troppo, e
 * `confirm()` del browser apre una finestra di sistema che non ha niente a che
 * fare con lo stile dell'app. Il fumetto esce dalla card e la indica con la
 * punta: si vede DI QUALE sessione si sta parlando senza doverne rileggere il
 * nome.
 *
 * Il calcolo di dove metterlo (`place`) è separato e puro: è la parte che può
 * sbagliare in silenzio (fumetto fuori dallo schermo, punta staccata dalla
 * card) ed è quella che i test possono verificare senza un browser.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina e module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessConfirmBubble = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Spazio fra la card e il fumetto: ci sta dentro la punta. */
  const GAP = 12;
  /** Quanto il fumetto sta lontano dai bordi della finestra. */
  const MARGIN = 8;
  /** La punta non arriva mai agli spigoli, o sporgerebbe dall'arrotondamento. */
  const TIP_INSET = 16;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  /**
   * Dove va il fumetto e dove va la sua punta, in coordinate di finestra
   * (`position: fixed`: il fumetto sta nel body, non dentro la sidebar, che ha
   * `overflow-y: auto` e lo ritaglierebbe).
   *
   * @param {{anchor: {left: number, top: number, width: number, height: number, right?: number},
   *   size: {width: number, height: number},
   *   viewport: {width: number, height: number}}} o
   * @returns {{left: number, top: number, side: 'left'|'right', tip: number}}
   *   `tip` è la distanza della punta dal bordo alto del fumetto.
   */
  function place({ anchor, size, viewport }) {
    const right = anchor.right === undefined ? anchor.left + anchor.width : anchor.right;
    // A destra della card se ci sta: la sidebar è a sinistra, e il fumetto va
    // verso il terminale, non verso il bordo della finestra.
    const staADestra = right + GAP + size.width + MARGIN <= viewport.width;
    const side = staADestra ? 'right' : 'left';
    const grezzo = side === 'right' ? right + GAP : anchor.left - GAP - size.width;
    const left = clamp(grezzo, MARGIN, Math.max(MARGIN, viewport.width - MARGIN - size.width));

    const centro = anchor.top + anchor.height / 2;
    const top = clamp(centro - size.height / 2, MARGIN,
      Math.max(MARGIN, viewport.height - MARGIN - size.height));
    // La punta insegue il centro della card anche quando il fumetto è stato
    // spostato per restare dentro la finestra: è l'unica cosa che dice a chi
    // guarda quale sessione sta per chiudere.
    const tip = clamp(centro - top, TIP_INSET, Math.max(TIP_INSET, size.height - TIP_INSET));
    return { left, top, side, tip };
  }

  /**
   * @param {{doc?: Document, host?: Element, win?: Window,
   *   viewport?: () => {width: number, height: number}}} [deps]
   */
  function createConfirmBubble(deps = {}) {
    const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
    const win = deps.win !== undefined ? deps.win : (typeof window !== 'undefined' ? window : null);
    const viewport = deps.viewport || (() => ({
      width: win ? win.innerWidth : 0,
      height: win ? win.innerHeight : 0,
    }));

    /** Domanda aperta: ce n'è al massimo una. */
    let open = null;

    /** L'elemento sta dentro `box`? (niente `contains`: deve girare anche nei test) */
    function inside(node, box) {
      for (let n = node; n; n = n.parentNode) if (n === box) return true;
      return false;
    }

    /** Rimette il fumetto accanto alla sua card e gli fa ripuntare la punta. */
    function pointAt(anchor) {
      if (!open) return;
      const { el, tip } = open;
      const box = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      const size = { width: box.width || 260, height: box.height || 132 };
      const pos = place({ anchor: anchor.getBoundingClientRect(), size, viewport: viewport() });
      el.classList.remove('side-left', 'side-right');
      el.classList.add(`side-${pos.side}`);
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      tip.style.top = `${pos.tip}px`;
    }

    function settle(answer) {
      if (!open) return;
      const { el, resolve, onKey, onDown, onMove } = open;
      open = null;
      if (onKey) doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('mousedown', onDown, true);
      if (win) {
        win.removeEventListener('resize', onMove);
        doc.removeEventListener('scroll', onMove, true);
      }
      el.remove();
      resolve(answer);
    }

    /**
     * Mette il fumetto nella pagina accanto ad `anchor` e lo fa chiudere (con
     * risposta `false`) dal click fuori, dallo scroll e dal resize; con
     * `closeOnEscape` anche da Esc. Restituisce la risposta.
     */
    function mount({ el, tip, anchor, key, closeOnEscape }) {
      const host = deps.host || doc.body;
      host.appendChild(el);

      const onKey = closeOnEscape ? (e) => {
        if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); settle(false); }
      } : null;
      // mousedown e non click: chi va a cliccare altrove ha già deciso che non
      // vuole rispondere, e il click finirebbe su un bersaglio che nel
      // frattempo si è spostato.
      const onDown = (e) => { if (!inside(e.target, el)) settle(false); };
      // Il fumetto è ancorato a coordinate di finestra: se la lista scorre o la
      // finestra cambia misura, la punta non indica più niente.
      const onMove = () => settle(false);

      if (onKey) doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('mousedown', onDown, true);
      if (win) {
        win.addEventListener('resize', onMove);
        doc.addEventListener('scroll', onMove, true);
      }

      const answer = new Promise((resolve) => {
        open = { el, tip, key, resolve, onKey, onDown, onMove };
      });
      pointAt(anchor);
      return answer;
    }

    function label(el, cls, text) {
      const p = doc.createElement('p');
      p.className = cls;
      p.textContent = text; // testo, mai HTML: il nome lo scrive l'utente
      el.appendChild(p);
      return p;
    }

    /**
     * @param {{anchor: Element, name: string, detachable?: boolean, key?: string}} o
     *   `key` identifica la cosa a cui il fumetto è appeso (l'id della
     *   sessione): serve a ritrovarne la card dopo un render.
     * @returns {Promise<boolean>} true se l'utente conferma
     */
    function ask({ anchor, name, detachable = false, key = null }) {
      // Una domanda per volta: la precedente decade come se fosse stata annullata.
      settle(false);
      const el = doc.createElement('div');
      el.className = 'confirm-bubble';
      el.setAttribute('role', 'dialog');
      el.setAttribute('tabindex', '-1');
      const tip = doc.createElement('span');
      tip.className = 'confirm-bubble-tip';
      el.appendChild(tip);
      label(el, 'confirm-bubble-title', `Chiudere «${name}»?`);
      label(el, 'confirm-bubble-text', detachable
        ? 'Il processo viene terminato: non potrai più riattaccarti a questa sessione.'
        : 'Il processo in corso viene terminato.');

      const actions = doc.createElement('div');
      actions.className = 'confirm-bubble-actions';
      const no = doc.createElement('button');
      no.className = 'btn btn--ghost confirm-no';
      no.textContent = 'Annulla';
      const yes = doc.createElement('button');
      yes.className = 'btn btn--primary confirm-yes';
      yes.textContent = 'Chiudi';
      actions.appendChild(no);
      actions.appendChild(yes);
      el.appendChild(actions);

      const answer = mount({ el, tip, anchor, key, closeOnEscape: true });
      no.onclick = (e) => { e.stopPropagation(); settle(false); };
      yes.onclick = (e) => { e.stopPropagation(); settle(true); };
      // Il fuoco sul fumetto, non su un pulsante: da lì Tab porta prima ad
      // «Annulla» e poi a «Chiudi», e un Invio battuto per abitudine non
      // termina niente. Sul pulsante si vedrebbe anche l'anello di fuoco
      // pomodoro, che in un fumetto con un pulsante pieno pomodoro fa due
      // cose che gridano insieme.
      if (typeof el.focus === 'function') el.focus();
      return answer;
    }

    /**
     * Un suggerimento: stesso fumetto, un solo pulsante («Capito»). Compare
     * mentre si lavora, quindi NON prende il fuoco e NON intercetta Esc: chi
     * sta scrivendo nel terminale non deve perdere tasti, ed Esc agli agenti
     * serve per interrompere. Lo chiudono il pulsante, il click fuori, lo
     * scroll e il resize.
     * @param {{anchor: Element, title: string, text: string, key?: string}} o
     * @returns {Promise<boolean>} true se chiuso con «Capito»
     */
    function tell({ anchor, title, text, key = null }) {
      settle(false);
      const el = doc.createElement('div');
      el.className = 'confirm-bubble is-hint';
      el.setAttribute('role', 'status');
      const tip = doc.createElement('span');
      tip.className = 'confirm-bubble-tip';
      el.appendChild(tip);
      label(el, 'confirm-bubble-title', title);
      label(el, 'confirm-bubble-text', text);
      const actions = doc.createElement('div');
      actions.className = 'confirm-bubble-actions';
      const ok = doc.createElement('button');
      ok.className = 'btn btn--ghost confirm-ok';
      ok.textContent = 'Capito';
      actions.appendChild(ok);
      el.appendChild(actions);
      const answer = mount({ el, tip, anchor, key, closeOnEscape: false });
      ok.onclick = (e) => { e.stopPropagation(); settle(true); };
      return answer;
    }

    /**
     * Dopo un render la card a cui il fumetto era appeso è un elemento nuovo:
     * il fumetto va rimesso su quella nuova, non fatto sparire (un render
     * capita per motivi che con la domanda non c'entrano — un titolo che
     * cambia, un agente che finisce il turno). Se la card non c'è più, la
     * domanda decade: la sessione non è più lì da chiudere.
     * @param {(key: string) => (Element|null)} findAnchor
     */
    function retarget(findAnchor) {
      if (!open) return;
      if (open.key === null) return settle(false);
      const anchor = findAnchor(open.key);
      if (!anchor) return settle(false);
      pointAt(anchor);
    }

    return { ask, tell, retarget, close: () => settle(false), isOpen: () => Boolean(open) };
  }

  return { place, createConfirmBubble, GAP, MARGIN, TIP_INSET };
});
