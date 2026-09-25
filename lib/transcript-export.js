/* Trovare e leggere una conversazione da esportare in Markdown (docs/plans/23).
 *
 * Il renderer manda solo `{ source, id }`. L'id non entra mai in un percorso:
 * il file si cerca fra quelli che i lettori del Resume elencano, quindi un id
 * inventato non può far leggere niente fuori dalle cartelle delle conversazioni.
 *
 * Il file si legge intero (il più grosso visto è 25 MB: 30-60 ms di lettura
 * asincrona, ~70 ms di conversione). Niente worker: è un clic esplicito, e il
 * main si ferma meno di quanto l'utente impieghi a vedere il dialog.
 */
'use strict';
const fs = require('fs');
const { claudeSessionFiles, sessionFromLines, projectsDir, cwdFromProjectDir } = require('./claude-sessions');
const { codexRolloutFiles, codexIdFromFile, rolloutFromLines, codexTitle, loadSessionIndex, sessionsDir } = require('./codex-sessions');
const { claudeTranscript, codexTranscript } = require('./transcripts');
const { toMarkdown, exportFileName } = require('./transcript-markdown');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID = 8;

const fail = (error) => ({ ok: false, error });
const errorText = (e) => String((e && e.message) || e);

function findClaude(id, home) {
  let listed = null;
  try { listed = claudeSessionFiles(projectsDir(home)); } catch { return null; } // nessuna cartella di Claude
  const hit = listed.files.find((f) => f.id === id);
  return hit ? { file: hit.file, projectDir: hit.projectDir } : null;
}

function findCodex(id, home) {
  const file = codexRolloutFiles(sessionsDir(home)).find((f) => codexIdFromFile(f) === id);
  return file ? { file } : null;
}

/* Per fonte: dove sta il file, come leggerne titolo e cwd, come leggerne i
   messaggi. Titolo e cwd vengono dagli stessi lettori del Resume. */
const SOURCES = {
  claude: {
    find: findClaude,
    meta: (lines, { id, found }) => sessionFromLines(lines, { id, fallbackCwd: cwdFromProjectDir(found.projectDir) }),
    entries: claudeTranscript,
  },
  codex: {
    find: findCodex,
    meta: (lines, { id, home }) => {
      const parsed = rolloutFromLines(lines);
      return parsed
        ? { title: codexTitle(parsed, loadSessionIndex(home)), cwd: parsed.cwd }
        : { title: id.slice(0, SHORT_ID), cwd: '' };
    },
    entries: codexTranscript,
  },
};

function validate(req) {
  const { source, id } = req || {};
  if (!Object.prototype.hasOwnProperty.call(SOURCES, source)) return fail('Si esportano solo le conversazioni di Claude Code e Codex.');
  if (typeof id !== 'string' || !UUID.test(id)) return fail('Id della conversazione non valido.');
  return null;
}

/**
 * @param {{ source: 'claude'|'codex', id: string }} req
 * @param {{ home?: string }} [opts] home diversa solo nei test
 * @returns {Promise<{ ok: true, source, id, title, cwd, entries } | { ok: false, error: string }>}
 */
async function readConversation(req, { home } = {}) {
  const invalid = validate(req);
  if (invalid) return invalid;
  const { source, id } = req;
  const src = SOURCES[source];
  const found = src.find(id, home);
  if (!found) return fail('Conversazione non trovata: il file potrebbe essere stato spostato o cancellato.');
  let raw = '';
  try { raw = await fs.promises.readFile(found.file, 'utf8'); } catch (e) { return fail('Conversazione non leggibile: ' + errorText(e)); }
  const lines = raw.split('\n');
  const entries = src.entries(lines);
  if (!entries.some((e) => e.role !== 'tool')) return fail('Niente da esportare: la conversazione non ha ancora messaggi.');
  const { title, cwd } = src.meta(lines, { id, home, found });
  return { ok: true, source, id, title, cwd, entries };
}

/**
 * Il Markdown della conversazione e il nome di file da proporre.
 * @param {{ source: string, id: string }} req
 * @param {{ home?: string, timeZone?: string, exportedAt?: string|Date }} [opts]
 * @returns {Promise<{ ok: true, markdown: string, fileName: string } | { ok: false, error: string }>}
 */
async function buildExport(req, { home, timeZone, exportedAt = new Date() } = {}) {
  const conv = await readConversation(req, { home });
  if (!conv.ok) return conv;
  const first = conv.entries.find((e) => e.at);
  return {
    ok: true,
    markdown: toMarkdown({ ...conv, exportedAt, timeZone }),
    fileName: exportFileName({ title: conv.title, id: conv.id, date: first ? first.at : null, timeZone }),
  };
}

module.exports = { readConversation, buildExport };
