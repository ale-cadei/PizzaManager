/* Il markdown delle celle di un notebook (docs/plans/77), in un albero di
 * blocchi e inline che notebook-view.js disegna con createElement. Copre
 * quello che si scrive nei notebook: titoli, paragrafi, liste, citazioni,
 * codice, tabelle, enfasi, link, immagini. L'HTML non si interpreta: resta
 * testo. Non è CommonMark completo, e non vuole esserlo.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessNotebookMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
  const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
  const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^ {0,3}> ?(.*)$/;
  const LIST = /^( {0,3})([-*+]|(\d{1,9})[.)])(?:(\s+)(.*))?$/;
  const SETEXT = /^ {0,3}(=+|-+)\s*$/;
  const DELIM_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const PUNCT = /[!-/:-@[-`{-~]/;
  const AUTOLINK = /^<((?:https?|mailto):[^\s<>]+)>/i;
  const EMPHASIS = ['~~', '**', '__', '*', '_'];

  const blank = (line) => !line.trim();
  const indentOf = (line) => line.match(/^ */)[0].length;

  /* ---------- inline ---------- */

  /** Lunghezza della serie di `ch` che parte da `i`. */
  function runAt(s, i, ch) {
    let j = i;
    while (s[j] === ch) j++;
    return j - i;
  }

  /** Dove si chiude uno span di codice aperto da `n` backtick; -1 se non si chiude. */
  function codeEnd(s, from, n) {
    for (let j = s.indexOf('`', from); j >= 0; j = s.indexOf('`', j)) {
      const len = runAt(s, j, '`');
      if (len === n) return j;
      j += len;
    }
    return -1;
  }

  /** Il `]` che chiude il `[` in `i`, saltando escape e parentesi annidate. */
  function closingBracket(s, i) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '[') depth++;
      if (s[j] === ']' && --depth === 0) return j;
    }
    return -1;
  }

  /** `[etichetta](destinazione "titolo")` da `i`; null se non è un link. */
  function linkAt(s, i) {
    const close = closingBracket(s, i);
    if (close < 0 || s[close + 1] !== '(') return null;
    const m = /^\(\s*(<[^<>\n]*>|[^\s()]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/.exec(s.slice(close + 1));
    if (!m) return null;
    const href = m[1].replace(/^<(.*)>$/, '$1');
    return { label: s.slice(i + 1, close), href, end: close + 1 + m[0].length };
  }

  const alnum = (ch) => Boolean(ch) && /[\p{L}\p{N}]/u.test(ch);
  const space = (ch) => !ch || /\s/.test(ch);

  /* Dove si chiude l'enfasi `d` aperta prima di `from`. Una serie più lunga
     del delimitatore chiude con la sua coda (`**a *b***`); per quello singolo
     una serie di due è un'altra enfasi e si salta. */
  function emphasisEnd(s, from, d) {
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '`') {
        const n = runAt(s, j, '`');
        const end = codeEnd(s, j + n, n);
        j = (end < 0 ? j + n : end + n) - 1;
        continue;
      }
      if (s[j] !== d[0]) continue;
      const n = runAt(s, j, d[0]);
      const at = j + n - d.length;
      const fits = d.length === 1 ? n !== 2 : n >= d.length;
      const closes = fits && at > from && !space(s[at - 1]) && !(d[0] === '_' && alnum(s[j + n]));
      if (closes) return at;
      j += n - 1;
    }
    return -1;
  }

  function emphasisAt(s, i) {
    for (const d of EMPHASIS) {
      if (!s.startsWith(d, i) || space(s[i + d.length])) continue;
      if (d[0] === '_' && alnum(s[i - 1])) continue;
      const end = emphasisEnd(s, i + d.length, d);
      if (end < 0) continue;
      const type = d === '~~' ? 'del' : d.length === 2 ? 'strong' : 'em';
      return { node: { type, children: parseInline(s.slice(i + d.length, end)) }, end: end + d.length };
    }
    return null;
  }

  /**
   * @param {string} src testo di un paragrafo, titolo o cella
   * @returns {object[]} nodi `text`, `code`, `strong`, `em`, `del`, `link`, `image`, `break`
   */
  function parseInline(src) {
    const s = typeof src === 'string' ? src : '';
    const out = [];
    let buf = '';
    const push = (node) => {
      if (buf) out.push({ type: 'text', text: buf });
      buf = '';
      out.push(node);
    };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '\n') { push({ type: 'break' }); i += 2; continue; }
      if (c === '\\' && PUNCT.test(s[i + 1] || '')) { buf += s[i + 1]; i += 2; continue; }
      if (c === '\n' && / {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); push({ type: 'break' }); i++; continue; }
      if (c === '`') {
        const n = runAt(s, i, '`');
        const end = codeEnd(s, i + n, n);
        if (end < 0) { buf += s.slice(i, i + n); i += n; continue; }
        const code = s.slice(i + n, end).replace(/\n/g, ' ');
        push({ type: 'code', text: /^ .* $/.test(code) && code.trim() ? code.slice(1, -1) : code });
        i = end + n;
        continue;
      }
      const link = c === '[' ? linkAt(s, i) : c === '!' && s[i + 1] === '[' ? linkAt(s, i + 1) : null;
      if (link && c === '!') { push({ type: 'image', src: link.href, alt: link.label }); i = link.end; continue; }
      if (link) { push({ type: 'link', href: link.href, children: parseInline(link.label) }); i = link.end; continue; }
      const auto = c === '<' ? AUTOLINK.exec(s.slice(i)) : null;
      if (auto) { push({ type: 'link', href: auto[1], children: [{ type: 'text', text: auto[1] }] }); i += auto[0].length; continue; }
      const em = emphasisAt(s, i);
      if (em) { push(em.node); i = em.end; continue; }
      buf += c;
      i++;
    }
    if (buf) out.push({ type: 'text', text: buf });
    return out;
  }

  /* ---------- blocchi ---------- */

  /** Celle di una riga di tabella: `|` dentro il codice o con `\` non divide. */
  function tableCells(line) {
    const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (s[i] === '`') {
        const n = runAt(s, i, '`');
        const end = codeEnd(s, i + n, n);
        const stop = end < 0 ? i + n : end + n;
        cur += s.slice(i, stop);
        i = stop - 1;
        continue;
      }
      if (s[i] === '|') { cells.push(cur); cur = ''; continue; }
      cur += s[i];
    }
    return [...cells, cur].map((c) => c.trim());
  }

  const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length
    && lines[i + 1].includes('|') && DELIM_ROW.test(lines[i + 1]);

  function alignOf(cell) {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    return right ? 'right' : left ? 'left' : null;
  }

  function parseTable(lines, i) {
    const head = tableCells(lines[i]);
    const align = tableCells(lines[i + 1]).map(alignOf);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && !blank(lines[j]) && lines[j].includes('|'); j++) {
      const cells = tableCells(lines[j]);
      rows.push(head.map((_, k) => parseInline(cells[k] || '')));
    }
    return { block: { type: 'table', align: head.map((_, k) => align[k] || null), head: head.map(parseInline), rows }, next: j };
  }

  function parseFence(lines, i) {
    const [, marker, lang] = FENCE.exec(lines[i]);
    // Si chiude con una serie dello stesso carattere, lunga almeno quanto l'apertura
    const closes = (line) => {
      const t = line.trim();
      return runAt(t, 0, marker[0]) >= marker.length && !t.replace(/^[`~]+/, '');
    };
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !closes(lines[j]); j++) body.push(lines[j]);
    return { block: { type: 'code', lang, text: body.join('\n') }, next: j + 1 };
  }

  function parseQuote(lines, i) {
    const body = [];
    let j = i;
    for (; j < lines.length && QUOTE.test(lines[j]); j++) body.push(QUOTE.exec(lines[j])[1]);
    return { block: { type: 'quote', blocks: parseBlocks(body) }, next: j };
  }

  /* Un elemento: la prima riga e quelle rientrate almeno quanto il suo testo
     (anche dopo righe vuote), più le righe di paragrafo «pigre» non rientrate. */
  function listItem(lines, i) {
    const m = LIST.exec(lines[i]);
    const indent = m[1].length + m[2].length + (m[4] ? m[4].length : 1);
    const body = [m[5] || ''];
    let j = i + 1;
    while (j < lines.length) {
      if (blank(lines[j])) {
        let k = j;
        while (k < lines.length && blank(lines[k])) k++;
        if (k >= lines.length || indentOf(lines[k]) < indent) break;
        body.push(...lines.slice(j, k).map(() => ''));
        j = k;
        continue;
      }
      if (indentOf(lines[j]) >= indent) { body.push(lines[j].slice(indent)); j++; continue; }
      if (startsBlock(lines, j)) break;
      body.push(lines[j].trimStart());
      j++;
    }
    return { blocks: parseBlocks(body), next: j };
  }

  function parseList(lines, i) {
    const first = LIST.exec(lines[i]);
    const ordered = Boolean(first[3]);
    const items = [];
    let j = i;
    for (;;) {
      const m = j < lines.length && !HR.test(lines[j]) ? LIST.exec(lines[j]) : null;
      if (!m || Boolean(m[3]) !== ordered) break;
      const item = listItem(lines, j);
      items.push(item.blocks);
      j = item.next;
    }
    return { block: { type: 'list', ordered, start: ordered ? Number(first[3]) : 1, items }, next: j };
  }

  function startsBlock(lines, i) {
    const line = lines[i];
    return FENCE.test(line) || ATX.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line);
  }

  function parseParagraph(lines, i) {
    const body = [lines[i].trimStart()];
    let j = i + 1;
    for (; j < lines.length && !blank(lines[j]); j++) {
      const setext = SETEXT.exec(lines[j]);
      if (setext) {
        const level = setext[1][0] === '=' ? 1 : 2;
        return { block: { type: 'heading', level, inlines: parseInline(body.join('\n')) }, next: j + 1 };
      }
      if (startsBlock(lines, j)) break;
      body.push(lines[j].trimStart());
    }
    return { block: { type: 'paragraph', inlines: parseInline(body.join('\n')) }, next: j };
  }

  function blockAt(lines, i) {
    const line = lines[i];
    if (FENCE.test(line)) return parseFence(lines, i);
    const atx = ATX.exec(line);
    if (atx) return { block: { type: 'heading', level: atx[1].length, inlines: parseInline(atx[2] || '') }, next: i + 1 };
    if (HR.test(line)) return { block: { type: 'hr' }, next: i + 1 };
    if (QUOTE.test(line)) return parseQuote(lines, i);
    if (LIST.test(line)) return parseList(lines, i);
    if (isTableStart(lines, i)) return parseTable(lines, i);
    return parseParagraph(lines, i);
  }

  function parseBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      if (blank(lines[i])) { i++; continue; }
      const { block, next } = blockAt(lines, i);
      blocks.push(block);
      i = next;
    }
    return blocks;
  }

  /**
   * @param {string} text il sorgente di una cella markdown
   * @returns {object[]} blocchi `heading`, `paragraph`, `code`, `quote`, `list`, `table`, `hr`
   */
  function parseMarkdown(text) {
    if (typeof text !== 'string') return [];
    return parseBlocks(text.replace(/\t/g, '    ').split(/\r\n|\r|\n/));
  }

  return { parseMarkdown, parseInline };
});
