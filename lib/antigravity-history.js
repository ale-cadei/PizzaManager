/* history.jsonl di Antigravity CLI: una riga JSON per prompt.
 *
 *   {"display":"…","timestamp":<ms>,"workspace":"/percorso","conversationId":"<id>"}
 *
 * E' l'unica fonte che dice cartella e ora di una conversazione mentre la
 * sessione e' ancora aperta: la cache dei metadati agy la riscrive solo a fine
 * sessione. Il primo prompt di una conversazione arriva senza
 * `conversationId` (la conversazione nasce in quel momento); i comandi
 * (`type: "slash_command"`) contano per l'ora ma non come titolo.
 *
 * Non e' un'API pubblica: righe rotte o campi di tipo sbagliato si saltano.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = 'history.jsonl';
/* La conversazione nasce all'istante del primo prompt: sul disco vero data di
   nascita del .db e timestamp coincidono al millisecondo. Il margine copre un
   filesystem con risoluzione al secondo. */
const BIRTH_MATCH_MS = 2000;
const ID_MAX = 200;

const isText = (v) => typeof v === 'string' && v.length > 0;

/** Una riga valida, normalizzata; null se va saltata. */
function parseLine(line) {
  let raw;
  try { raw = JSON.parse(line); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const ts = Number(raw.timestamp);
  if (!Number.isFinite(ts) || ts <= 0 || !isText(raw.workspace)) return null;
  return {
    ts,
    cwd: raw.workspace,
    id: isText(raw.conversationId) ? raw.conversationId.slice(0, ID_MAX) : null,
    prompt: raw.type === 'slash_command' || !isText(raw.display) ? null : raw.display,
  };
}

/**
 * @param {string} home cartella di Antigravity CLI
 * @returns {{ byId: Map<string,{cwd:string, mtime:number}>, orphans: Array<{ts:number, cwd:string, prompt:string}> }}
 *   `byId`: cartella e ora dell'ultima riga di ogni conversazione nota;
 *   `orphans`: prompt senza id, cioe' i primi prompt di una conversazione.
 */
function readAgyHistory(home) {
  let text = '';
  try { text = fs.readFileSync(path.join(home, HISTORY_FILE), 'utf8'); } catch { return { byId: new Map(), orphans: [] }; }
  const rows = text.split('\n').filter(Boolean).map(parseLine).filter(Boolean);
  // Map locale, riempita in un passaggio: la history cresce a ogni prompt e
  // copiarla a ogni riga costerebbe un quadrato.
  const byId = new Map();
  for (const r of rows) {
    if (!r.id) continue;
    const prev = byId.get(r.id);
    if (!prev || r.ts > prev.mtime) byId.set(r.id, { cwd: r.cwd, mtime: r.ts });
  }
  const orphans = rows.filter((r) => !r.id && r.prompt).map(({ ts, cwd, prompt }) => ({ ts, cwd, prompt }));
  return { byId, orphans };
}

/** Il primo prompt nato nello stesso istante della conversazione, o null. */
function orphanBornAt(orphans, birthMs) {
  const born = Number(birthMs);
  if (!Number.isFinite(born) || born <= 0) return null;
  const near = orphans.filter((o) => Math.abs(o.ts - born) <= BIRTH_MATCH_MS);
  if (!near.length) return null;
  return near.reduce((best, o) => (Math.abs(o.ts - born) < Math.abs(best.ts - born) ? o : best));
}

module.exports = { readAgyHistory, orphanBornAt, HISTORY_FILE, BIRTH_MATCH_MS };
