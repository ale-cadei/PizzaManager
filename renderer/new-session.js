/* Modal «Nuova sessione» e directory di lavoro recenti. */

/**
 * @param {string} [type] tipo preselezionato (dal menu o dall'ultimo uso)
 * @param {{cwd?: string}} [opts] directory da proporre al posto dell'ultima digitata:
 *   è quello che fa il «+» di un gruppo progetto nella sidebar
 */
async function openNewModal(type, { cwd } = {}) {
  if (type) pendingNewType = type;
  if (cwd) $('#new-cwd').value = cwd;
  $$('.type-card').forEach(x => x.classList.toggle('selected', x.dataset.type === pendingNewType));
  // Il modal si apre DOPO che la riga account e' pronta: prima compariva un
  // istante senza, e con piu' account Claude la riga arrivava a modal gia' aperto.
  await updateClaudeAccountRow();
  $('#modal-new').hidden = false;
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
    dirs = await window.aisess.getRecentDirs(RECENT_DIRS_LIMIT);
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
