/* Modal «Nuova sessione» e directory di lavoro recenti. */

/**
 * @param {string} [type] tipo preselezionato (dal menu o dall'ultimo uso)
 * @param {{cwd?: string}} [opts] directory da proporre al posto dell'ultima digitata:
 *   è quello che fa il «+» di un gruppo progetto nella sidebar
 */
async function openNewModal(type, { cwd, env } = {}) {
  if (type) pendingNewType = type;
  await fillEnvSelect(env || rememberedEnv());
  applyEnvToModal({ cwd });
  showNewError('');
  // Il modal si apre DOPO che la riga account e' pronta: prima compariva un
  // istante senza, e con piu' account Claude la riga arrivava a modal gia' aperto.
  await updateClaudeAccountRow();
  $('#modal-new').hidden = false;
  renderRecentDirs();
}

/* Errore mostrato nel modal (vuoto = nascosto) */
function showNewError(text) {
  const el = $('#new-error');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

/** Perché nella directory non si può aprire una sessione git; null se si può. */
async function gitRepoProblem(cwd) {
  if (!cwd) return 'Scegli la directory di un repository git.';
  try {
    const r = await window.aisess.gitGraph(cwd, 1);
    return r && r.ok ? null : (r && r.error) || 'Impossibile leggere il repository.';
  } catch (e) {
    console.warn('git-graph non raggiungibile', e);
    return 'Impossibile leggere il repository: ' + String((e && e.message) || e);
  }
}

/* ---------- Dove: questo computer, un server SSH, una distro WSL (piano 93) ---------- */
const NEW_ENV_KEY = 'aisess.newEnv';
const LOCAL_ENV = 'local';
// Ultima directory locale: tornando a «Questo computer» si ritrova
let lastLocalCwd = null;
let shownEnv = LOCAL_ENV;

function rememberedEnv() {
  try { return localStorage.getItem(NEW_ENV_KEY) || LOCAL_ENV; } catch { return LOCAL_ENV; }
}

function rememberEnv(env) {
  try { localStorage.setItem(NEW_ENV_KEY, env); } catch {}
}

function currentNewEnv() {
  const el = $('#new-env');
  return (el && el.value) || LOCAL_ENV;
}

function envOption(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function envGroup(label, values, toKey) {
  const g = document.createElement('optgroup');
  g.label = label;
  g.append(...values.map((v) => envOption(toKey(v), v)));
  return g;
}

/** Riempie «Dove» con gli host di ~/.ssh/config e le distro WSL; senza, la riga non c'è. */
async function fillEnvSelect(wanted) {
  const select = $('#new-env');
  const row = $('#new-env-row');
  if (!select || !row) return;
  let envs = null;
  try {
    envs = await window.aisess.listRemoteEnvs();
  } catch (e) {
    console.warn('list-remote-envs fallito', e);
  }
  const ssh = envs && Array.isArray(envs.ssh) ? envs.ssh : [];
  const wsl = envs && Array.isArray(envs.wsl) ? envs.wsl : [];
  const groups = [];
  if (ssh.length) groups.push(envGroup('SSH', ssh, (h) => `ssh:${h}`));
  if (wsl.length) groups.push(envGroup('WSL', wsl, (d) => `wsl:${d}`));
  select.replaceChildren(envOption(LOCAL_ENV, 'Questo computer'), ...groups);
  // Un host sparito da ~/.ssh/config non c'è fra le opzioni: si torna a questo computer
  const values = [...select.options].map((o) => o.value);
  select.value = values.includes(wanted) ? wanted : LOCAL_ENV;
  row.hidden = groups.length === 0;
}

/**
 * Adatta il modal all'ambiente scelto: sul server niente Sfoglia, niente
 * Git/Editor, account Claude solo OAuth, directory scritta a mano (`~` di
 * partenza). Tornando a questo computer si ritrova l'ultima directory locale.
 * @param {{cwd?: string}} [opts] directory imposta dal chiamante (il «+» di un gruppo)
 */
function applyEnvToModal({ cwd } = {}) {
  const env = currentNewEnv();
  const remote = env !== LOCAL_ENV;
  const input = $('#new-cwd');
  if (env !== shownEnv) {
    if (shownEnv === LOCAL_ENV) lastLocalCwd = input.value;
    if (!cwd) input.value = remote ? '~' : (lastLocalCwd || input.value);
    shownEnv = env;
  }
  if (cwd) input.value = cwd;
  input.placeholder = remote ? '~/progetto oppure /percorso/assoluto' : '/home/utente/progetto';
  $('#btn-browse').hidden = remote;
  $$('.type-card').forEach((c) => { c.disabled = remote && PANEL_TYPES.includes(c.dataset.type); });
  if (remote && PANEL_TYPES.includes(pendingNewType)) pendingNewType = 'shell';
  $$('.type-card').forEach((x) => x.classList.toggle('selected', x.dataset.type === pendingNewType));
}

/** Cambio di «Dove» dal select. */
async function onNewEnvChange() {
  rememberEnv(currentNewEnv());
  applyEnvToModal();
  showNewError('');
  await updateClaudeAccountRow();
  renderRecentDirs();
}

/* ---------- Directory di lavoro recenti ---------- */
const RECENT_DIRS_LIMIT = 8;

async function renderRecentDirs() {
  const row = $('#recent-dirs-row');
  const box = $('#recent-dirs');
  if (!row || !box) return;
  let dirs = [];
  try {
    dirs = await window.aisess.getRecentDirs(RECENT_DIRS_LIMIT, currentNewEnv());
  } catch (e) {
    console.warn('get-recent-dirs fallito', e);
  }
  if (!Array.isArray(dirs) || dirs.length === 0) {
    row.hidden = true;
    box.replaceChildren();
    return;
  }
  const chips = dirs.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dir-chip';
    b.dataset.path = d.path;
    b.title = d.lastOpened ? `${d.path}\nUltimo uso: ${fmtDate(d.lastOpened)}` : d.path;
    const icon = document.createElement('span');
    icon.className = 'dir-chip-type';
    if (Icons.has(d.type)) icon.innerHTML = Icons.markup(d.type);
    else icon.textContent = '📁';
    const label = document.createElement('span');
    label.className = 'dir-chip-path';
    label.textContent = Groups.shortPath(d.path);
    b.append(icon, label);
    b.addEventListener('click', () => {
      $('#new-cwd').value = d.path;
      markSelectedRecentDir();
    });
    return b;
  });
  box.replaceChildren(...chips);
  row.hidden = false;
  markSelectedRecentDir();
}

function markSelectedRecentDir() {
  const current = ($('#new-cwd').value || '').trim().replace(/(.)\/+$/, '$1');
  $$('#recent-dirs .dir-chip').forEach(c => c.classList.toggle('selected', c.dataset.path === current));
}
