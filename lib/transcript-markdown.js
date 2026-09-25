/* Una conversazione in Markdown (docs/plans/23).
 *
 * Funzioni pure: dalle voci di lib/transcripts.js (`claudeTranscript`,
 * `codexTranscript`) al testo del file, e dal titolo al nome proposto. Il fuso
 * è un parametro: i test girano in UTC, l'utente no.
 *
 * Il testo dei messaggi va così com'è, perché è già Markdown. Un'eccezione: un
 * blocco di codice lasciato aperto si chiude, altrimenti tutto il resto del
 * file ci finirebbe dentro.
 */
'use strict';

const AGENT_LABEL = { claude: 'Claude Code', codex: 'Codex' };
const SPEAKER = { user: 'Tu', claude: 'Claude', codex: 'Codex' };
const APP_NAME = 'PizzaManager';
const FILE_TITLE_MAX = 60;
const SHORT_ID = 8;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/* Creare un Intl.DateTimeFormat costa: rifarlo per ognuna delle migliaia di
   voci di una conversazione lunga portava l'export a quasi un secondo. */
let formatters = new Map();

function formatterFor(timeZone) {
  const key = timeZone || '';
  if (!formatters.has(key)) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formatters = new Map(formatters).set(key, fmt);
  }
  return formatters.get(key);
}

/** Giorno e ora di un istante nel fuso richiesto (undefined = quello del sistema), o null. */
function dateParts(value, timeZone) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(formatterFor(timeZone).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute}`, iso: `${p.year}-${p.month}-${p.day}` };
}

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/* Sezioni: una per ogni cambio di chi parla. I tool stanno nella risposta
   dell'agente, anche quando l'agente non ha ancora scritto niente. */
function sections(entries) {
  return entries.reduce((acc, e) => {
    const role = e.role === 'user' ? 'user' : 'assistant';
    const last = acc[acc.length - 1];
    const cur = last && last.role === role ? last : { role, at: null, texts: [], tools: [] };
    const next = e.role === 'tool'
      ? { ...cur, at: cur.at || e.at, tools: [...cur.tools, e.text] }
      : { ...cur, at: cur.at || e.at, texts: [...cur.texts, e.text] };
    return cur === last ? [...acc.slice(0, -1), next] : [...acc, next];
  }, []);
}

/** `_Strumenti:_ `Bash` ×3 · `Edit``: nomi nell'ordine del primo uso, con i conteggi. */
function toolsLine(names) {
  const counts = names.reduce((acc, n) => new Map(acc).set(n, (acc.get(n) || 0) + 1), new Map());
  const list = [...counts].map(([n, c]) => (c > 1 ? `\`${n}\` ×${c}` : `\`${n}\``));
  return `_Strumenti:_ ${list.join(' · ')}`;
}

/* Il recinto ancora aperto a fine testo, o null. Come in CommonMark: chiude
   solo una riga di soli recinti, dello stesso carattere e lunga almeno quanto
   quello che ha aperto (dentro ```` un ```js è testo, dentro ~~~ un ``` pure). */
function openFence(text) {
  return String(text).split('\n').reduce((open, line) => {
    const m = FENCE.exec(line);
    if (!m) return open;
    if (!open) return m[1];
    const closes = m[1][0] === open[0] && m[1].length >= open.length && line.trim() === m[1];
    return closes ? null : open;
  }, null);
}

function closeFences(text) {
  const open = openFence(text);
  return open ? `${text}\n${open}` : text;
}

function sectionBody(s) {
  const parts = s.texts.map(closeFences);
  return (s.tools.length ? [...parts, toolsLine(s.tools)] : parts).join('\n\n');
}

/* Titoli di sezione con l'ora; la data solo quando cambia giorno rispetto a
   quello prima (il primo giorno sta già nell'intestazione). */
function headings(list, { source, timeZone, firstDay }) {
  return list.reduce((acc, s) => {
    const who = s.role === 'user' ? SPEAKER.user : SPEAKER[source];
    const p = dateParts(s.at, timeZone);
    if (!p) return { day: acc.day, out: [...acc.out, `## ${who}`] };
    const when = p.day === acc.day ? p.time : `${p.day} ${p.time}`;
    return { day: p.day, out: [...acc.out, `## ${who} · ${when}`] };
  }, { day: firstDay, out: [] }).out;
}

function dateRange(first, last) {
  if (!first) return null;
  if (first.day !== last.day) return `${first.day} ${first.time} → ${last.day} ${last.time}`;
  if (first.time !== last.time) return `${first.day} ${first.time} → ${last.time}`;
  return `${first.day} ${first.time}`;
}

/**
 * @param {{ source: 'claude'|'codex', id: string, title: string, cwd?: string,
 *   entries: Array<{ role: 'user'|'assistant'|'tool', text: string, at: string|null }>,
 *   exportedAt?: string|Date, timeZone?: string }} o
 * @returns {string}
 */
function toMarkdown({ source, id, title, cwd, entries, exportedAt = new Date(), timeZone }) {
  const partsOf = (e) => (e ? dateParts(e.at, timeZone) : null);
  const first = partsOf(entries.find((e) => dateParts(e.at, timeZone)));
  const last = partsOf(entries.findLast((e) => dateParts(e.at, timeZone)));
  const exported = dateParts(exportedAt, timeZone);
  const header = [
    `# ${oneLine(title) || String(id).slice(0, SHORT_ID)}`,
    '',
    cwd ? `- **Progetto:** \`${cwd}\`` : null,
    `- **Agente:** ${AGENT_LABEL[source] || source}`,
    dateRange(first, last) ? `- **Date:** ${dateRange(first, last)}` : null,
    `- **Id:** \`${id}\``,
    exported ? `- **Esportata:** ${exported.day} ${exported.time} da ${APP_NAME}` : null,
  ].filter((l) => l !== null);
  const list = sections(entries);
  const titles = headings(list, { source, timeZone, firstDay: first ? first.day : null });
  const body = list.map((s, i) => `${titles[i]}\n\n${sectionBody(s)}`);
  return `${header.join('\n')}\n\n---\n\n${body.join('\n\n')}\n`;
}

/** Minuscole, senza accenti, solo `[a-z0-9-]`: vale come nome di file ovunque. */
function slug(text) {
  return String(text || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, FILE_TITLE_MAX)
    .replace(/-+$/, '');
}

/**
 * Nome proposto: `AAAA-MM-GG-titolo.md`, con la data della conversazione.
 * @param {{ title: string, id: string, date: string|null, timeZone?: string }} o
 */
function exportFileName({ title, id, date, timeZone }) {
  const name = slug(title) || slug(String(id || '').slice(0, SHORT_ID)) || 'conversazione';
  const p = dateParts(date, timeZone);
  return `${p ? `${p.iso}-` : ''}${name}.md`;
}

module.exports = { toMarkdown, exportFileName };
