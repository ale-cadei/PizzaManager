/* Mappa dei branch della sessione git (docs/plans/31-mappa-branch.md): il
 * tronco orizzontale, ogni branch che se ne stacca sopra o sotto.
 *
 * Colonne e corsie arrivano già calcolate dal main (lib/git-branch-map.js):
 * qui diventano pixel. Linee e pallini sono un <svg>; i nomi dei branch sono
 * pulsanti sopra il disegno, così si raggiungono anche da tastiera.
 *
 * Nomi e messaggi vengono dal repository: entrano con textContent, mai HTML.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessGitMapView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COL_W = 18; // lib/git-branch-map.js conta ~2,5 caratteri del nome per colonna
  const LANE_H = 44;
  const PAD_X = 28;
  const PAD_Y = 36;
  const DOT_R = 4;
  const HEAD_R = 6;
  const CURVE_R = 10;
  const HASH_LEN = 7;
  const TRUNK_COLOR = 'var(--type-git)';

  const colX = (col) => PAD_X + col * COL_W;
  const laneY = (lane, minLane) => PAD_Y + (lane - minLane) * LANE_H;

  /** Dal punto di stacco sulla corsia del padre, su (o giù) e poi a destra fino all'ultimo commit. */
  function branchPath(line, minLane) {
    const y = laneY(line.lane, minLane);
    const xEnd = colX(line.endCol);
    if (line.forkCol === null) return `M${colX(line.startCol) - COL_W} ${y}H${xEnd}`;
    const x = colX(line.forkCol);
    const from = laneY(line.parentLane, minLane);
    const turn = y < from ? CURVE_R : -CURVE_R;
    return `M${x} ${from}V${y + turn}Q${x} ${y} ${x + CURVE_R} ${y}H${xEnd}`;
  }

  /** Dall'ultimo commit del branch al commit di merge sul tronco: lo stacco, rovesciato. */
  function mergePath(line, minLane) {
    const y = laneY(line.lane, minLane);
    const to = laneY(0, minLane);
    const x = colX(line.mergeCol);
    const turn = to > y ? CURVE_R : -CURVE_R;
    return `M${colX(line.endCol)} ${y}H${x - CURVE_R}Q${x} ${y} ${x} ${y + turn}V${to}`;
  }

  const WHERE = { local: 'solo locale', remote: 'solo sul remoto', both: 'locale e remoto', null: 'branch cancellato' };
  const SYNC = { behind: ' (il locale è indietro: manca un pull)', ahead: ' (il locale è avanti: da pushare)', diverged: ' (locale e remoto separati)' };
  const pad = (n) => String(n).padStart(2, '0');
  /** "28/09" nell'ora locale: il giorno del merge accanto al nome. */
  function shortDay(iso) {
    const d = new Date(iso);
    return !iso || Number.isNaN(d.getTime()) ? '' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  }

  /** Testo del suggerimento sul nome: dove esiste, da dove nasce, quanti commit, quando è stato unito. */
  function describe(line, { trunk, parentName, formatDate }) {
    if (!line.parent) return `${line.name} · linea principale · ${line.count} commit`;
    const parts = [line.name + (line.head ? ' (branch corrente)' : '') + (line.pr ? ` · PR #${line.pr}` : '')];
    parts.push(WHERE[line.where] + (SYNC[line.sync] || ''));
    parts.push(line.count ? `${line.count} commit propri` : 'nessun commit proprio');
    if (line.incomplete) parts.push('nato prima dei commit letti');
    else parts.push(`nato da ${parentName} in ${line.fork.slice(0, HASH_LEN)}`);
    if (line.merged) parts.push(line.mergeDate ? `unito in ${trunk.name} il ${formatDate(line.mergeDate)}` : `già contenuto in ${trunk.name}`);
    return parts.join(' · ') + '\nClic: apri nella timeline';
  }

  /** Nome del branch, con PR e giorno del merge; sta sopra la sua linea (il tronco: a destra). */
  function drawLabel(document, line, { y, color, title }) {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'git-map-label' + (line.head ? ' git-map-label--head' : '') + (line.merged ? ' git-map-label--merged' : '')
      + (line.where === 'remote' ? ' git-map-label--remote' : '') + (line.where === null ? ' git-map-label--gone' : '');
    label.textContent = line.name;
    const extra = (cls, text) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      label.appendChild(span);
    };
    if (line.pr) extra('git-map-pr', ` #${line.pr}`);
    if (line.merged) extra('git-map-when', ` ✓ ${shortDay(line.mergeDate)}`.trimEnd());
    label.title = title;
    label.setAttribute('data-branch', line.id);
    label.style.setProperty('--line-color', color);
    if (!line.parent) {
      label.style.left = (colX(line.endCol) + CURVE_R + 4) + 'px';
      label.style.top = (y - 10) + 'px';
    } else {
      const x = line.forkCol === null ? colX(line.startCol) - COL_W : colX(line.forkCol) + CURVE_R;
      label.style.left = (x + 2) + 'px';
      label.style.top = (y - 24) + 'px';
    }
    return label;
  }

  /**
   * @param {{document: Document, layout: {lines: object[], columns: number, minLane: number, maxLane: number},
   *   formatDate: (iso: string) => string, colorOf?: (line: object) => string, onPick?: (tip: string) => void}} o
   * @returns {{element: HTMLElement, trunkY: number}}
   */
  function createBranchMap({ document, layout, formatDate, colorOf = () => TRUNK_COLOR, onPick }) {
    const { lines, minLane, maxLane } = layout;
    const trunk = lines[0];
    const width = colX(layout.columns) + PAD_X;
    const height = PAD_Y * 2 + (maxLane - minLane) * LANE_H;
    const byId = new Map(lines.map((l) => [l.id, l]));
    const colors = new Map(lines.map((l) => [l.id, l.parent ? colorOf(l) : TRUNK_COLOR]));
    const lit = []; // elementi che si illuminano: ognuno ha data-branch

    // I colori passano da style: un attributo SVG non capisce var(--type-git)
    const svgEl = (tag, attrs, color) => {
      const e = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (color) e.style.setProperty('--line-color', color);
      if (attrs['data-branch'] !== undefined) lit.push(e);
      return e;
    };

    const canvas = document.createElement('div');
    canvas.className = 'git-map';
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const svg = svgEl('svg', { class: 'git-map-svg', width, height, 'aria-hidden': 'true' });
    const paths = svgEl('g', { class: 'git-map-lines' });
    const dots = svgEl('g', {});

    const y0 = laneY(0, minLane);
    paths.appendChild(svgEl('path', { d: `M${colX(trunk.startCol)} ${y0}H${colX(trunk.endCol)}`, 'data-branch': trunk.id }, TRUNK_COLOR));
    for (const line of lines.slice(1)) {
      const color = colors.get(line.id);
      const dashed = line.incomplete || !line.count ? ' git-map-line--dashed' : '';
      paths.appendChild(svgEl('path', { d: branchPath(line, minLane), class: 'git-map-line' + dashed, 'data-branch': line.id }, color));
      if (line.mergeCol !== null) paths.appendChild(svgEl('path', { d: mergePath(line, minLane), class: 'git-map-line git-map-line--merge', 'data-branch': line.id }, color));
    }
    for (const line of lines) {
      const y = laneY(line.lane, minLane);
      for (const d of line.dots) {
        const isTip = line.head && d.hash === line.tip;
        const circle = svgEl('circle', {
          cx: colX(d.col), cy: y, r: isTip ? HEAD_R : DOT_R,
          class: 'git-map-dot' + (d.merge ? ' git-map-dot--merge' : '') + (isTip ? ' git-map-dot--head' : ''),
          'data-branch': line.id,
        }, colors.get(line.id));
        const title = svgEl('title', {});
        title.textContent = `${d.hash.slice(0, HASH_LEN)} ${d.subject}\n${formatDate(d.date)}`;
        circle.appendChild(title);
        dots.appendChild(circle);
      }
    }
    for (const gap of trunk.gaps) {
      const text = svgEl('text', { x: colX(gap.col), y: y0, class: 'git-map-gap', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      text.textContent = `+${gap.count}`;
      const title = svgEl('title', {});
      title.textContent = `${gap.count} commit di ${trunk.name} senza branch che ne escono`;
      text.appendChild(title);
      dots.appendChild(text);
    }
    svg.appendChild(paths);
    svg.appendChild(dots);
    canvas.appendChild(svg);

    /** Il branch e la strada fino al tronco; null spegne tutto. */
    function highlight(id) {
      const path = new Set();
      for (let l = byId.get(id); l; l = byId.get(l.parent)) path.add(l.id);
      canvas.classList.toggle('git-map--lit', id !== null);
      for (const e of lit) e.classList.toggle('is-lit', path.has(e.getAttribute('data-branch')));
    }

    for (const line of lines) {
      const parent = byId.get(line.parent);
      const title = describe(line, { trunk, parentName: parent ? parent.name : '', formatDate });
      const label = drawLabel(document, line, { y: laneY(line.lane, minLane), color: colors.get(line.id), title });
      label.addEventListener('click', () => onPick && onPick(line.tip));
      label.addEventListener('mouseenter', () => highlight(line.id));
      label.addEventListener('mouseleave', () => highlight(null));
      label.addEventListener('focus', () => highlight(line.id));
      label.addEventListener('blur', () => highlight(null));
      lit.push(label);
      canvas.appendChild(label);
    }
    return { element: canvas, trunkY: y0 };
  }

  return { createBranchMap, branchPath, mergePath, describe, colX, laneY, COL_W, LANE_H };
});
