/* Ricerca nei messaggi delle conversazioni passate (docs/plans/22).
 *
 * Solo Claude Code e Codex: sono file JSONL leggibili. opencode (SQLite) e
 * Antigravity (protobuf) restano cercabili per titolo nelle loro linguette.
 *
 * Niente indice: ~300 MB si scorrono in un paio di secondi, e un indice sarebbe
 * un secondo stato da tenere allineato. Il costo sta tutto nel JSON.parse, quindi
 * il filtro è in due tempi: prima una regex sulla riga grezza (economica, lascia
 * passare anche l'output dei tool), poi i messaggi veri delle sole righe
 * candidate (lib/transcripts.js).
 *
 * Il confronto ignora maiuscole e accenti («perche» trova «Perché») e tratta
 * ogni sequenza di spazi e a capo come uno spazio. Gira in un worker
 * (lib/search-worker.js): nel main bloccherebbe l'output dei terminali.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { claudeSessionFiles, listClaudeSessions, projectsDir } = require('./claude-sessions');
const { codexRolloutFiles, codexIdFromFile, listCodexSessions, sessionsDir } = require('./codex-sessions');
const { parseRecord, claudeMessage, codexMessage } = require('./transcripts');

const MIN_QUERY = 2;
const MAX_QUERY = 200;
const DEFAULT_LIMIT = 50;
const MAX_SNIPPETS = 3;
const SNIPPET_WIDTH = 120;
// Un frammento non comincia a metà parola, se lo spazio è abbastanza vicino
const WORD_EDGE = 20;

/* Piegatura carattere per carattere che non cambia la lunghezza: le posizioni
   trovate nel testo piegato valgono anche nell'originale, dove si taglia il
   frammento. Una lettera accentata diventa la sua base («É» → «e»); quello che
   si scompone in altro (l'hangul in jamo) resta com'è. */
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

