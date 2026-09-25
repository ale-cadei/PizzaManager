/* I messaggi di una conversazione: quello che l'utente ha scritto e quello
 * che l'agente ha risposto. Niente output dei tool, niente ragionamenti,
 * niente contesto iniettato (system-reminder, comandi, IDE…).
 *
 * Funzioni pure, dalle righe già lette ai messaggi `{ role, text, at }`, con
 * `role` 'user' | 'assistant'. Le usa la ricerca (lib/conversation-search.js)
 * e le userà l'export in Markdown (docs/plans/23): la conoscenza dei formati
 * sta qui e in lib/claude-sessions.js, non si ricopia.
 *
 * Una riga per volta (`claudeMessage`, `codexMessage`) perché la ricerca
 * analizza solo le righe che passano il filtro grezzo.
 *
 * L'export vuole anche sapere quali tool ha usato l'agente fra un messaggio e
 * l'altro (`claudeTranscript`, `codexTranscript`): voci `{ role: 'tool', text }`
 * col solo nome. Gli argomenti restano fuori: un comando può contenere un
 * token, e il file è fatto per essere condiviso.
 */
'use strict';
const { userMessageText, contentText } = require('./claude-sessions');

/** Oggetto di una riga JSONL, o null (riga vuota, troncata, non JSON). */
function parseRecord(line) {
  const t = String(line).trim();
  if (!t.startsWith('{')) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function message(role, text, obj) {
  return { role, text, at: typeof obj.timestamp === 'string' ? obj.timestamp : null };
}

/* Righe di Claude che hanno forma di messaggio ma non sono la conversazione:
   il riassunto della compattazione, i sotto-agenti, gli errori delle API e le
   risposte sintetiche che Claude Code scrive da sé. */
function notConversation(obj) {
  return !!(obj.isSidechain || obj.isCompactSummary || obj.isApiErrorMessage || obj.isMeta)
    || (obj.message && obj.message.model === '<synthetic>');
}

/** Messaggio di una riga di Claude Code, o null. Dell'assistente solo i blocchi
 *  `text`: `tool_use` e `thinking` non sono risposte. */
function claudeMessage(obj) {
  if (!obj || !obj.message || notConversation(obj)) return null;
  if (obj.message.role === 'user') {
    const text = userMessageText(obj);
    return text ? message('user', text, obj) : null;
  }
  if (obj.message.role === 'assistant') {
    const text = contentText(obj.message.content).trim();
    return text ? message('assistant', text, obj) : null;
  }
  return null;
}

const CODEX_ROLES = { user_message: 'user', agent_message: 'assistant' };

/** Messaggio di una riga di un rollout Codex, o null. I messaggi stanno negli
 *  `event_msg`; i `response_item` ripetono gli stessi testi insieme al
 *  contesto iniettato e agli output dei tool, quindi si ignorano. */
function codexMessage(obj) {
  if (!obj || obj.type !== 'event_msg' || !obj.payload) return null;
  const role = CODEX_ROLES[obj.payload.type];
  if (!role || typeof obj.payload.message !== 'string') return null;
  const text = obj.payload.message.trim();
  return text ? message(role, text, obj) : null;
}

/** Nomi dei tool chiamati in una riga di Claude Code (blocchi `tool_use`). */
function claudeTools(obj) {
  if (!obj || !obj.message || notConversation(obj) || obj.message.role !== 'assistant') return [];
  const content = obj.message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b && b.type === 'tool_use' && typeof b.name === 'string' && b.name)
    .map((b) => b.name);
}

const CALL_SUFFIX = '_call';

/** Nome del tool chiamato in una riga di un rollout Codex: `function_call` e
 *  `custom_tool_call` hanno un nome, `web_search_call` e simili no e si
 *  chiamano come il tipo. Gli `*_call_output` sono risultati, non chiamate. */
function codexTools(obj) {
  if (!obj || obj.type !== 'response_item' || !obj.payload) return [];
  const { type, name } = obj.payload;
  if (typeof type !== 'string' || !type.endsWith(CALL_SUFFIX)) return [];
  return [typeof name === 'string' && name ? name : type.slice(0, -CALL_SUFFIX.length)];
}

const messagesWith = (pick) => (lines) => lines.map((l) => pick(parseRecord(l))).filter(Boolean);

/* Messaggi e tool nell'ordine del file. In una riga di Claude il testo viene
   prima dei tool_use che annuncia. */
const transcriptWith = (pickMessage, pickTools) => (lines) => lines.flatMap((l) => {
  const obj = parseRecord(l);
  const msg = pickMessage(obj);
  const tools = pickTools(obj).map((name) => message('tool', name, obj));
  return msg ? [msg, ...tools] : tools;
});

module.exports = {
  parseRecord,
  claudeMessage,
  codexMessage,
  claudeMessages: messagesWith(claudeMessage),
  codexMessages: messagesWith(codexMessage),
  claudeTranscript: transcriptWith(claudeMessage, claudeTools),
  codexTranscript: transcriptWith(codexMessage, codexTools),
};
