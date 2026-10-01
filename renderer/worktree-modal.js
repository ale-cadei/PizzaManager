/* Modale «Nuovo worktree» (docs/plans/36-sessione-worktree.md), aperto dal [⑂]
   di un gruppo progetto. Chiede il nome del branch e da dove partire; il tipo
   di sessione lo si sceglie dopo nel modale «Nuova sessione», già impostato
   sulla cartella del worktree: stesse card, account e profili, niente copie.
   La parte senza DOM sta in worktree-form.js. */

const WorktreeForm = window.AisessWorktreeForm;
/** La radice del progetto per cui il modale è aperto */
let worktreeModalRoot = null;
/** Le basi proposte (worktree-form.js startModel) e quella scelta */
let worktreeBases = [];
let worktreeBase = null;

function showWorktreeLine(id, text) {
  const el = $(id);
  el.textContent = text || '';
  el.hidden = !text;
}

function setWorktreeBusy(busy) {
  for (const id of ['#wt-create', '#wt-create-open']) $(id).disabled = busy;
}

async function openWorktreeModal(root) {
  worktreeModalRoot = root;
  $('#wt-project').textContent = root;
  $('#wt-branch').value = '';
  $('#wt-base-filter').value = '';
  worktreeBases = [];
  worktreeBase = null;
  renderWorktreeBases('Carico i branch…');
  for (const id of ['#wt-path', '#wt-warning', '#wt-note', '#wt-error']) showWorktreeLine(id, '');
  setWorktreeBusy(true);
  $('#modal-worktree').hidden = false;
  $('#wt-branch').focus();

  let start;
  try {
    start = await window.aisess.worktreeStart(root);
  } catch (e) {
    start = { ok: false, error: String((e && e.message) || e) };
  }
  // Chiuso o riaperto per un altro progetto mentre git rispondeva
  if (worktreeModalRoot !== root || $('#modal-worktree').hidden) return;
  const model = WorktreeForm.startModel(start);
  worktreeBases = model.bases;
  worktreeBase = model.selected;
  renderWorktreeBases();
  showWorktreeLine('#wt-warning', model.warning);
  showWorktreeLine('#wt-note', model.note);
  showWorktreeLine('#wt-error', model.blocked);
  setWorktreeBusy(Boolean(model.blocked));
}

/* «Parte da»: le voci come quelle dell'albero git (nome a sinistra,
   suggerimento grigio a destra, gruppo «Locali»), la scelta evidenziata.
   Nomi dei branch sempre con textContent. */
function worktreeBaseItem(b) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'git-picker-item' + (b.value === worktreeBase ? ' is-selected' : '');
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(b.value === worktreeBase));
  const name = document.createElement('span');
  name.className = 'git-picker-name';
  name.textContent = b.label;
  item.appendChild(name);
  if (b.hint) {
    const hint = document.createElement('span');
    hint.className = 'git-picker-hint';
    hint.textContent = b.hint;
    item.appendChild(hint);
  }
  item.addEventListener('click', () => { worktreeBase = b.value; renderWorktreeBases(); });
  return item;
}

function renderWorktreeBases(message) {
  const shown = WorktreeForm.filterBases(worktreeBases, $('#wt-base-filter').value);
  const note = (text) => {
    const p = document.createElement('p');
    p.className = 'git-picker-empty small muted';
    p.textContent = text;
    return p;
  };
  if (message) { $('#wt-base-list').replaceChildren(note(message)); return; }
  if (!shown.length) { $('#wt-base-list').replaceChildren(note(worktreeBases.length ? 'Nessun branch con questo nome.' : 'Nessun branch.')); return; }
  const group = document.createElement('div');
  group.className = 'git-picker-group';
  group.textContent = 'Locali';
  $('#wt-base-list').replaceChildren(group, ...shown.map(worktreeBaseItem));
}

function closeWorktreeModal() {
  $('#modal-worktree').hidden = true;
  worktreeModalRoot = null;
}

/** Crea il worktree; con `openSession` passa al modale «Nuova sessione» nella sua cartella. */
async function confirmWorktree({ openSession }) {
  const root = worktreeModalRoot;
  if (!root) return;
  setWorktreeBusy(true);
  showWorktreeLine('#wt-error', '');
  let res;
  try {
    res = await window.aisess.worktreeCreate(root, $('#wt-branch').value.trim(), worktreeBase);
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  if (!res || !res.ok) {
    // Il modale resta aperto: si corregge il nome e si riprova
    showWorktreeLine('#wt-error', (res && res.error) || 'Worktree non creato.');
    setWorktreeBusy(false);
    return;
  }
  closeWorktreeModal();
  await worktreeCache.refresh(root);
  // Avvisi (node_modules non collegato, un file non copiato): il worktree c'è
  // e si usa, ma va detto. Dalla sua riga, che il rinfresco ha appena disegnato.
  const warnings = Array.isArray(res.warnings) ? res.warnings : [];
  const anchor = warnings.length ? findAnchor(`worktree:${res.path}`) : null;
  if (anchor) closeConfirm.tell({ anchor, key: `worktree:${res.path}`, title: 'Worktree creato, con avvisi', text: warnings.join('\n') }).catch(() => {});
  else if (warnings.length) console.warn('[worktree] avvisi', warnings);
  if (openSession) await openNewModal(undefined, { cwd: res.path });
}

function initWorktreeModal() {
  $('#wt-cancel').addEventListener('click', closeWorktreeModal);
  $('#wt-branch').addEventListener('input', () => {
    const folder = WorktreeForm.folderPreview(worktreeModalRoot, $('#wt-branch').value);
    showWorktreeLine('#wt-path', folder ? `Cartella: ${folder}` : '');
    if ($('#wt-error').textContent && !$('#wt-create').disabled) showWorktreeLine('#wt-error', '');
  });
  // Invio nel nome: il caso più comune, crea e apri una sessione
  $('#wt-branch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('#wt-create-open').disabled) { e.preventDefault(); confirmWorktree({ openSession: true }).catch(() => {}); }
  });
  $('#wt-base-filter').addEventListener('input', () => renderWorktreeBases());
  // Invio nel filtro sceglie il primo branch che corrisponde, non crea
  $('#wt-base-filter').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = WorktreeForm.filterBases(worktreeBases, $('#wt-base-filter').value)[0];
    if (first) { worktreeBase = first.value; renderWorktreeBases(); }
  });
  $('#wt-create').addEventListener('click', () => { confirmWorktree({ openSession: false }).catch(() => {}); });
  $('#wt-create-open').addEventListener('click', () => { confirmWorktree({ openSession: true }).catch(() => {}); });
}
