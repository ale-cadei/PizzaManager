/* Pannello della sessione git: la timeline dei branch locali.
 *
 * Il layout (colonna di ogni commit, linee fra una riga e la successiva)
 * arriva già calcolato dal main (lib/git-graph.js): qui si disegna. Il grafo
 * è un solo <svg> a sinistra delle righe, alto quanto tutte le righe; ogni
 * riga riporta ref, messaggio, autore, data e ora, hash.
 *
 * Dall'intestazione si passa alla mappa dei branch (renderer/git-map-view.js,
 * docs/plans/31): stessi dati, un'altra forma.
 *
 * Tutto ciò che arriva dal repository (messaggi, nomi, branch) entra nella
 * pagina con textContent: niente innerHTML con dati.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessGitView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ROW_H = 28;
  const LANE_W = 16;
  const PAD_X = 12;
  const DOT_R = 4.5;
  const HASH_LEN = 7;
  const SWITCH_NOTICE_MS = 4000;
  /* Un colore per corsia, ciclico. Scelti per staccarsi dal fondo scuro e
     fra loro; il primo è quello del tipo git, così il branch principale
     (sempre la corsia 0, lib/git-graph.js) ha il colore della card. */
  const PALETTE = ['var(--type-git)', '#5AA2FF', '#4ADE80', '#F2C14E', '#C084FC', '#FF6B6B', '#2DD4BF', '#F472B6'];

  const laneX = (col) => PAD_X + col * LANE_W;
  const rowY = (i) => i * ROW_H + ROW_H / 2;
  const colorOf = (index) => PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
  const graphWidth = (lanes) => PAD_X * 2 + Math.max(0, lanes - 1) * LANE_W;

  /** Tracciato di una linea dalla riga `row` (colonna `from`) alla successiva (`to`). */
  function edgePath(row, from, to) {
    const [x1, y1, x2, y2] = [laneX(from), rowY(row), laneX(to), rowY(row + 1)];
    if (from === to) return `M${x1} ${y1}V${y2}`;
    const ym = (y1 + y2) / 2;
    return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
  }

  const pad = (n) => String(n).padStart(2, '0');
  /** "25/09/2026 10:12" nell'ora locale; stringa vuota per una data illeggibile. */
  function formatDate(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** Ref da mostrare accanto al messaggio: i remoti dopo i locali, HEAD staccata compresa. */
  function visibleRefs(refs) {
    const rank = { branch: 0, head: 0, tag: 1, remote: 2 };
    return (Array.isArray(refs) ? refs : []).slice().sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3));
  }

  /**
   * Solo la linea `lane` (indice di colore): i suoi commit, uno sotto
   * l'altro su una corsia sola.
   */
  function focusRows(rows, lane) {
    const kept = (Array.isArray(rows) ? rows : []).filter((r) => r.color === lane);
    return kept.map((r, i) => ({ ...r, col: 0, edges: i < kept.length - 1 ? [{ from: 0, to: 0, color: lane }] : [] }));
  }

  /** Nome da mostrare per una linea: il primo branch che punta a un suo commit. */
  function laneLabel(rows, lane) {
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.color !== lane) continue;
      const ref = visibleRefs(r.commit.refs).find((x) => x.kind === 'branch' || x.kind === 'remote');
      if (ref) return ref.name;
    }
    return '';
  }

  /** Nome del punto in cui si trova HEAD: il branch, o il commit se è staccata. */
  function headName(data) {
    if (data.head) return data.head;
    const row = (data.rows || []).find((r) => r.commit.refs.some((ref) => ref.head));
    return row ? `HEAD staccata (${row.commit.hash.slice(0, HASH_LEN)})` : 'HEAD staccata';
  }

  /**
   * Il branch corrente è cambiato fra due letture dello stesso repository?
   * Un commit nuovo sullo stesso branch non conta.
   * @returns {{from: string, to: string}|null}
   */
  function headChange(prev, next) {
    if (!prev || !prev.ok || !next || !next.ok || prev.root !== next.root) return null;
    const [from, to] = [headName(prev), headName(next)];
    return from === to ? null : { from, to };
  }

  function createGitView({ root, document, onRefresh, onCopy, onBranchClick }) {
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    // I colori passano da style e non dagli attributi: un attributo di
    // presentazione SVG non capisce var(--type-git).
    const svgEl = (tag, attrs, paint = {}) => {
      const e = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      for (const [k, v] of Object.entries(paint)) e.style.setProperty(k, v);
      return e;
    };

    // Caricata prima di questo file (index.html); senza, resta solo la timeline
    const MapView = typeof window !== 'undefined' ? window.AisessGitMapView : null;
    const view = el('div', 'git-view');
    // focusabile: Esc torna a tutte le linee
    view.tabIndex = -1;
    const head = el('header', 'git-head');
    const repo = el('span', 'git-repo');
    const branch = el('button', 'git-branch');
    branch.type = 'button';
    branch.title = 'Cambia branch o creane uno nuovo';
    branch.addEventListener('click', () => onBranchClick && onBranchClick());
    const count = el('span', 'git-count muted small');
    const refresh = el('button', 'btn btn--ghost git-refresh', '⟳ Aggiorna');
    refresh.type = 'button';
    refresh.addEventListener('click', () => onRefresh && onRefresh());
    // Timeline | Mappa, e nella mappa la scelta di vedere anche i branch già uniti
    const modes = el('div', 'git-modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Vista');
    modes.hidden = !MapView;
    const modeButtons = { timeline: el('button', 'git-mode', 'Timeline'), map: el('button', 'git-mode', 'Mappa') };
    for (const [key, b] of Object.entries(modeButtons)) {
      b.type = 'button';
      b.addEventListener('click', () => setMode(key));
      modes.appendChild(b);
    }
    const merged = el('label', 'git-merged small');
    const mergedBox = el('input');
    mergedBox.type = 'checkbox';
    mergedBox.checked = true;
    const mergedText = el('span');
    merged.append(mergedBox, mergedText);
    merged.hidden = true;
    mergedBox.addEventListener('change', () => { showMerged = mergedBox.checked; render({ keepScroll: false }); });
    head.append(repo, branch, count, merged, modes, refresh);
    // Avviso del cambio di branch: compare per qualche secondo sotto l'intestazione
    const switched = el('div', 'git-switched');
    switched.setAttribute('role', 'status');
    switched.hidden = true;
    const scroll = el('div', 'git-scroll');
    const status = el('p', 'git-status muted');
    view.append(head, switched, scroll);
    root.appendChild(view);

    function showStatus(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('git-status--error', isError);
      scroll.replaceChildren(status);
    }

    function drawGraph(rows, width) {
      const w = graphWidth(width);
      const svg = svgEl('svg', { class: 'git-graph', width: w, height: rows.length * ROW_H, 'aria-hidden': 'true' });
      const lines = svgEl('g', { fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' });
      const dots = svgEl('g', {});
      rows.forEach((r, i) => {
        for (const e of r.edges) {
          const d = edgePath(i, e.from, e.to);
          lines.appendChild(svgEl('path', { d, 'data-lane': e.color }, { stroke: colorOf(e.color), '--lane-color': colorOf(e.color) }));
          // tratto largo e trasparente sopra la linea: così si riesce a cliccarla
          lines.appendChild(svgEl('path', { d, class: 'git-hit', 'data-lane': e.color }));
        }
        const merge = r.commit.parents.length > 1;
        const isHead = r.commit.refs.some((ref) => ref.head);
        dots.appendChild(svgEl('circle', {
          cx: laneX(r.col), cy: rowY(i), r: isHead ? DOT_R + 1.5 : DOT_R, 'stroke-width': merge || isHead ? 2.5 : 0, 'data-lane': r.color,
        }, { fill: merge ? 'var(--bg)' : colorOf(r.color), stroke: colorOf(r.color), '--lane-color': colorOf(r.color) }));
      });
      svg.append(lines, dots);
      return { svg, w };
    }

    // Un branch ha il colore della sua linea: la corsia del commit a cui punta
    function drawRef(ref, lane) {
      const chip = el('span', `git-ref git-ref--${ref.kind}` + (ref.head ? ' git-ref--head' : ''), ref.name);
      if (ref.kind !== 'tag') {
        chip.style.setProperty('--ref-color', colorOf(lane));
        chip.dataset.lane = String(lane);
      }
      if (ref.head) chip.title = ref.kind === 'head' ? 'HEAD staccata' : 'Branch corrente (HEAD)';
      return chip;
    }

    function drawRow(r) {
      const c = r.commit;
      const li = el('li', 'git-row' + (c.refs.some((ref) => ref.head) ? ' git-row--head' : ''));
      const refs = el('span', 'git-refs');
      refs.append(...visibleRefs(c.refs).map((ref) => drawRef(ref, r.color)));
      const subject = el('span', 'git-subject', c.subject);
      subject.title = c.subject;
      const hash = el('button', 'git-hash', c.hash.slice(0, HASH_LEN));
      hash.type = 'button';
      hash.title = `${c.hash}\nClic per copiare`;
      hash.addEventListener('click', () => {
        if (onCopy) onCopy(c.hash);
        hash.classList.add('copied');
        setTimeout(() => hash.classList.remove('copied'), 900);
      });
      // Ref e messaggio in una cella sola: senza ref la griglia non si sfasa
      const msg = el('span', 'git-msg');
      msg.append(refs, subject);
      li.append(msg, el('span', 'git-author', c.author), el('span', 'git-date', formatDate(c.date)), hash);
      return li;
    }

    let data = null;
    let lit = null; // corsia illuminata dal passaggio del mouse, o null
    let focus = null; // indice di colore della linea isolata, o null = tutte
    let focusTip = ''; // hash del commit più recente della linea: la ritrova dopo un aggiornamento
    let mode = 'timeline'; // o 'map'
    let showMerged = true; // nella mappa, anche i branch già uniti

    function setMode(next) {
      mode = next === 'map' && MapView ? 'map' : 'timeline';
      for (const [key, b] of Object.entries(modeButtons)) b.setAttribute('aria-pressed', String(key === mode));
      if (data && data.ok) render({ keepScroll: false });
    }
    setMode(mode);

    /** Dalla mappa: la timeline con la sola linea del branch scelto. */
    function openInTimeline(tip) {
      const row = (data.rows || []).find((r) => r.commit.hash === tip);
      focus = row ? row.color : null;
      focusTip = row ? tip : '';
      setMode('timeline');
      view.focus({ preventScroll: true });
    }

    function renderMap({ keepScroll }) {
      view.classList.remove('git-view--focus');
      const maps = data.map;
      merged.hidden = !(maps && maps.hiddenCount);
      mergedText.textContent = `già uniti (${maps ? maps.hiddenCount : 0})`;
      const layout = maps && (showMerged ? maps.all : maps.open);
      if (!layout || !layout.lines.length) { count.textContent = ''; showStatus('Nessun branch locale da mostrare.'); return; }
      count.textContent = `${layout.lines.length} branch` + (data.truncated ? ' · dai commit più recenti' : '');
      // Un branch ha nella mappa il colore della sua linea nella timeline
      const laneOf = new Map((data.rows || []).map((r) => [r.commit.hash, r.color]));
      const { element, trunkY } = MapView.createBranchMap({
        document, layout, formatDate, onPick: openInTimeline, colorOf: (line) => colorOf(laneOf.get(line.tip) ?? 0),
      });
      const [top, left] = [scroll.scrollTop, scroll.scrollLeft];
      scroll.replaceChildren(element);
      if (keepScroll) { scroll.scrollTop = top; scroll.scrollLeft = left; return; }
      // I commit più recenti stanno a destra: si parte da lì, col tronco a metà altezza
      scroll.scrollLeft = scroll.scrollWidth;
      scroll.scrollTop = Math.max(0, trunkY - scroll.clientHeight / 2);
    }

    function render({ keepScroll }) {
      lit = null; // gli elementi illuminati stanno per essere ridisegnati
      view.classList.remove('git-view--lit');
      view.classList.toggle('git-view--map', mode === 'map');
      if (mode === 'map') { renderMap({ keepScroll }); return; }
      merged.hidden = true;
      const all = data.rows || [];
      const rows = focus === null ? all : focusRows(all, focus);
      const label = focus === null ? '' : laneLabel(all, focus);
      count.textContent = focus === null
        ? (all.length ? `${all.length} commit${data.truncated ? ' (i più recenti)' : ''}` : '')
        : `${rows.length} commit di ${label || 'questa linea'} · Esc per vederle tutte`;
      view.classList.toggle('git-view--focus', focus !== null);
      if (!rows.length) { showStatus('Nessun commit ancora.'); return; }
      const { svg, w } = drawGraph(rows, focus === null ? data.width || 1 : 1);
      const body = el('div', 'git-body');
      body.style.setProperty('--git-graph-w', w + 'px');
      body.style.setProperty('--git-row-h', ROW_H + 'px');
      const list = el('ol', 'git-rows');
      list.append(...rows.map(drawRow));
      body.append(svg, list);
      // Chi stava guardando più in basso non deve tornare in cima a ogni aggiornamento
      const top = keepScroll ? scroll.scrollTop : 0;
      scroll.replaceChildren(body);
      scroll.scrollTop = top;
    }

    /** Isola la linea `lane`; la stessa linea, o null, torna a tutte. */
    function setFocus(lane) {
      if (!data || !data.ok) return;
      const next = lane === null || lane === focus ? null : lane;
      if (next === focus) return;
      focus = next;
      const tip = focus === null ? null : (data.rows || []).find((r) => r.color === focus);
      focusTip = tip ? tip.commit.hash : '';
      render({ keepScroll: false });
      view.focus({ preventScroll: true });
    }

    /** @param {{ok: boolean, root?: string, head?: string|null, rows?: object[], width?: number, truncated?: boolean, error?: string}} next */
    function update(next) {
      if (!next || !next.ok) {
        showStatus((next && next.error) || 'Impossibile leggere il repository.', true);
        return;
      }
      const change = headChange(data, next);
      data = next;
      repo.textContent = data.root || '';
      repo.title = data.root || '';
      branch.textContent = (data.head ? `⎇ ${data.head}` : 'HEAD staccata') + ' ▾';
      // Dopo un aggiornamento i colori possono cambiare: la linea isolata si
      // ritrova dal suo commit più recente, se c'è ancora
      // Cambiando branch si torna a tutte le linee: HEAD potrebbe stare fuori da quella isolata
      if (change) focus = null;
      if (focus !== null) {
        const tip = (data.rows || []).find((r) => r.commit.hash === focusTip);
        focus = tip ? tip.color : null;
      }
      render({ keepScroll: !change });
      if (change) announceSwitch(change);
    }

    let switchTimer = null;
    /** Il branch è cambiato: il pulsante pulsa, l'avviso dice da dove a dove,
        la timeline mostra il commit di HEAD. */
    function announceSwitch({ from, to }) {
      switched.replaceChildren(el('span', 'git-switched-label', '⎇ Cambio di branch: '), el('span', 'git-switched-from', from), el('span', 'git-switched-arrow', ' → '), el('b', 'git-switched-to', to));
      switched.hidden = false;
      // riavvia l'animazione anche se era già in corso
      branch.classList.remove('git-branch--changed');
      void branch.offsetWidth;
      branch.classList.add('git-branch--changed');
      clearTimeout(switchTimer);
      switchTimer = setTimeout(() => {
        switched.hidden = true;
        branch.classList.remove('git-branch--changed');
      }, SWITCH_NOTICE_MS);
      const row = scroll.querySelector('.git-row--head');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
    }

    // Clic su una linea, un pallino o il nome di un branch: solo quella linea.
    // Clic altrove nel pannello: di nuovo tutte. Non contano i pulsanti
    // (l'hash copia, Aggiorna aggiorna) né la scelta del branch.
    const KEEP_FOCUS = '.git-hash, .git-head button, .git-picker';
    view.addEventListener('click', (e) => {
      if (mode !== 'timeline') return;
      const target = e.target.closest ? e.target : e.target.parentElement;
      const hit = target && target.closest('[data-lane]');
      if (hit) { setFocus(Number(hit.getAttribute('data-lane'))); return; }
      if (focus !== null && !(target && target.closest(KEEP_FOCUS))) setFocus(null);
    });
    // Passaggio del mouse su linea, pallino o nome di branch: la corsia si
    // illumina (styles.css, .is-lit). Stesso bersaglio del clic.
    function light(lane) {
      if (lane === lit) return;
      lit = lane;
      view.classList.toggle('git-view--lit', lane !== null);
      const key = String(lane);
      for (const e of scroll.querySelectorAll('[data-lane]')) e.classList.toggle('is-lit', lane !== null && e.getAttribute('data-lane') === key);
    }
    view.addEventListener('mouseover', (e) => {
      if (mode !== 'timeline') return;
      const target = e.target.closest ? e.target : e.target.parentElement;
      const hit = target && target.closest('[data-lane]');
      light(hit ? Number(hit.getAttribute('data-lane')) : null);
    });
    view.addEventListener('mouseleave', () => light(null));
    view.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mode === 'timeline' && focus !== null) { e.preventDefault(); setFocus(null); }
    });

    function setLoading(on) {
      refresh.disabled = Boolean(on);
      view.classList.toggle('loading', Boolean(on));
    }

    return { update, setLoading, showStatus, setFocus, setMode, element: view };
  }

  return { createGitView, edgePath, formatDate, visibleRefs, colorOf, headChange, graphWidth, focusRows, laneLabel, ROW_H, LANE_W, PALETTE };
});
