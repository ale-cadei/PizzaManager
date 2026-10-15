/* Barrette delle righe cambiate nella scheda editor (docs/plans/63): il
 * confronto riga per riga fra il testo di HEAD e quello nell'editor.
 * Funzioni pure: git lo legge il main (lib/editor-git.js), Monaco lo tocca
 * editor-monaco.js, il cablaggio sta in editor-tab.js.
 * Due tetti tengono la pagina reattiva: oltre MAX_GUTTER_LINES righe la
 * risposta è null, cioè niente barrette; oltre MAX_DIFF_STEPS passi del diff
 * il tratto diverso (tolte le righe uguali in cima e in fondo) diventa un
 * blocco solo: meno preciso, ma non dice «uguale a HEAD» a un file riscritto.
 *
 * Wrapper UMD come editor-files.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorGutter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const MAX_GUTTER_LINES = 20000;
  const MAX_DIFF_STEPS = 1000000;

  // Come Monaco: \r\n, \r e \n sono tutti un a capo, e uguali fra loro
  const splitLines = (text) => text.split(/\r\n|\r|\n/);
  const repeat = (op, count) => new Array(count).fill(op);

  /* Dalla V salvata a ogni d si risale al percorso, dalla fine all'inizio. */
  function backtrack(trace, n, m) {
    const ops = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const snap = trace[d]; // snap[k + d + 1] = V[k], k da -d-1 a d+1
      const k = x - y;
      const down = k === -d || (k !== d && snap[k + d] < snap[k + d + 2]);
      const prevK = down ? k + 1 : k - 1;
      const prevX = snap[prevK + d + 1];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push('='); x--; y--; }
      if (d > 0) ops.push(down ? '+' : '-');
      x = prevX;
      y = prevY;
    }
    return ops.reverse();
  }

  /* Myers O(ND). A ogni d si tiene solo la fetta di V che serve a risalire
     (k da -d-1 a d+1): la memoria cresce coi passi, non con N·D.
     Un passo = una diagonale k visitata o una riga uguale saltata lungo la
     diagonale: senza righe uguali il tetto ferma a D ≈ √(2·maxSteps). */
  function myers(a, b, maxSteps) {
    const n = a.length;
    const m = b.length;
    if (!n || !m) return [...repeat('-', n), ...repeat('+', m)];
    const off = n + m + 1;
    const v = new Int32Array(2 * off + 1);
    const trace = [];
    let steps = 0;
    for (let d = 0; d <= n + m; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]);
        let x = down ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; steps++; }
        v[off + k] = x;
        if (++steps > maxSteps) return null;
        if (x >= n && y >= m) return backtrack(trace, n, m);
      }
    }
    return null; // non si arriva qui: a d = n + m il percorso è finito
  }

  /**
   * Le operazioni per passare da `oldLines` a `newLines`: '=' riga uguale,
   * '-' tolta, '+' aggiunta. Oltre `maxSteps` passi il tratto fra le righe
   * uguali in cima e in fondo è tutto tolto e poi tutto aggiunto.
   * @param {string[]} oldLines
   * @param {string[]} newLines
   * @param {{maxSteps?: number}} [o]
   * @returns {string[]}
   */
  function diffLines(oldLines, newLines, { maxSteps = MAX_DIFF_STEPS } = {}) {
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
    let endOld = oldLines.length;
    let endNew = newLines.length;
    while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) { endOld--; endNew--; }
    const middle = myers(oldLines.slice(start, endOld), newLines.slice(start, endNew), maxSteps)
      || [...repeat('-', endOld - start), ...repeat('+', endNew - start)];
    return [...repeat('=', start), ...middle, ...repeat('=', oldLines.length - endOld)];
  }

  /* Un blocco di righe tolte e aggiunte fra due righe uguali: le righe in
     comune sono «modificate», il resto aggiunte o tolte. */
  function rangesFromOps(ops) {
    const out = [];
    let line = 0; // righe del testo nuovo già passate
    let removed = 0;
    let added = 0;
    const flush = () => {
      const before = line - added;
      const mod = Math.min(removed, added);
      if (mod) out.push({ kind: 'mod', from: before + 1, to: before + mod });
      if (added > mod) out.push({ kind: 'add', from: before + mod + 1, to: before + added });
      if (removed > mod) out.push({ kind: 'del', after: before + mod });
      removed = 0;
      added = 0;
    };
    for (const op of ops) {
      if (op === '-') { removed++; continue; }
      if (op === '=') flush();
      else added++;
      line++;
    }
    flush();
    return out;
  }

  /**
   * Le righe dell'editor cambiate rispetto a HEAD.
   * @param {string|null} oldText testo di HEAD; null = il file non c'è in HEAD
   * @param {string} newText testo nell'editor
   * @param {{maxLines?: number, maxSteps?: number}} [o]
   * @returns {Array<{kind: 'add'|'mod', from: number, to: number}|{kind: 'del', after: number}>|null}
   *   righe da 1, estremi compresi; `after` = riga dopo cui mancano righe (0 = in cima).
   *   null: niente barrette (troppe righe, testo mancante)
   */
  function changeRanges(oldText, newText, { maxLines = MAX_GUTTER_LINES, maxSteps = MAX_DIFF_STEPS } = {}) {
    if (typeof newText !== 'string' || (oldText !== null && typeof oldText !== 'string')) return null;
    const newLines = splitLines(newText);
    if (newLines.length > maxLines) return null;
    if (oldText === null) return [{ kind: 'add', from: 1, to: newLines.length }];
    const oldLines = splitLines(oldText);
    if (oldLines.length > maxLines) return null;
    return rangesFromOps(diffLines(oldLines, newLines, { maxSteps }));
  }

  return { MAX_GUTTER_LINES, MAX_DIFF_STEPS, diffLines, changeRanges };
});
