/* Ricerca nel testo visibile delle shell aperte. Con tmux arriva capture-pane;
   senza tmux arrivano le righe del buffer xterm. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessShellSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const PREVIEW = 3;
  const WIDTH = 120;
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function foldChar(ch) {
    if (/\s/.test(ch)) return ' ';
    const parts = ch.normalize('NFD');
    const base = parts.length > 1 && /^\P{M}\p{M}+$/u.test(parts) ? parts.charAt(0) : ch;
    const lower = base.toLowerCase();
    return lower.length === 1 ? lower : base;
  }

  function foldText(text) {
    return String(text).replace(/[A-Z]|[^\x00-\x7f]|\s/g, foldChar);
  }

  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\r\n?/g, '\n');
  }

  function snippet(text, start, end) {
    const side = Math.max(0, Math.floor((WIDTH - end + start) / 2));
    const from = Math.max(0, start - side);
    const to = Math.min(text.length, end + side);
    const flat = (s) => s.replace(/\s+/g, ' ');
    return {
      role: 'terminal', at: null,
      before: (from ? '…' : '') + flat(text.slice(from, start)).trimStart(),
      match: flat(text.slice(start, end)),
      after: flat(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : ''),
    };
  }

  function search(text, query, { allSnippets = false } = {}) {
    const q = foldText(String(query == null ? '' : query).normalize('NFC')).replace(/\p{M}/gu, '').replace(/ +/g, ' ');
    if (q.length < 2 || !q.trim()) return { hits: 0, snippets: [] };
    const plain = clean(text);
    const re = new RegExp(q.split(' ').map(escapeRegExp).join(' +'), 'g');
    const snippets = [];
    let hits = 0;
    for (const match of foldText(plain).matchAll(re)) {
      hits++;
      if (allSnippets || snippets.length < PREVIEW) snippets.push(snippet(plain, match.index, match.index + match[0].length));
    }
    return { hits, snippets };
  }

  return { search, clean };
});
