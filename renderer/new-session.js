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
// «Altro server…»: il server si scrive nel campo sotto (docs/plans/96)
const SSH_NEW_ENV = '__ssh-new';
// Ultima directory locale: tornando a «Questo computer» si ritrova
let lastLocalCwd = null;
let shownEnv = LOCAL_ENV;

function rememberedEnv() {
  try { return localStorage.getItem(NEW_ENV_KEY) || LOCAL_ENV; } catch { return LOCAL_ENV; }
}

function rememberEnv(env) {
  try { localStorage.setItem(NEW_ENV_KEY, env); } catch {}
}

/** La voce scelta nel select, «Altro server…» compreso. */
function newEnvChoice() {
  const el = $('#new-env');
  return (el && el.value) || LOCAL_ENV;
}

/** L'ambiente per le directory recenti e la riga account: con «Altro server…» quello scritto, non ancora controllato. */
function currentNewEnv() {
  const choice = newEnvChoice();
  if (choice !== SSH_NEW_ENV) return choice;
  return `ssh:${(($('#new-ssh-target') || {}).value || '').trim()}`;
}

/**
 * L'ambiente della sessione da creare. Il testo di «Altro server…» lo
 * controlla il main (stesso validatore di pty e editor).
 * @returns {Promise<{env: string} | {error: string}>}
 */
async function resolveNewEnv(choice, text) {
  if (choice !== SSH_NEW_ENV) return { env: choice };
  try {
    const r = await window.aisess.checkSshTarget(text);
    return r && r.ok ? { env: r.env } : { error: (r && r.error) || 'Server non valido.' };
  } catch (e) {
    console.warn('check-ssh-target fallito', e);
    return { error: `Impossibile controllare il server: ${String((e && e.message) || e)}` };
  }
}

function envOption(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function envGroup({ label, items }) {
  const g = document.createElement('optgroup');
  g.label = label;
  g.append(...items.map((i) => envOption(i.value, i.text)));
  return g;
}

/**
 * I gruppi del «Dove»: host di ~/.ssh/config, server scritti a mano usati di
 * recente (docs/plans/96), distro WSL. `wanted` scritto a mano ma non fra i
 * recenti (il «+» di un gruppo vecchio) entra in testa ai recenti.
 * @returns {{label: string, items: {value: string, text: string}[]}[]}
 */
function envSelectGroups(envs, wanted) {
  const list = (k) => (envs && Array.isArray(envs[k]) ? envs[k] : []);
  const ssh = list('ssh');
  const typed = typeof wanted === 'string' && wanted.startsWith('ssh:') ? wanted.slice(4) : '';
  const recent = typed && !ssh.includes(typed) && !list('recent').includes(typed)
    ? [typed, ...list('recent')] : list('recent');
  const group = (label, values, kind) => ({ label, items: values.map((v) => ({ value: `${kind}:${v}`, text: v })) });
  return [group('SSH', ssh, 'ssh'), group('Usati di recente', recent, 'ssh'), group('WSL', list('wsl'), 'wsl')]
    .filter((g) => g.items.length);
}

/** Riempie «Dove»: questo computer, gli host, i recenti, WSL e in fondo «Altro server…». */
async function fillEnvSelect(wanted) {
  const select = $('#new-env');
  if (!select) return;
  let envs = null;
  try {
    envs = await window.aisess.listRemoteEnvs();
  } catch (e) {
    console.warn('list-remote-envs fallito', e);
  }
  select.replaceChildren(
    envOption(LOCAL_ENV, 'Questo computer'),
    ...envSelectGroups(envs, wanted).map(envGroup),
    envOption(SSH_NEW_ENV, 'Altro server SSH…'),
  );
  // Un host sparito da ~/.ssh/config non c'è fra le opzioni: si torna a questo computer
  const values = [...select.options].map((o) => o.value);
  select.value = values.includes(wanted) ? wanted : LOCAL_ENV;
}

/**
 * Adatta il modal all'ambiente scelto: sul server niente Sfoglia, niente
 * Git (Editor solo su SSH), account Claude solo OAuth, directory scritta a mano (`~` di
 * partenza). Tornando a questo computer si ritrova l'ultima directory locale.
 * @param {{cwd?: string}} [opts] directory imposta dal chiamante (il «+» di un gruppo)
 */
function applyEnvToModal({ cwd } = {}) {
  // La voce del select, non il testo di «Altro server…»: scrivere non azzera la directory
  const choice = newEnvChoice();
  const sshNew = choice === SSH_NEW_ENV;
  const env = sshNew ? 'ssh:' : choice;
  const remote = choice !== LOCAL_ENV;
  const input = $('#new-cwd');
  if (choice !== shownEnv) {
    if (shownEnv === LOCAL_ENV) lastLocalCwd = input.value;
    if (!cwd) input.value = remote ? '~' : (lastLocalCwd || input.value);
    shownEnv = choice;
  }
  $('#new-ssh-target-row').hidden = !sshNew;
  if (cwd) input.value = cwd;
  input.placeholder = remote ? '~/progetto oppure /percorso/assoluto' : '/home/utente/progetto';
  $('#btn-browse').hidden = remote;
  $$('.type-card').forEach((c) => { c.disabled = !panelAvailable(c.dataset.type, env); });
  if (!panelAvailable(pendingNewType, env)) pendingNewType = 'shell';
  $$('.type-card').forEach((x) => x.classList.toggle('selected', x.dataset.type === pendingNewType));
}

/* Git e Editor sono pannelli dell'app, non processi: l'editor sa aprire una
   cartella su un server SSH (docs/plans/94), git solo una di questo computer. */
function panelAvailable(type, env) {
  if (!PANEL_TYPES.includes(type) || env === LOCAL_ENV) return true;
  return type === 'editor' && env.startsWith('ssh:');
}

/** Cambio di «Dove» dal select. */
async function onNewEnvChange() {
  // «Altro server…» si ricorda alla conferma, col server scritto
  if (newEnvChoice() !== SSH_NEW_ENV) rememberEnv(newEnvChoice());
  applyEnvToModal();
  if (newEnvChoice() === SSH_NEW_ENV) $('#new-ssh-target').focus();
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
