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
  /* Ordine dei gruppi progetto scelto trascinandone la linguetta. A differenza
     di quello delle card si salva: la chiave di un progetto è la sua radice,
     che resta la stessa fra un avvio e l'altro. */
  const PROJECT_ORDER_KEY = 'aisess.projectOrder';
  /* Tetto dei progetti ricordati: quelli mai più riaperti non devono gonfiare
     lo storage per sempre. Si perdono i più in fondo alla lista. */
  const MAX_SAVED_PROJECTS = 200;
  /* Soglia del doppio click sulle card, tenuta fuori dal DOM perché le card
     vengono ricreate a ogni render. */
  const DOUBLE_CLICK_MS = 450;
  /* Finestra in cui un click che segue un trascinamento viene ignorato. */
  const DRAG_CLICK_GUARD_MS = 250;
  /* I due tooltip della card: il segnale può accendersi e spegnersi senza
     ridisegnarla (signal()), quindi la scritta va rimessa a posto lì. */
  const ATTENTION_TITLE = 'L\'assistente ha finito: apri la sessione per vedere il risultato';
  const PERMISSION_TITLE = 'L\'assistente ti chiede un permesso: apri la sessione per rispondere';
  const RENAME_TITLE = 'Doppio click per rinominare';
  /* Le conversazioni di cui si legge il testo (lib/transcripts.js): solo per
     loro la card offre l'export in Markdown. Lo usa anche il Resume. */
  const EXPORTABLE_TYPES = Object.freeze(['claude', 'codex']);
  const canExport = (t) => EXPORTABLE_TYPES.includes(t.type) && Boolean(t.resumeId);

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

  function readList(storage, key) {
    try {
      const saved = JSON.parse(storage.getItem(key) || '[]');
      if (Array.isArray(saved)) return saved.filter((k) => typeof k === 'string');
    } catch {}
    return [];
  }

  function readSet(storage, key) {
    return new Set(readList(storage, key));
  }

  function writeList(storage, key, items) {
    try { storage.setItem(key, JSON.stringify([...items])); } catch {}
  }
  const writeSet = writeList;

  /**
   * @param {{list: Element, count: Element, storage: Storage, Icons: object,
   *   Slice: {markup: () => string},
   *   Groups: object, Commands: object, escapeHtml: (s: string) => string,
   *   modeButtons?: {type: Element, project: Element},
   *   onSelect: (id: string) => void, onClose: (id: string) => void,
   *   onRename: (session: object) => void,
   *   onIcon?: (session: object) => void,
   *   onExport?: (session: object, card: Element) => void,
   *   onNewInProject?: (projectRoot: string) => void,
   *   onResumeInProject?: (projectRoot: string) => void,
   *   WorktreeSection?: {createSection: Function},
   *   onNewWorktree?: (projectRoot: string) => void,
   *   onNewInWorktree?: (path: string, projectRoot: string) => void,
   *   onWorktreeMenu?: (worktree: object, projectRoot: string, anchor: Element) => void,
   *   changesOf?: (path: string) => ({files: number, added: number, removed: number}|null),
   *   onReorder?: (movedId: string, targetId: string, opts: {before: boolean}) => void,
   *   Order?: {moveAdjacent: Function}}} deps
   * Senza `Order` le linguette dei progetti non si trascinano. Senza
   * `WorktreeSection` i worktree non hanno sotto-sezioni e le loro sessioni
   * restano fra quelle del progetto (docs/plans/36).
   */
  function createSidebar(deps) {
    const { list, count, storage, Icons, Slice, Groups, escapeHtml, onSelect, onClose, onRename } = deps;
    const Commands = deps.Commands || null;
    const modeButtons = deps.modeButtons || {};
    const onReorder = typeof deps.onReorder === 'function' ? deps.onReorder : null;
    /* Creare una sessione è affare del renderer (dialog, tipo, account): la
       sidebar segnala solo in quale radice l'utente la vuole. */
    const onNewInProject = typeof deps.onNewInProject === 'function' ? deps.onNewInProject : null;
    const onResumeInProject = typeof deps.onResumeInProject === 'function' ? deps.onResumeInProject : null;
    /* Anche esportare è affare del renderer (dialog, esito): la sidebar passa la
       sessione e la card, su cui appoggiare un eventuale errore. */
    const onExport = typeof deps.onExport === 'function' ? deps.onExport : null;
    const onIcon = typeof deps.onIcon === 'function' ? deps.onIcon : null;
    /* Worktree (docs/plans/36): la sidebar disegna, il renderer crea, unisce e butta */
    const WorktreeSection = deps.WorktreeSection && typeof deps.WorktreeSection.createSection === 'function' ? deps.WorktreeSection : null;
    const fnOrNull = (f) => (typeof f === 'function' ? f : null);
    const onNewWorktree = fnOrNull(deps.onNewWorktree);
    const onNewInWorktree = fnOrNull(deps.onNewInWorktree);
    const onWorktreeMenu = fnOrNull(deps.onWorktreeMenu);
    // Righe toccate in ogni worktree (docs/plans/32): le legge il renderer
    const changesOf = fnOrNull(deps.changesOf);
    const Order = deps.Order && typeof deps.Order.moveAdjacent === 'function' ? deps.Order : null;

    /* Collassi in liste separate per modalità: collassare "Claude" e collassare
       "aisessionmanager" sono scelte diverse e nella stessa chiave
       interferirebbero. */
    const collapsedGroups = readSet(storage, COLLAPSED_GROUPS_KEY);
    const collapsedProjects = readSet(storage, COLLAPSED_PROJECTS_KEY);
    let projectOrder = readList(storage, PROJECT_ORDER_KEY);
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
    /* Gruppo progetto in corso di trascinamento, e dove verrebbe rilasciato. */
    let draggingGroup = null;
    /* Ultimo render: dopo lo spostamento di un gruppo la sidebar si ridisegna
       da sola, senza passare dal renderer (l'ordine dei gruppi è suo). */
    let lastRender = null;
    /* Chiavi dei gruppi progetto mostrati, nell'ordine in cui si vedono. */
    let shownProjectKeys = [];
    /* Worktree per radice dell'ultimo render: la card ci legge il suo branch */
    let shownWorktrees = {};

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

    /**
     * FLIP: gli elementi che cambiano posto partono da dove erano e scivolano
     * dove sono. `skip` è quello preso in mano, che non va animato.
     */
    function flip(elements, skip, move) {
      const before = new Map(elements.map((c) => [c, c.getBoundingClientRect().top]));
      move();
      if (typeof requestAnimationFrame !== 'function') return; // DOM finto nei test
      for (const c of elements) {
        if (c === skip) continue;
        const delta = before.get(c) - c.getBoundingClientRect().top;
        if (!delta) continue;
        c.style.transition = 'none';
        c.style.transform = `translateY(${delta}px)`;
      }
      requestAnimationFrame(() => {
        for (const c of elements) { c.style.transition = ''; c.style.transform = ''; }
      });
    }

    /** FLIP sulle card di un gruppo. */
    function shiftAnimated(body, move) {
      flip(cardsOf(body), dragging.el, move);
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

    /* Trascinamento dei gruppi progetto, per la linguetta. Stesso riordino
       "vivo" delle card: il gruppo preso in mano si sposta DAVVERO nella lista e
       fa da segnaposto (chiuso, per non essere alto quanto le sue sessioni), gli
       altri scorrono con FLIP, e il rilascio conferma l'ordine che si vede.
       Il rilascio si accetta su tutta la lista, spazi fra i gruppi compresi: un
       rilascio rifiutato fa tornare indietro l'immagine trascinata prima che la
       lista si aggiorni, ed è il salto che si vedeva.
       «Senza directory» (chiave vuota) non si sposta e nessuno le passa sotto:
       resta in fondo, come decide session-groups.js. */
    const canDragGroups = () => !!Order && groupMode === 'project';
    const isMovableGroup = (key) => canDragGroups() && !!key;
    const groupsInList = () => [...list.children].filter((n) => n.classList && n.classList.contains('session-group'));
    const movableGroups = () => groupsInList().filter((g) => isMovableGroup(g.dataset.groupKey));

    /**
     * Porta il segnaposto prima del primo progetto il cui centro sta sotto il
     * cursore, o dopo l'ultimo progetto. Stabile: spostarlo oltre un gruppo
     * sposta quel gruppo dalla parte giusta, non lo riporta sotto il cursore.
     */
    function placeGroup(clientY) {
      const el = draggingGroup.el;
      const others = movableGroups().filter((g) => g !== el);
      if (!others.length) return;
      const next = others.find((g) => {
        const r = g.getBoundingClientRect();
        return clientY < r.top + r.height / 2;
      });
      const ref = next || others[others.length - 1].nextElementSibling;
      if (ref === el || el.nextElementSibling === ref) return;
      flip(groupsInList(), el, () => list.insertBefore(el, ref));
    }

    /** Salva l'ordine letto dal DOM. Falso se il gruppo è dove era partito. */
    function commitGroupsFromDom() {
      const keys = movableGroups().map((g) => g.dataset.groupKey);
      if (keys.every((k, i) => k === shownProjectKeys[i])) return false;
      const shown = new Set(keys);
      projectOrder = [...keys, ...projectOrder.filter((k) => !shown.has(k))].slice(0, MAX_SAVED_PROJECTS);
      writeList(storage, PROJECT_ORDER_KEY, projectOrder);
      return true;
    }

    function endGroupDrag() {
      const d = draggingGroup;
      draggingGroup = null;
      dragEndedAt = Date.now();
      d.el.classList.remove('group-dragging');
      list.classList.remove('reordering-groups');
      const moved = commitGroupsFromDom();
      const pend = pendingRender;
      pendingRender = null;
      // Il render dopo lo spostamento ridisegna lo stesso ordine che già si
      // vede: serve a riallineare lo stato interno, non muove niente.
      if (moved || pend) render(...(pend || lastRender));
    }

    function attachGroupDrag(group, header, key) {
      header.dataset.key = key;
      group.dataset.groupKey = key;
      header.draggable = isMovableGroup(key);
      if (!header.draggable) return;
      header.addEventListener('dragstart', (e) => {
        draggingGroup = { key, el: group };
        // Come per le card: l'immagine che segue il cursore si fotografa dopo
        // questo handler, il segnaposto si disegna al frame dopo.
        const mark = () => {
          if (!draggingGroup || draggingGroup.el !== group) return;
          group.classList.add('group-dragging');
          list.classList.add('reordering-groups');
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(mark); else mark();
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', key); } catch {}
        }
      });
      header.addEventListener('dragend', () => { if (draggingGroup) endGroupDrag(); });
    }

    /* Sulla lista, una volta sola: la lista sopravvive ai render, i gruppi no.
       Il dragover di un gruppo ci arriva per bubbling. */
    if (Order) {
      list.addEventListener('dragover', (e) => {
        if (!draggingGroup) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        placeGroup(e.clientY);
      });
      list.addEventListener('drop', (e) => {
        if (!draggingGroup) return;
        e.preventDefault();
        // L'ordine è già quello che si vede: lo conferma dragend.
      });
    }

    /** @param {string|null} [baseDir] cartella rispetto a cui mostrare la sottocartella (un worktree) */
    function createSessionItem(t, activeId, groupKey, body, baseDir = null) {
      const b = document.createElement('button');
      // L'id sulla card e non solo nella chiusura del click: dopo un render le
      // card sono elementi nuovi, e chi era appeso a una di loro (il fumetto di
      // conferma) deve poterla ritrovare.
      b.dataset.id = t.id;
      const isActive = t.id === activeId;
      b.className = `session-item type-${t.type}` + (isActive ? ' active' : '')
        + (t.needsAttention ? ' needs-attention' : '')
        + (t.needsAttention && t.attentionKind === 'permission' ? ' needs-permission' : '')
        + (t.running ? ' is-running' : '');
      if (isActive) b.setAttribute('aria-current', 'true');
      if (t.needsAttention) b.title = t.attentionKind === 'permission' ? PERMISSION_TITLE : ATTENTION_TITLE;
      // Il comando si mostra solo se per quel tipo ce n'è più di uno configurato
      const multiCommand = Commands && Commands.profilesFor(t.type).length > 1;
      // Per tipo il worktree non ha una sotto-sezione: il branch lo dice la card
      const worktree = groupMode === 'type' ? Groups.worktreeOf && Groups.worktreeOf(t, shownWorktrees) : null;
      const extras = [t.claudeAccountName, multiCommand ? t.commandProfileLabel : null, worktree ? `⑂ ${worktree.branch || 'staccato'}` : null].filter(Boolean);
      const fullSub = [t.cwd || '', ...extras].filter(Boolean).join(' · ');
      // In modalità progetto l'header del gruppo è già il path: ripeterlo sotto è
      // rumore. Al suo posto il tipo della sessione (che lì non è più nell'header)
      // e la sottocartella, se la sessione non sta nella radice del progetto.
      const displayParts = groupMode === 'project'
        ? [Groups.TYPE_LABELS[t.type] || t.type, Groups.relativeSubpath(t.cwd, baseDir || t.projectRoot), ...extras]
        : [Groups.shortPath(t.cwd), ...extras];
      const displaySub = displayParts.filter(Boolean).join(' · ');
      // Il marker resta nel DOM anche se invisibile: così tutte le card sono allineate
      b.innerHTML = `<span class="sel-mark" aria-hidden="true">◆</span>
    <span class="icon${t.type === 'shell' && onIcon ? ' shell-icon-trigger' : ''}"${t.type === 'shell' && onIcon ? ' role="button" tabindex="0" aria-label="Scegli icona shell" title="Scegli icona shell"' : ''}>${Icons.markup(t.type === 'shell' && Icons.has && Icons.has(t.iconKey) ? t.iconKey : t.type)}</span>
    <span class="meta"><span class="name">${escapeHtml(t.name)}${t.alive ? '' : ' (terminata)'}</span>
    <span class="sub path" title="${escapeHtml(fullSub)}"><span>${escapeHtml(displaySub)}</span></span></span>`;
      // Il primo click rifà la sidebar (onSelect → render), quindi il secondo
      // click arriva su un bottone nuovo e l'evento dblclick del browser non
      // scatta mai: il doppio click va riconosciuto a mano, fuori dal DOM.
      b.onclick = (e) => {
        if (t.type === 'shell' && onIcon && e && e.target && e.target.closest && e.target.closest('.shell-icon-trigger')) {
          e.stopPropagation();
          onIcon(t);
          return;
        }
        const now = Date.now();
        // Il rilascio di un trascinamento non deve selezionare né rinominare
        if (now - dragEndedAt <= DRAG_CLICK_GUARD_MS) return;
        const isDouble = lastCardClick.id === t.id && now - lastCardClick.at <= DOUBLE_CLICK_MS;
        lastCardClick = { id: t.id, at: isDouble ? 0 : now };
        if (isDouble) { onRename(t); return; }
        onSelect(t.id);
      };
      if (t.type === 'shell' && onIcon) b.onkeydown = (e) => {
        if (e.target.classList.contains('shell-icon-trigger') && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault(); e.stopPropagation(); onIcon(t);
        }
      };
      b.title = b.title || RENAME_TITLE;
      // Una sola ✕, e chiude la sessione per davvero. Prima erano due (✕ che
      // staccava, ⏻ che terminava): per sceglierne una bisognava sapere che
      // cos'è tmux. La conferma la chiede il renderer, che riceve la card su cui
      // appoggiare il fumetto.
      const x = document.createElement('span');
      x.className = 'close-x'; x.textContent = '✕';
      x.title = 'Chiudi — termina la sessione';
      x.onclick = (e) => { e.stopPropagation(); onClose(t.id, b); };
      if (onExport && canExport(t)) b.appendChild(createExportButton(t, b));
      b.appendChild(x);
      attachDrag(b, t, groupKey, body);
      return b;
    }

    /** ⤓ sulla card: la conversazione in un file Markdown. */
    function createExportButton(t, card) {
      const ex = document.createElement('span');
      ex.className = 'export-md';
      ex.textContent = '⤓';
      ex.setAttribute('role', 'button');
      ex.title = 'Esporta la conversazione in Markdown';
      // Come la ✕: il click non deve arrivare alla card e selezionarla
      ex.onclick = (e) => { e.stopPropagation(); onExport(t, card); };
      return ex;
    }

    /** Il «+» accanto alla linguetta di un progetto: nuova sessione in quella radice. */
    function createAddButton(g) {
      const add = document.createElement('button');
      add.className = 'group-add';
      add.type = 'button';
      add.textContent = '+';
      add.title = `Nuova sessione in ${g.title}`;
      add.setAttribute('aria-label', add.title);
      // Come la ✕ delle card: il click non deve arrivare all'header e collassare il gruppo
      add.onclick = (e) => { e.stopPropagation(); onNewInProject(g.key); };
      return add;
    }

    /** [⑂] accanto alla linguetta di un progetto: un worktree nuovo di quel repository. */
    function createWorktreeButton(g) {
      const b = document.createElement('button');
      b.className = 'group-worktree';
      b.type = 'button';
      b.textContent = '⑂';
      b.title = `Nuovo worktree di ${g.title}`;
      b.setAttribute('aria-label', b.title);
      b.onclick = (e) => { e.stopPropagation(); onNewWorktree(g.key); };
      return b;
    }

    function createResumeButton(g) {
      const resume = document.createElement('button');
      resume.className = 'group-resume';
      resume.type = 'button';
      resume.textContent = '⟲';
      resume.title = `Resume delle conversazioni di ${g.title}`;
      resume.setAttribute('aria-label', resume.title);
      resume.onclick = (e) => { e.stopPropagation(); onResumeInProject(g.key); };
      return resume;
    }

    /* Le card disegnate, per id. Serve a `signal()` per ritrovare una card senza
       ridisegnare la lista: render() svuota `list` e ricostruisce tutto, e con
       gli elementi ripartono da capo anche le animazioni CSS. */
    let painted = new Map();

    /**
     * Accende o spegne un segnale su una card già disegnata.
     * Passare da render() per un cambio di classe farebbe ripartire da zero il
     * lampeggio di TUTTE le card: quella che dice «ho finito» tornerebbe di
     * colpo trasparente ogni volta che un'altra sessione comincia o smette di
     * lavorare, e la pulsazione si vedrebbe a scatti invece che graduale.
     * @param {string} id
     * `permission` (piano 46) vale solo insieme a needsAttention: spegnere il
     * lampeggio spegne anche il ritmo rapido.
     * @param {{running?: boolean, needsAttention?: boolean, permission?: boolean}} flags
     * @returns {boolean} false se la card non è disegnata: chi chiama rifaccia la sidebar
     */
    function signal(id, flags) {
      const p = painted.get(id);
      if (!p) return false;
      if ('running' in flags) p.card.classList.toggle('is-running', !!flags.running);
      if ('needsAttention' in flags) {
        const permission = !!flags.needsAttention && !!flags.permission;
        p.card.classList.toggle('needs-attention', !!flags.needsAttention);
        p.card.classList.toggle('needs-permission', permission);
        p.card.title = permission ? PERMISSION_TITLE : flags.needsAttention ? ATTENTION_TITLE : RENAME_TITLE;
        // Se il gruppo è chiuso la card non si vede: il segnale sta sulla
        // linguetta, e lì vale per tutte le sessioni che ci sono dentro.
        if (p.body.hidden) {
          for (const cls of ['needs-attention', 'needs-permission']) {
            p.header.classList.toggle(cls, p.cards.some((c) => c.classList.contains(cls)));
          }
        }
      }
      return true;
    }

    /** Le sotto-sezioni dei worktree di un gruppo, con le loro card. */
    function appendWorktrees(body, g, activeId, painting) {
      for (const w of g.worktrees || []) {
        // Le card si riordinano solo dentro il loro worktree: per il
        // trascinamento è un gruppo a sé
        const dragKey = `${g.key}\u0000${w.path}`;
        body.appendChild(WorktreeSection.createSection({
          doc: document,
          worktree: w,
          changes: changesOf ? changesOf(w.path) : null,
          onNew: onNewInWorktree ? () => onNewInWorktree(w.path, g.key) : null,
          onMenu: onWorktreeMenu ? (el) => onWorktreeMenu(w, g.key, el) : null,
          fill: (wtBody) => {
            for (const t of w.items) wtBody.appendChild(painting(t, createSessionItem(t, activeId, dragKey, wtBody, w.path)));
            attachBodyDrag(wtBody, dragKey);
            return w.items.length;
          },
        }));
      }
    }

    /**
     * @param {object[]} sessions schede aperte, nell'ordine di apertura
     * @param {string|null} activeId scheda in primo piano
     * @param {Record<string, object[]>} [worktrees] i worktree di ogni radice
     *   di progetto (renderer/worktree-cache.js)
     */
    function render(sessions, activeId, worktrees = {}) {
      if (dragging || draggingGroup) { pendingRender = [sessions, activeId, worktrees]; return; }
      lastRender = [sessions, activeId, worktrees];
      shownWorktrees = worktrees && typeof worktrees === 'object' ? worktrees : {};
      painted = new Map();
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
        projectOrder,
        // Senza chi disegna le sotto-sezioni le sessioni dei worktree restano
        // fra quelle del progetto, invece di sparire
        worktrees: WorktreeSection ? shownWorktrees : null,
      });
      shownProjectKeys = groups.filter((g) => g.kind === 'project' && g.key).map((g) => g.key);
      for (const g of groups) {
        // Gruppo espandibile/collassabile sempre, anche con una sola sessione:
        // la posizione delle card resta stabile quando il gruppo cresce.
        const collapsed = collapsedSet().has(g.key);
        // Le sessioni del gruppo, comprese quelle nei suoi worktree
        const allItems = [...g.items, ...(g.worktrees || []).flatMap((w) => w.items)];
        const hasActive = allItems.some((t) => t.id === activeId);
        const group = document.createElement('div');
        // `is-focused` alza i bordi del fascicolo che contiene la sessione in
        // primo piano; `data-sheets` dice quanti fogli disegnare sotto la
        // linguetta quando il gruppo è chiuso.
        // Il tipo della sessione ATTIVA, non quello del gruppo: in modalità
        // progetto il gruppo non ne ha uno, e il marker che compare sulla
        // linguetta quando il gruppo è chiuso deve essere del colore della card
        // che si è scelta (styles.css, `.group-header.has-active .sel-mark`).
        const activeItem = hasActive ? allItems.find((t) => t.id === activeId) : null;
        group.className = 'session-group' + (activeItem ? ` is-focused type-${activeItem.type}` : '');
        group.dataset.sheets = String(sheetCount(allItems.length, collapsed));
        // La linguetta e il «+» stanno sulla stessa riga: il «+» all'estremità
        // destra, dove non collide con la ✕ della prima sessione.
        const cap = document.createElement('div');
        cap.className = 'group-cap';
        const header = document.createElement('button');
        // Se collassato nasconde la scheda attiva (o una che lampeggia), l'header lo segnala
        const hidesActive = collapsed && hasActive;
        const hidesAttention = collapsed && allItems.some((t) => t.needsAttention);
        const hidesPermission = collapsed && allItems.some((t) => t.needsAttention && t.attentionKind === 'permission');
        header.className = `group-header` + (g.kind === 'type' ? ` type-${g.key}` : ' is-project')
          + (hidesActive ? ' has-active' : '')
          + (hidesAttention ? ' needs-attention' : '')
          + (hidesPermission ? ' needs-permission' : '');
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
      <span class="group-count">${allItems.length}</span>`;
        header.onclick = () => {
          // Il rilascio del trascinamento della linguetta non è un click
          if (Date.now() - dragEndedAt <= DRAG_CLICK_GUARD_MS) return;
          const set = collapsedSet();
          if (set.has(g.key)) set.delete(g.key);
          else set.add(g.key);
          saveCollapsed();
          render(sessions, activeId, worktrees);
        };
        attachGroupDrag(group, header, g.key);
        cap.appendChild(header);
        // «+» solo dove c'è una radice in cui creare: il gruppo «Senza
        // directory» (chiave vuota) non ce l'ha, e per tipo la directory non è nota.
        if (onNewInProject && g.kind === 'project' && g.key) cap.appendChild(createAddButton(g));
        if (onResumeInProject && g.kind === 'project' && g.key) cap.appendChild(createResumeButton(g));
        if (onNewWorktree && WorktreeSection && g.kind === 'project' && g.key) cap.appendChild(createWorktreeButton(g));
        group.appendChild(cap);
        const body = document.createElement('div');
        body.className = 'group-body';
        if (collapsed) body.hidden = true;
        const cards = [];
        // Ogni card disegnata si annota per signal(): il segnale di un gruppo
        // chiuso guarda tutte le sue card, anche quelle nei worktree
        const painting = (t, card) => {
          cards.push(card);
          painted.set(t.id, { card, header, body, cards });
          return card;
        };
        for (const t of g.items) body.appendChild(painting(t, createSessionItem(t, activeId, g.key, body)));
        attachBodyDrag(body, g.key);
        if (WorktreeSection) appendWorktrees(body, g, activeId, painting);
        group.appendChild(body);
        list.appendChild(group);
      }
    }

    updateModeButtons();
    return { render, signal, getMode, setMode, expandGroupOf, groupKeyFor };
  }

  return { createSidebar, sheetCount, GROUP_MODES, DOUBLE_CLICK_MS, EXPORTABLE_TYPES };
});
