/* Chi ha toccato la riga del cursore nella scheda editor (docs/plans/73):
 * dalla risposta di git blame (lib/editor-git.js) il testo breve in fondo
 * alla riga e il fumetto lungo. Funzioni pure; il cablaggio sta in
 * editor-blame-ui.js, il disegno in editor-monaco.js.
 *
 * Wrapper UMD come editor-gutter.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorBlame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const UNCOMMITTED = 'Modifica non committata';
  const MAX_SUMMARY = 60;
  const MINUTE = 60;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;
  const relative = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
  const absolute = new Intl.DateTimeFormat('it', { dateStyle: 'long', timeStyle: 'short' });

  /**
   * @param {number} seconds istante in secondi dal 1970 (author-time di git)
   * @param {number} [nowMs]
   * @returns {string} «3 giorni fa», «ieri», «adesso»
   */
  function relativeTime(seconds, nowMs = Date.now()) {
    const s = Math.max(0, nowMs / 1000 - seconds);
    if (s < MINUTE) return 'adesso';
    if (s < HOUR) return relative.format(-Math.floor(s / MINUTE), 'minute');
    if (s < DAY) return relative.format(-Math.floor(s / HOUR), 'hour');
    if (s < MONTH) return relative.format(-Math.floor(s / DAY), 'day');
    if (s < YEAR) return relative.format(-Math.floor(s / MONTH), 'month');
    return relative.format(-Math.floor(s / YEAR), 'year');
  }

  const shorten = (text) => (text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text);

  /**
   * @param {object|null} blame da editor-blame-line: {uncommitted: true} o
   *   {hash, author, mail, time, summary}
   * @param {number} [nowMs]
   * @returns {{text: string, title: string}|null} null: niente da mostrare
   */
  function blameInfo(blame, nowMs = Date.now()) {
    if (!blame) return null;
    if (blame.uncommitted) return { text: UNCOMMITTED, title: UNCOMMITTED };
    if (!blame.hash) return null;
    const when = Number.isFinite(blame.time) ? blame.time : null;
    const who = when === null ? blame.author : `${blame.author}, ${relativeTime(when, nowMs)}`;
    const text = blame.summary ? `${who} · ${shorten(blame.summary)}` : who;
    const head = `${blame.hash.slice(0, 7)} · ${blame.author}${blame.mail ? ` <${blame.mail}>` : ''}`;
    const date = when === null ? '' : `\n${absolute.format(new Date(when * 1000))}`;
    return { text, title: `${head}${date}\n\n${blame.summary || ''}`.trimEnd() };
  }

  return { relativeTime, blameInfo };
});
