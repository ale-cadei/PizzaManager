/* Profili di comando per tipo di sessione.
 *
 * Un "profilo" descrive come avviare un tipo di sessione: nome mostrato,
 * riga di comando e argomenti per il resume. Ogni tipo può averne più di uno
 * (es. Claude normale / Claude con --model opus): in quel caso la UI chiede
 * quale usare al momento dell'avvio.
 *
 * Modulo puro e senza dipendenze da Electron o dal filesystem, così è
 * testabile a sé. Non muta gli input: restituisce sempre nuovi oggetti.
 */

const SESSION_TYPES = ['shell', 'opencode', 'claude', 'codex', 'antigravity'];
const CONFIG_VERSION = 1;
const MAX_PROFILES_PER_TYPE = 20;
const MAX_LABEL_LEN = 60;
const MAX_COMMAND_LEN = 500;

/* Segnaposto dell'id di sessione negli argomenti di resume. */
const RESUME_PLACEHOLDER = '{id}';

/* Argomenti di resume di default, per tipo (stringa vuota = resume non
 * supportato dal comando). */
const DEFAULT_RESUME_ARGS = {
  shell: '',
  opencode: '--session {id}',
  claude: '--resume {id}',
  codex: 'resume {id}',
  /* Antigravity CLI (`agy`): riprende una conversazione per id. */
  antigravity: '--conversation {id}',
};

/* Il comando viene eseguito con pty.spawn(bin, argv): NON passa da una
 * shell, quindi pipe/redirezioni/sostituzioni non funzionerebbero. Meglio
 * rifiutarle in validazione che eseguirle in modo diverso dalle attese. */
const OPERATOR_CHARS = new Set(['|', '&', ';', '<', '>', '`']);
const ID_RE = /^[A-Za-z0-9:_.-]{1,64}$/;

/* Assegnamenti d'ambiente in testa al comando, come `VAR=valore comando`.
 * Servono perché gli alias di shell (es. `alias claudep="CLAUDE_CONFIG_DIR=…
 * claude"` in ~/.zshrc) non esistono per pty.spawn: qui l'alias si riscrive
 * per esteso nel profilo. */
const ENV_ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;
const VAR_REF_RE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/** Racchiude tra virgolette i percorsi con spazi, così il tokenizer li ricompone. */
function quoteIfNeeded(value) {
  const s = String(value || '');
  return /\s/.test(s) ? `"${s}"` : s;
}

function makeProfile(type, suffix, label, command) {
  return {
    id: `${type}:${suffix}`,
    label,
    command,
    resumeArgs: DEFAULT_RESUME_ARGS[type] || '',
  };
}

/**
 * Profili predefiniti (usati al primo avvio e dal pulsante "Ripristina").
 * @param {{ shell?: string, platform?: string }} [options]
 */
function defaultProfiles(options = {}) {
  const shell = options.shell || '/bin/bash';
  const platform = options.platform || 'linux';
  const shellCommand = platform === 'win32' ? quoteIfNeeded(shell) : `${quoteIfNeeded(shell)} -i`;
  return {
    shell: [makeProfile('shell', 'default', 'Shell di sistema', shellCommand)],
    opencode: [makeProfile('opencode', 'default', 'OpenCode', 'opencode')],
    claude: [makeProfile('claude', 'default', 'Claude Code', 'claude')],
    codex: [makeProfile('codex', 'default', 'Codex', 'codex')],
    antigravity: [makeProfile('antigravity', 'default', 'Antigravity', 'agy')],
  };
}

/**
 * Divide una riga di comando in argv rispettando virgolette ed escape.
 * Segnala virgolette non chiuse e operatori di shell non supportati.
 *
 * Su Windows il backslash fuori dalle virgolette e' il separatore dei
 * percorsi, non un escape: `C:\Tools\claude.exe` resta com'e'. Dentro le
 * virgolette doppie la regola e' la stessa ovunque (sotto).
 *
 * @param {string} input
 * @param {{ platform?: string }} [options]
 * @returns {{ tokens: string[], unbalanced: boolean, operators: string[] }}
 */
function scanCommand(input, { platform = process.platform } = {}) {
  const s = typeof input === 'string' ? input : '';
  const tokens = [];
  const operators = [];
  let cur = '';
  let started = false;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      // Dentro le virgolette doppie il backslash scappa solo $ ` " \ (POSIX):
      // "C:\Users" deve restare C:\Users, non diventare C:Users.
      if (quote === '"' && c === '\\' && i + 1 < s.length) {
        const next = s[i + 1];
        if (next === '$' || next === '`' || next === '"' || next === '\\') { cur += s[++i]; started = true; continue; }
      }
      if (c === quote) { quote = null; continue; }
      cur += c;
      started = true;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (c === '\\' && i + 1 < s.length && platform !== 'win32') { cur += s[++i]; started = true; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (started) { tokens.push(cur); cur = ''; started = false; }
      continue;
    }
    if (OPERATOR_CHARS.has(c)) operators.push(c);
    if (c === '$' && s[i + 1] === '(') operators.push('$(');
    cur += c;
    started = true;
  }
  if (started) tokens.push(cur);
  return { tokens, unbalanced: quote !== null, operators: [...new Set(operators)] };
}

