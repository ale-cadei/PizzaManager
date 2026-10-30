/* Marcatori di conflitto nel testo di un file (docs/plans/69): dove sono i
 * blocchi e cosa resta scegliendo un lato. Puro, senza DOM: lo usano
 * l'editor (renderer/editor-conflicts.js) e i test.
 *
 *   <<<<<<< HEAD        start
 *   nostro              ours
 *   ||||||| base        base (diff3/zdiff3, facoltativo: si mostra, non si sceglie)
 *   =======             sep
 *   loro                theirs
 *   >>>>>>> feat/x      end
 *
 * Righe da 1, come Monaco. Un `=======` fuori da un blocco aperto è testo
 * (un titolo Markdown), un blocco mai chiuso non è un blocco.
 *
 * Wrapper UMD come editor-route.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessConflictMarkers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const OPEN = /^<{7}(?: (.*))?$/;
  const BASE = /^\|{7}(?: .*)?$/;
  const SEP = /^={7}$/;
  const CLOSE = /^>{7}(?: (.*))?$/;
  const CHOICES = new Set(['ours', 'theirs', 'both']);

  const linesOf = (text) => String(text).split(/\r?\n/);

  /**
   * @param {string} text
   * @returns {Array<{start: number, base: number|null, sep: number, end: number,
   *   ours: [number, number], theirs: [number, number], oursLabel: string, theirsLabel: string}>}
   */
  function parseBlocks(text) {
    const blocks = [];
    let open = null;
    linesOf(text).forEach((line, i) => {
      const n = i + 1;
      const opening = OPEN.exec(line);
      if (opening) { open = { start: n, base: null, sep: null, oursLabel: opening[1] || '' }; return; }
      if (!open) return;
      if (open.sep === null && open.base === null && BASE.test(line)) { open = { ...open, base: n }; return; }
      if (open.sep === null && SEP.test(line)) { open = { ...open, sep: n }; return; }
      const closing = open.sep !== null ? CLOSE.exec(line) : null;
      if (!closing) return;
      blocks.push({
        start: open.start, base: open.base, sep: open.sep, end: n,
        ours: [open.start + 1, (open.base || open.sep) - 1], theirs: [open.sep + 1, n - 1],
        oursLabel: open.oursLabel, theirsLabel: closing[1] || '',
      });
      open = null;
    });
    return blocks;
  }

  /**
   * Il testo col blocco sostituito dalla scelta; null se il blocco non è più
   * dove era (il testo è cambiato) o la scelta non esiste.
   * @param {string} text
   * @param {{start: number, sep: number, end: number, ours: number[], theirs: number[]}} block
   * @param {'ours'|'theirs'|'both'} choice
   * @returns {string|null}
   */
  function applyChoice(text, block, choice) {
    if (!CHOICES.has(choice) || !block) return null;
    const lines = linesOf(text);
    const at = (n) => lines[n - 1];
    if (!OPEN.test(at(block.start) || '') || !SEP.test(at(block.sep) || '') || !CLOSE.test(at(block.end) || '')) return null;
    const side = ([from, to]) => lines.slice(from - 1, to);
    const kept = choice === 'ours' ? side(block.ours)
      : choice === 'theirs' ? side(block.theirs)
        : [...side(block.ours), ...side(block.theirs)];
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    return [...lines.slice(0, block.start - 1), ...kept, ...lines.slice(block.end)].join(eol);
  }

  return { parseBlocks, applyChoice };
});
