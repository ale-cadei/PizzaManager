/* La sidebar delle sessioni aperte: gruppi collassabili, card, selettore della
 * modalità di raggruppamento.
 *
 * Il modulo non conosce lo stato delle schede: riceve la lista e la scheda
 * attiva a ogni render, e restituisce le azioni come callback (onSelect,
 * onClose, onRename). È questo che rompe la dipendenza circolare con
 * renderer.js, che resta il proprietario di `tabs` e `activeId`.
 *
 * Wrapper UMD come session-groups.js: globale nella pagina (il renderer non ha
 * require) e module.exports sotto Node, per poterlo leggere dai test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessSidebar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const GROUP_MODES = ['type', 'project'];
  const COLLAPSED_GROUPS_KEY = 'aisess.collapsedGroups';
  const COLLAPSED_PROJECTS_KEY = 'aisess.collapsedProjects';
  const GROUP_MODE_KEY = 'aisess.groupMode';
  /* Soglia del doppio click sulle card, tenuta fuori dal DOM perché le card
     vengono ricreate a ogni render. */
  const DOUBLE_CLICK_MS = 450;
  /* Finestra in cui un click che segue un trascinamento viene ignorato. */
  const DRAG_CLICK_GUARD_MS = 250;

  /**
   * Quanti fogli spuntano sotto la linguetta di un gruppo COLLASSATO, cioè il
   * suo spessore. Aperto non ce n'è nessuno: le sessioni si vedono già, e i
   * fogli sarebbero una decorazione che ripete quello che il pannello dice.
   * Chiuso invece sono l'unica traccia di che cosa c'è dentro: una o due
   * sessioni un foglio, tre o più due fogli. Mai tre, il fondo diventerebbe
   * una frangia.
   * @param {number} n sessioni nel gruppo
   * @param {boolean} collapsed
   * @returns {0|1|2}
   */
  function sheetCount(n, collapsed) {
    if (!n || !collapsed) return 0;
    return n < 3 ? 1 : 2;
  }

  function readSet(storage, key) {
    try {
      const saved = JSON.parse(storage.getItem(key) || '[]');
      if (Array.isArray(saved)) return new Set(saved.filter((k) => typeof k === 'string'));
    } catch {}
    return new Set();
  }

  function writeSet(storage, key, set) {
    try { storage.setItem(key, JSON.stringify([...set])); } catch {}
  }

  /**
   * @param {{list: Element, count: Element, storage: Storage, Icons: object,
   *   Slice: {markup: () => string},
   *   Groups: object, Commands: object, escapeHtml: (s: string) => string,
   *   modeButtons?: {type: Element, project: Element},
   *   onSelect: (id: string) => void, onClose: (id: string) => void,
   *   onRename: (session: object) => void,
   *   canDetach?: (session: object) => boolean,
   *   onTerminate?: (id: string) => void,
   *   onNewInProject?: (projectRoot: string) => void,
   *   onReorder?: (movedId: string, targetId: string, opts: {before: boolean}) => void}} deps
   */
  function createSidebar(deps) {
    const { list, count, storage, Icons, Slice, Groups, escapeHtml, onSelect, onClose, onRename } = deps;
    const Commands = deps.Commands || null;
    const modeButtons = deps.modeButtons || {};
    const onReorder = typeof deps.onReorder === 'function' ? deps.onReorder : null;
    /* Se una sessione si possa staccare invece che chiudere dipende da tmux e
       dallo stato della scheda: sono cose del renderer, non della sidebar, che
       si limita a chiedere. Senza il predicato la ✕ chiude e basta, come prima
       di tmux. */
    const canDetach = typeof deps.canDetach === 'function' ? deps.canDetach : () => false;
    const onTerminate = typeof deps.onTerminate === 'function' ? deps.onTerminate : null;
    /* Creare una sessione è affare del renderer (dialog, tipo, account): la
       sidebar segnala solo in quale radice l'utente la vuole. */
    const onNewInProject = typeof deps.onNewInProject === 'function' ? deps.onNewInProject : null;

    /* Collassi in liste separate per modalità: collassare "Claude" e collassare
       "aisessionmanager" sono scelte diverse e nella stessa chiave
       interferirebbero. */
    const collapsedGroups = readSet(storage, COLLAPSED_GROUPS_KEY);
    const collapsedProjects = readSet(storage, COLLAPSED_PROJECTS_KEY);
    let groupMode = 'type';
    try {
      const saved = storage.getItem(GROUP_MODE_KEY);
      if (GROUP_MODES.includes(saved)) groupMode = saved;
    } catch {}

    let lastCardClick = { id: null, at: 0 };
    /* Card in corso di trascinamento e istante dell'ultimo drag concluso: il
       secondo serve a non far passare per "click" il rilascio del mouse. */
    let dragging = null;
    let dragEndedAt = 0;
    // Un render a meta' trascinamento distruggerebbe la card che si ha in mano
    // (list.innerHTML = ''): si rimanda a fine drag.
    let pendingRender = null;

    /** Insieme dei gruppi collassati della modalità corrente. */
    function collapsedSet() {
      return groupMode === 'project' ? collapsedProjects : collapsedGroups;
    }
    function saveCollapsed() {
      if (groupMode === 'project') writeSet(storage, COLLAPSED_PROJECTS_KEY, collapsedProjects);
      else writeSet(storage, COLLAPSED_GROUPS_KEY, collapsedGroups);
    }
    /** Chiave del gruppo a cui appartiene una scheda, nella modalità corrente. */
    function groupKeyFor(t) {
      return groupMode === 'project' ? (t.projectRoot || '') : t.type;
    }

    function getMode() { return groupMode; }

    function setMode(next) {
      if (!GROUP_MODES.includes(next) || next === groupMode) return false;
      groupMode = next;
      try { storage.setItem(GROUP_MODE_KEY, next); } catch {}
      updateModeButtons();
      return true;
    }

    function updateModeButtons() {
      for (const m of GROUP_MODES) {
        if (modeButtons[m]) modeButtons[m].setAttribute('aria-pressed', String(m === groupMode));
      }
    }

    /** Espande il gruppo di una scheda, così la sua card resta visibile. */
    function expandGroupOf(t) {
      if (!t) return false;
      const key = groupKeyFor(t);
      if (!collapsedSet().has(key)) return false;
      collapsedSet().delete(key);
      saveCollapsed();
      return true;
    }

    /* Trascinamento delle card. Si riordina SOLO dentro il gruppo: il gruppo di
       una sessione dipende dal suo tipo o dal suo progetto, non da dove sta
       nella lista, quindi trascinarla altrove non potrebbe essere onorato. Il
       drop fuori dal gruppo di partenza semplicemente non viene accettato
       (niente preventDefault → il cursore mostra "vietato").

       Riordino "vivo": mentre si trascina, la card presa in mano viene spostata
       DAVVERO nel DOM nel punto dove finirebbe, e li' fa da segnaposto (slot
       tratteggiato). Le altre card scorrono per fare spazio, animate con la
       tecnica FLIP. Il rilascio conferma quello che gia' si vede: l'ordine
       finale si legge dal DOM, non dal punto del cursore. */
    const isCard = (el) => el && el.classList && el.classList.contains('session-item');
    const cardsOf = (body) => [...body.children].filter(isCard);

    /** FLIP: le card che cambiano posto partono da dove erano e scivolano dove sono. */
    function shiftAnimated(body, move) {
      const cards = cardsOf(body);
      const before = new Map(cards.map((c) => [c, c.getBoundingClientRect().top]));
      move();
      if (typeof requestAnimationFrame !== 'function') return; // DOM finto nei test
      for (const c of cards) {
        if (c === dragging.el) continue;
        const delta = before.get(c) - c.getBoundingClientRect().top;
        if (!delta) continue;
        c.style.transition = 'none';
        c.style.transform = `translateY(${delta}px)`;
      }
      requestAnimationFrame(() => {
        for (const c of cards) { c.style.transition = ''; c.style.transform = ''; }
      });
    }

    /** Porta il segnaposto prima o dopo `target`, se non e' gia' li'. */
    function placeDragged(body, target, before) {
      const el = dragging.el;
      const ref = before ? target : target.nextElementSibling;
      if (ref === el || (el.nextElementSibling === ref && el.parentNode === body)) return;
      shiftAnimated(body, () => body.insertBefore(el, ref));
    }

    /** Ordine finale letto dal DOM. Nessun riordino se la card e' dove era partita. */
    function commitFromDom({ el, body, id, startIndex }) {
      const cards = cardsOf(body);
      const at = cards.indexOf(el);
      if (at < 0 || at === startIndex) return false;
      const next = cards[at + 1];
      const prev = cards[at - 1];
      if (next) onReorder(id, next.dataset.id, { before: true });
      else if (prev) onReorder(id, prev.dataset.id, { before: false });
      else return false;
      return true;
    }

    function endDrag() {
      const d = dragging;
      dragging = null;
      dragEndedAt = Date.now();
      d.el.classList.remove('dragging');
      d.body.classList.remove('reordering');
      const pend = pendingRender;
      pendingRender = null;
      // onReorder fa ridisegnare la sidebar con i dati aggiornati: il render
      // rimandato serve solo se non c'e' stato nessun riordino.
      const reordered = commitFromDom(d);
      if (!reordered && pend) render(...pend);
    }

    function attachDrag(b, t, groupKey, body) {
      if (!onReorder) return;
      b.draggable = true;
      b.dataset.id = t.id;
      b.addEventListener('dragstart', (e) => {
        dragging = { id: t.id, groupKey, el: b, body, startIndex: cardsOf(body).indexOf(b) };
        // L'immagine che segue il cursore viene fotografata subito dopo questo
        // handler: la classe che trasforma la card in segnaposto va messa al
        // frame dopo, altrimenti in mano si ha un rettangolo vuoto.
        const mark = () => { if (dragging && dragging.el === b) { b.classList.add('dragging'); body.classList.add('reordering'); } };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(mark); else mark();
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          // Alcuni browser non avviano il drag senza un payload
          try { e.dataTransfer.setData('text/plain', t.id); } catch {}
        }
      });
      b.addEventListener('dragend', () => { if (dragging) endDrag(); });
      const accepts = () => dragging && dragging.groupKey === groupKey && dragging.id !== t.id;
      b.addEventListener('dragover', (e) => {
        if (!accepts()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = b.getBoundingClientRect();
        placeDragged(body, b, e.clientY < rect.top + rect.height / 2);
      });
      b.addEventListener('drop', (e) => {
        if (!accepts()) return;
        e.preventDefault();
        e.stopPropagation();
        // L'ordine e' gia' quello che si vede: lo conferma dragend.
      });
    }

    /** Spazio vuoto sotto l'ultima card: trascinarci sopra manda la card in coda. */
    function attachBodyDrag(body, groupKey) {
      if (!onReorder) return;
      body.addEventListener('dragover', (e) => {
        if (!dragging || dragging.groupKey !== groupKey) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const cards = cardsOf(body);
        const last = cards[cards.length - 1];
        if (last && last !== dragging.el && e.clientY > last.getBoundingClientRect().bottom) placeDragged(body, last, false);
      });
      body.addEventListener('drop', (e) => {
        if (!dragging || dragging.groupKey !== groupKey) return;
        e.preventDefault();
      });
    }

    function createSessionItem(t, activeId, groupKey, body) {
      const b = document.createElement('button');
      const isActive = t.id === activeId;
      b.className = `session-item type-${t.type}` + (isActive ? ' active' : '') + (t.needsAttention ? ' needs-attention' : '');
      if (isActive) b.setAttribute('aria-current', 'true');
      if (t.needsAttention) b.title = 'L\'assistente ha finito: apri la sessione per vedere il risultato';
      // Il comando si mostra solo se per quel tipo ce n'è più di uno configurato
      const multiCommand = Commands && Commands.profilesFor(t.type).length > 1;
      const extras = [t.claudeAccountName, multiCommand ? t.commandProfileLabel : null].filter(Boolean);
      const fullSub = [t.cwd || '', ...extras].filter(Boolean).join(' · ');
      // In modalità progetto l'header del gruppo è già il path: ripeterlo sotto è
      // rumore. Al suo posto il tipo della sessione (che lì non è più nell'header)
      // e la sottocartella, se la sessione non sta nella radice del progetto.
      const displayParts = groupMode === 'project'
        ? [Groups.TYPE_LABELS[t.type] || t.type, Groups.relativeSubpath(t.cwd, t.projectRoot), ...extras]
        : [Groups.shortPath(t.cwd), ...extras];
      const displaySub = displayParts.filter(Boolean).join(' · ');
      // Il marker resta nel DOM anche se invisibile: così tutte le card sono allineate
      b.innerHTML = `<span class="sel-mark" aria-hidden="true">◆</span>
    <span class="icon">${Icons.markup(t.type)}</span>
    ${t.alive ? '<span class="live-dot" title="In esecuzione"></span>' : ''}
    <span class="meta"><span class="name">${escapeHtml(t.name)}${t.alive ? '' : ' (terminata)'}</span>
    <span class="sub path" title="${escapeHtml(fullSub)}"><span>${escapeHtml(displaySub)}</span></span></span>`;
      // Il primo click rifà la sidebar (onSelect → render), quindi il secondo
      // click arriva su un bottone nuovo e l'evento dblclick del browser non
      // scatta mai: il doppio click va riconosciuto a mano, fuori dal DOM.
      b.onclick = () => {
        const now = Date.now();
        // Il rilascio di un trascinamento non deve selezionare né rinominare
        if (now - dragEndedAt <= DRAG_CLICK_GUARD_MS) return;
        const isDouble = lastCardClick.id === t.id && now - lastCardClick.at <= DOUBLE_CLICK_MS;
        lastCardClick = { id: t.id, at: isDouble ? 0 : now };
        if (isDouble) { onRename(t); return; }
        onSelect(t.id);
      };
      b.title = b.title || 'Doppio click per rinominare';
      // Con tmux la ✕ stacca (la sessione resta viva): chi vuole chiudere il
      // processo per davvero ha un secondo pulsante, non la stessa ✕.
      const detachable = canDetach(t);
      const x = document.createElement('span');
      x.className = 'close-x'; x.textContent = '✕';
      x.title = detachable ? 'Stacca — la sessione resta viva, la ritrovi alla riapertura' : 'Chiudi';
      x.onclick = (e) => { e.stopPropagation(); onClose(t.id); };
      if (detachable && onTerminate) {
        const k = document.createElement('span');
        k.className = 'close-x terminate-x'; k.textContent = '⏻';
        k.title = 'Termina — chiude il processo per davvero';
        k.onclick = (e) => { e.stopPropagation(); onTerminate(t.id); };
        b.appendChild(k);
      }
      b.appendChild(x);
      attachDrag(b, t, groupKey, body);
      return b;
    }

    /** Il «+» accanto alla linguetta di un progetto: nuova sessione in quella radice. */
    function createAddButton(g) {
      const add = document.createElement('span');
      add.className = 'group-add';
      add.textContent = '+';
      add.setAttribute('role', 'button');
      add.title = `Nuova sessione in ${g.title}`;
      // Come la ✕ delle card: il click non deve arrivare all'header e collassare il gruppo
      add.onclick = (e) => { e.stopPropagation(); onNewInProject(g.key); };
      return add;
    }

    /**
     * @param {object[]} sessions schede aperte, nell'ordine di apertura
     * @param {string|null} activeId scheda in primo piano
     */
    function render(sessions, activeId) {
      if (dragging) { pendingRender = [sessions, activeId]; return; }
      list.innerHTML = '';
      if (count) count.textContent = sessions.length ? `(${sessions.length})` : '';
      if (!sessions.length) {
        list.innerHTML = '<p class="muted" style="font-size:12px">Nessuna sessione aperta.<br>Avviane una con ＋ Nuova sessione.</p>';
        return;
      }
      const groups = Groups.groupSessions(sessions, {
        mode: groupMode,
        typeOrder: Groups.TYPE_ORDER,
        typeLabels: Groups.TYPE_LABELS,
      });
      for (const g of groups) {
        // Gruppo espandibile/collassabile sempre, anche con una sola sessione:
        // la posizione delle card resta stabile quando il gruppo cresce.
        const collapsed = collapsedSet().has(g.key);
        const hasActive = g.items.some((t) => t.id === activeId);
        const group = document.createElement('div');
        // `is-focused` alza i bordi del fascicolo che contiene la sessione in
        // primo piano; `data-sheets` dice quanti fogli disegnare sotto la
        // linguetta quando il gruppo è chiuso.
        group.className = 'session-group' + (hasActive ? ' is-focused' : '');
        group.dataset.sheets = String(sheetCount(g.items.length, collapsed));
        // La linguetta e il «+» stanno sulla stessa riga: il «+» all'estremità
        // destra, dove non collide con la ✕ della prima sessione.
        const cap = document.createElement('div');
        cap.className = 'group-cap';
        const header = document.createElement('button');
        // Se collassato nasconde la scheda attiva (o una che lampeggia), l'header lo segnala
        const hidesActive = collapsed && hasActive;
        const hidesAttention = collapsed && g.items.some((t) => t.needsAttention);
        header.className = `group-header` + (g.kind === 'type' ? ` type-${g.key}` : ' is-project')
          + (hidesActive ? ' has-active' : '')
          + (hidesAttention ? ' needs-attention' : '');
        header.setAttribute('aria-expanded', String(!collapsed));
        header.title = g.title;
        // In modalità progetto il marchio dell'agente non c'entra: serve un glifo
        // neutro, lo stesso già usato dai chip delle directory recenti.
        const groupIcon = g.kind === 'type' ? Icons.markup(g.key) : '📁';
        // La fetta punta a destra; aperta la ruota la CSS, non un secondo glifo
        header.innerHTML = `<span class="chevron">${Slice.markup()}</span>
      <span class="sel-mark" aria-hidden="true">◆</span>
      <span class="icon">${groupIcon}</span>
      <span class="group-name">${escapeHtml(g.label)}</span>
      <span class="group-count">${g.items.length}</span>`;
        header.onclick = () => {
          const set = collapsedSet();
          if (set.has(g.key)) set.delete(g.key);
          else set.add(g.key);
          saveCollapsed();
          render(sessions, activeId);
        };
        cap.appendChild(header);
        // «+» solo dove c'è una radice in cui creare: il gruppo «Senza
        // directory» (chiave vuota) non ce l'ha, e per tipo la directory non è nota.
        if (onNewInProject && g.kind === 'project' && g.key) cap.appendChild(createAddButton(g));
        group.appendChild(cap);
        const body = document.createElement('div');
        body.className = 'group-body';
        if (collapsed) body.hidden = true;
        for (const t of g.items) body.appendChild(createSessionItem(t, activeId, g.key, body));
        attachBodyDrag(body, g.key);
        group.appendChild(body);
        list.appendChild(group);
      }
    }

    updateModeButtons();
    return { render, getMode, setMode, expandGroupOf, groupKeyFor };
  }

  return { createSidebar, sheetCount, GROUP_MODES, DOUBLE_CLICK_MS };
});