/** Solo i token: comodo nei test e nella resolve. */
function tokenizeCommand(input, options) {
  return scanCommand(input, options).tokens;
}

/** Espande `~` iniziale (pty.spawn non passa da una shell che lo faccia). Su Windows anche `~\`. */
function expandHome(token, home, { platform = process.platform } = {}) {
  if (!home || typeof token !== 'string') return token;
  if (token === '~') return home;
  if (token.startsWith('~/') || (platform === 'win32' && token.startsWith('~\\'))) return home + token.slice(1);
  return token;
}

/**
 * Espande `$VAR` e `${VAR}` con i valori dati. Le variabili non definite
 * restano letterali: meglio un `$` visibile che un valore sparito in silenzio.
 */
function expandVars(value, vars) {
  if (typeof value !== 'string' || !vars) return value;
  return value.replace(VAR_REF_RE, (whole, braced, bare) => {
    const name = braced || bare;
    return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole;
  });
}

/**
 * Separa gli assegnamenti `VAR=valore` in testa dal comando vero e proprio.
 * Come in una shell, contano solo quelli che precedono il primo token normale.
 *
 * @param {string[]} tokens
 * @returns {{ assignments: Array<[string, string]>, rest: string[] }}
 */
function splitEnvAssignments(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  const assignments = [];
  let i = 0;
  for (; i < list.length; i++) {
    const m = ENV_ASSIGN_RE.exec(list[i]);
    if (!m) break;
    assignments.push([m[1], m[2]]);
  }
  return { assignments, rest: list.slice(i) };
}

function checkCommandString(value, { field }) {
  const scan = scanCommand(value);
  if (scan.unbalanced) return `${field}: virgolette non chiuse.`;
  if (scan.operators.length)
    return `${field}: operatori di shell non supportati (${scan.operators.join(' ')}). Il comando viene eseguito direttamente, senza shell.`;
  return null;
}

/**
 * Valida un profilo inserito dall'utente.
 * @returns {{ ok: true, profile: object } | { ok: false, error: string }}
 */
function validateProfile(type, raw) {
  if (!SESSION_TYPES.includes(type)) return { ok: false, error: `Tipo di sessione non valido: ${type}` };
  const src = raw && typeof raw === 'object' ? raw : {};
  const label = String(src.label || '').trim();
  const command = String(src.command || '').trim();
  const resumeArgs = String(src.resumeArgs || '').trim();

  if (!label) return { ok: false, error: 'Il nome del comando è obbligatorio.' };
  if (label.length > MAX_LABEL_LEN) return { ok: false, error: `Il nome supera ${MAX_LABEL_LEN} caratteri.` };
  if (!command) return { ok: false, error: `"${label}": la riga di comando è obbligatoria.` };
  if (command.length > MAX_COMMAND_LEN) return { ok: false, error: `"${label}": il comando supera ${MAX_COMMAND_LEN} caratteri.` };

  const cmdErr = checkCommandString(command, { field: `"${label}"` });
  if (cmdErr) return { ok: false, error: cmdErr };
  const cmdTokens = tokenizeCommand(command);
  if (!cmdTokens.length) return { ok: false, error: `"${label}": comando vuoto.` };
  if (!splitEnvAssignments(cmdTokens).rest.length)
    return { ok: false, error: `"${label}": dopo le variabili d'ambiente manca il comando da eseguire.` };

  if (resumeArgs) {
    if (resumeArgs.length > MAX_COMMAND_LEN) return { ok: false, error: `"${label}": gli argomenti di resume superano ${MAX_COMMAND_LEN} caratteri.` };
    const resErr = checkCommandString(resumeArgs, { field: `"${label}" (resume)` });
    if (resErr) return { ok: false, error: resErr };
  }

  const id = ID_RE.test(String(src.id || '')) ? String(src.id) : null;
  return { ok: true, profile: { id, label, command, resumeArgs } };
}

function makeProfileId(type, seed) {
  const slug = String(seed || '').replace(/[^A-Za-z0-9_.-]/g, '') || 'p';
  return `${type}:${slug}`;
}

/**
 * Ripulisce una configurazione arrivata da disco o dalla UI.
 * Scarta i profili non validi e garantisce almeno un profilo per tipo.
 *
 * @param {unknown} raw
 * @param {{ defaults?: object }} [options]
 */