/** Query confrontabile col testo piegato: gli spazi iniziali e finali sono significativi. */
function normalizeQuery(query) {
  const composed = String(query == null ? '' : query).normalize('NFC');
  return foldText(composed).replace(/\p{M}/gu, '').replace(/ +/g, ' ');
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex sul testo piegato: gli spazi della query valgono uno o più spazi. */
function textMatcher(q) {
  return new RegExp(q.split(' ').map(escapeRegExp).join(' +'), 'g');
}

/* Sulla riga grezza gli accenti sono ancora lì e il testo è JSON (a capo come
   `\n`, virgolette come `\"`): ogni parola della query deve comparire, con le
   lettere accentate ammesse. È un sovrainsieme del confronto vero. */
const ACCENTED = {
  a: 'aàáâãäå', c: 'cç', e: 'eèéêë', i: 'iìíîï', n: 'nñ', o: 'oòóôõö', u: 'uùúûü', y: 'yýÿ',
};

function rawMatcher(q) {
  const words = q.split(/[\s"\\]+/).filter(Boolean);
  const res = words.map((w) => new RegExp([...w].map((ch) => (ACCENTED[ch] ? `[${ACCENTED[ch]}]` : escapeRegExp(ch))).join(''), 'i'));
  return (line) => res.every((re) => re.test(line));
}

const flat = (s) => s.replace(/\s+/g, ' ');

/**
 * Frammento di ~`width` caratteri intorno a [start, end), diviso in tre per
 * l'evidenziazione: il renderer mette `match` in un <mark> senza toccare HTML.
 * @returns {{ before: string, match: string, after: string }}
 */
function snippet(text, start, end, { width = SNIPPET_WIDTH } = {}) {
  const side = Math.max(0, Math.floor((width - (end - start)) / 2));
  let from = Math.max(0, start - side);
  let to = Math.min(text.length, end + side);
  if (from > 0) {
    const space = text.slice(from, start).search(/\s/);
    if (space >= 0 && space < WORD_EDGE) from += space + 1;
  }
  if (to < text.length) {
    const tail = text.slice(end, to);
    const space = tail.search(/\s\S*$/);
    if (space >= 0 && tail.length - space < WORD_EDGE) to = end + space;
  }
  return {
    before: (from > 0 ? '…' : '') + flat(text.slice(from, start)).trimStart(),
    match: flat(text.slice(start, end)),
    after: flat(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : ''),
  };
}

/** Conta ogni occorrenza; su richiesta restituisce anche tutti i frammenti. */
function matchMessages(messages, q, allSnippets = false) {
  return messages.reduce((acc, m) => {
    const found = [...foldText(m.text).matchAll(textMatcher(q))];
    if (!found.length) return acc;
    const matches = allSnippets ? found : acc.snippets.length < MAX_SNIPPETS ? found.slice(0, 1) : [];
    const snippets = acc.snippets.concat(matches.map((hit) => ({
      role: m.role, at: m.at, ...snippet(m.text, hit.index, hit.index + hit[0].length),
    })));
    return { hits: acc.hits + found.length, snippets };
  }, { hits: 0, snippets: [] });
}

const PICK = { claude: claudeMessage, codex: codexMessage };

/** Punti trovati in un file, o null se nessun messaggio contiene la query. */
function searchFile(file, source, q, rawTest, allSnippets) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(rawTest);
  const messages = lines.map((l) => PICK[source](parseRecord(l))).filter(Boolean);
  const found = matchMessages(messages, q, allSnippets);
  return found.hits ? found : null;
}

/** File candidati di entrambe le fonti, dal più recente. */
function candidateFiles(home, scope) {
  const claudeBase = projectsDir(home);
  const claude = fs.existsSync(claudeBase)
    ? claudeSessionFiles(claudeBase).files.map((f) => ({ source: 'claude', file: f.file, id: f.id }))
    : [];
  const codex = codexRolloutFiles(sessionsDir(home)).map((file) => ({ source: 'codex', file, id: codexIdFromFile(file) }));
  return [...claude, ...codex].filter((c) => !scope || scope.has(`${c.source}:${c.id}`)).reduce((acc, c) => {
    try { return { ...acc, files: acc.files.concat({ ...c, mtime: fs.statSync(c.file).mtimeMs }) }; }
    catch { return { ...acc, skipped: acc.skipped + 1 }; } // sparito fra readdir e stat
  }, { files: [], skipped: 0 });
}

/* Titolo e directory arrivano dai lettori del Resume (Claude ha la sua cache):
   si chiedono solo per le fonti che hanno dato risultati. */
function metadataByFile(found, home) {
  const lister = { claude: listClaudeSessions, codex: listCodexSessions };
  const sources = [...new Set(found.map((f) => f.source))];
  return new Map(sources.flatMap((src) => {
    const r = lister[src](Infinity, { home });
    return (r.sessions || []).map((s) => [s.file, s]);
  }));
}

const CANCELLED = { ok: false, cancelled: true, results: [] };

/**
 * Conversazioni Claude e Codex i cui messaggi contengono `query`, dalla più recente.
 * @param {string} query
 * @param {{ home?: string, limit?: number, scope?: Array<{source: string, id: string}>, allSnippets?: boolean, isCancelled?: () => boolean }} [opts]
 *   `isCancelled` si controlla fra un file e l'altro (lo usa il worker)
 * @returns {{ ok: boolean, error?: string, cancelled?: boolean, query?: string,
 *   results: Array<{ source, id, title, cwd, mtime, hits, snippets }>, truncated?: boolean, skipped?: number }}
 */
function searchConversations(query, { home, limit = DEFAULT_LIMIT, scope, allSnippets = false, isCancelled = () => false } = {}) {
  if (typeof query !== 'string') return { ok: false, error: 'Ricerca non valida.', results: [] };
  const q = normalizeQuery(query);
  if (q.length < MIN_QUERY || !q.trim()) return { ok: false, error: `Scrivi almeno ${MIN_QUERY} caratteri.`, results: [] };
  if (q.length > MAX_QUERY) return { ok: false, error: `Ricerca troppo lunga (massimo ${MAX_QUERY} caratteri).`, results: [] };
  if (scope !== undefined && (!Array.isArray(scope) || scope.some((s) => !s || !['claude', 'codex'].includes(s.source) || typeof s.id !== 'string'))) {
    return { ok: false, error: 'Elenco delle conversazioni non valido.', results: [] };
  }

  if (scope && limit === DEFAULT_LIMIT) limit = Math.max(limit, scope.length);
  const rawTest = rawMatcher(q);
  const allowed = scope && new Set(scope.map((s) => `${s.source}:${s.id}`));
  const candidates = candidateFiles(home, allowed);
  const files = [...candidates.files].sort((a, b) => b.mtime - a.mtime);
  let skipped = candidates.skipped;
  const found = [];
  // Dal più recente: arrivati a limit+1 risultati si sa già che la lista è tagliata
  for (const c of files) {
    if (isCancelled()) return CANCELLED;
    let hit = null;
    try { hit = searchFile(c.file, c.source, q, rawTest, allSnippets); } catch { skipped++; continue; } // illeggibile o in scrittura
    if (hit) found.push({ ...c, ...hit });
    if (found.length > limit) break;
  }
  if (isCancelled()) return CANCELLED;

  const kept = found.slice(0, limit);
  const meta = metadataByFile(kept, home);
  const results = kept.map((f) => {
    const m = meta.get(f.file) || {};
    return {
      source: f.source,
      id: m.id || f.id,
      title: m.title || String(m.id || f.id || path.basename(f.file)).slice(0, 8),
      cwd: m.cwd || '',
      mtime: f.mtime,
      hits: f.hits,
      snippets: f.snippets,
    };
  }).filter((r) => r.id);
  return {
    ok: true,
    query: q,
    results,
    ...(found.length > limit ? { truncated: true } : {}),
    ...(skipped ? { skipped } : {}),
  };
}

module.exports = {
  searchConversations,
  normalizeQuery,
  foldText,
  snippet,
  MIN_QUERY,
  MAX_QUERY,
  DEFAULT_LIMIT,
  MAX_SNIPPETS,
};
