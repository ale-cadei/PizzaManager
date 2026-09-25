/* Pannello della sessione git: la timeline dei branch locali.
 *
 * Il layout (colonna di ogni commit, linee fra una riga e la successiva)
 * arriva già calcolato dal main (lib/git-graph.js): qui si disegna. Il grafo
 * è un solo <svg> a sinistra delle righe, alto quanto tutte le righe; ogni
 * riga riporta ref, messaggio, autore, data e ora, hash.
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
  /* Un colore per corsia, ciclico. Scelti per staccarsi dal fondo scuro e
     fra loro; il primo è quello del tipo git, così il branch principale
     (quasi sempre la corsia 0) ha il colore della card. */
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

  function createGitView({ root, document, onRefresh, onCopy }) {
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

    const view = el('div', 'git-view');
    const head = el('header', 'git-head');
    const repo = el('span', 'git-repo');
    const branch = el('span', 'git-branch');
    const count = el('span', 'git-count muted small');
    const refresh = el('button', 'btn btn--ghost git-refresh', '⟳ Aggiorna');
    refresh.type = 'button';
    refresh.addEventListener('click', () => onRefresh && onRefresh());
    head.append(repo, branch, count, refresh);
    const scroll = el('div', 'git-scroll');
    const status = el('p', 'git-status muted');
    view.append(head, scroll);
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
        for (const e of r.edges) lines.appendChild(svgEl('path', { d: edgePath(i, e.from, e.to) }, { stroke: colorOf(e.color) }));
        const merge = r.commit.parents.length > 1;
        const isHead = r.commit.refs.some((ref) => ref.head);
        dots.appendChild(svgEl('circle', {
          cx: laneX(r.col), cy: rowY(i), r: isHead ? DOT_R + 1.5 : DOT_R, 'stroke-width': merge || isHead ? 2.5 : 0,
        }, { fill: merge ? 'var(--bg)' : colorOf(r.color), stroke: colorOf(r.color) }));
      });
      svg.append(lines, dots);
      return { svg, w };
    }

    // Un branch ha il colore della sua linea: la corsia del commit a cui punta
    function drawRef(ref, color) {
      const chip = el('span', `git-ref git-ref--${ref.kind}` + (ref.head ? ' git-ref--head' : ''), ref.name);
      if (ref.kind !== 'tag') chip.style.setProperty('--ref-color', color);
      if (ref.head) chip.title = ref.kind === 'head' ? 'HEAD staccata' : 'Branch corrente (HEAD)';
      return chip;
    }

    function drawRow(r) {
      const c = r.commit;
      const li = el('li', 'git-row');
      const refs = el('span', 'git-refs');
      refs.append(...visibleRefs(c.refs).map((ref) => drawRef(ref, colorOf(r.color))));
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

    /** @param {{ok: boolean, root?: string, head?: string|null, rows?: object[], width?: number, truncated?: boolean, error?: string}} data */
    function update(data) {
      if (!data || !data.ok) {
        showStatus((data && data.error) || 'Impossibile leggere il repository.', true);
        return;
      }
      repo.textContent = data.root || '';
      repo.title = data.root || '';
      branch.textContent = data.head ? `⎇ ${data.head}` : 'HEAD staccata';
      const rows = data.rows || [];
      count.textContent = rows.length ? `${rows.length} commit${data.truncated ? ' (i più recenti)' : ''}` : '';
      if (!rows.length) { showStatus('Nessun commit ancora.'); return; }
      const { svg, w } = drawGraph(rows, data.width || 1);
      const body = el('div', 'git-body');
      body.style.setProperty('--git-graph-w', w + 'px');
      body.style.setProperty('--git-row-h', ROW_H + 'px');
      const list = el('ol', 'git-rows');
      list.append(...rows.map(drawRow));
      body.append(svg, list);
      // Chi stava guardando più in basso non deve tornare in cima a ogni aggiornamento
      const top = scroll.scrollTop;
      scroll.replaceChildren(body);
      scroll.scrollTop = top;
    }

    function setLoading(on) {
      refresh.disabled = Boolean(on);
      view.classList.toggle('loading', Boolean(on));
    }

    return { update, setLoading, showStatus, element: view };
  }

  return { createGitView, edgePath, formatDate, visibleRefs, colorOf, graphWidth, ROW_H, LANE_W, PALETTE };
});