function normalizeConfig(raw, options = {}) {
  const defaults = options.defaults || defaultProfiles();
  const src = raw && typeof raw === 'object' && raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
  const profiles = {};
  for (const type of SESSION_TYPES) {
    const list = Array.isArray(src[type]) ? src[type] : [];
    const seen = new Set();
    const clean = [];
    list.forEach((item, index) => {
      if (clean.length >= MAX_PROFILES_PER_TYPE) return;
      const v = validateProfile(type, item);
      if (!v.ok) return;
      let id = v.profile.id || makeProfileId(type, `p${index}`);
      while (seen.has(id)) id = `${id}-2`;
      seen.add(id);
      clean.push({ ...v.profile, id });
    });
    profiles[type] = clean.length ? clean : (defaults[type] || []).map((p) => ({ ...p }));
  }
  return { version: CONFIG_VERSION, profiles };
}

/** Profili di un tipo (array nuovo, mai il riferimento interno). */
function listProfiles(config, type) {
  const list = config && config.profiles && Array.isArray(config.profiles[type]) ? config.profiles[type] : [];
  return list.map((p) => ({ ...p }));
}

/** Profilo per id; `null` se assente. */
function findProfile(config, type, id) {
  if (!id) return null;
  const found = listProfiles(config, type).find((p) => p.id === id);
  return found || null;
}

/**
 * Traduce un profilo in `{ bin, args }` pronti per pty.spawn.
 * L'id di sessione finisce dove c'è `{id}` nel comando, altrimenti in coda
 * usando `resumeArgs`.
 *
 * Gli eventuali `VAR=valore` in testa non finiscono nell'argv: tornano in
 * `env`, da passare a pty.spawn. È la riscrittura esplicita di un alias di
 * shell, che pty.spawn non vedrebbe.
 *
 * @param {{ command: string, resumeArgs?: string }} profile
 * @param {{ resumeId?: string|null, home?: string, env?: object, platform?: string }} [options]
 * @returns {{ ok: true, bin: string, args: string[], env: object, resumeApplied: boolean } | { ok: false, error: string }}
 */
function resolveProfileCommand(profile, options = {}) {
  const { resumeId, home, env: vars, platform = process.platform } = options;
  const expand = (t) => expandHome(expandVars(t, vars), home, { platform });
  if (!profile || typeof profile.command !== 'string')
    return { ok: false, error: 'Profilo di comando non valido.' };
  const scan = scanCommand(profile.command, { platform });
  if (scan.unbalanced) return { ok: false, error: 'Comando non valido: virgolette non chiuse.' };
  if (!scan.tokens.length) return { ok: false, error: 'Comando vuoto.' };

  const split = splitEnvAssignments(scan.tokens);
  if (!split.rest.length)
    return { ok: false, error: "Dopo le variabili d'ambiente manca il comando da eseguire." };
  const env = {};
  for (const [name, value] of split.assignments) {
    env[name] = expand(value);
  }

  const inlineResume = split.rest.some((t) => t.includes(RESUME_PLACEHOLDER));
  let tokens = split.rest;
  if (resumeId) {
    tokens = inlineResume
      ? tokens.map((t) => t.split(RESUME_PLACEHOLDER).join(String(resumeId)))
      : tokens;
  } else {
    // Avvio pulito: i token legati al resume non hanno senso
    tokens = tokens.filter((t, i) => i === 0 || !t.includes(RESUME_PLACEHOLDER));
  }

  // `$VAR` si espande anche negli argomenti, come nei valori d'ambiente in
  // testa: chi arriva da un alias di shell (`claude --model $MODEL`) se lo
  // aspetta. Il tokenizer non conserva le virgolette, quindi — a differenza di
  // una shell — anche '$X' tra apici singoli si espande; le variabili ignote
  // restano letterali.
  let args = tokens.slice(1).map(expand);
  let resumeApplied = Boolean(resumeId && inlineResume);
  if (resumeId && !inlineResume) {
    const extra = tokenizeCommand(profile.resumeArgs || '', { platform });
    if (extra.length) {
      args = [...args, ...extra.map((t) => expand(t.split(RESUME_PLACEHOLDER).join(String(resumeId))))];
      resumeApplied = true;
    }
  }
  return { ok: true, bin: expand(tokens[0]), args, env, resumeApplied };
}

module.exports = {
  SESSION_TYPES,
  CONFIG_VERSION,
  MAX_PROFILES_PER_TYPE,
  MAX_LABEL_LEN,
  MAX_COMMAND_LEN,
  RESUME_PLACEHOLDER,
  DEFAULT_RESUME_ARGS,
  defaultProfiles,
  scanCommand,
  tokenizeCommand,
  expandHome,
  expandVars,
  splitEnvAssignments,
  validateProfile,
  normalizeConfig,
  listProfiles,
  findProfile,
  resolveProfileCommand,
  makeProfileId,
};
