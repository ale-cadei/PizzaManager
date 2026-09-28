/* Finestra "Plugin e skill" (docs/plans/29), dal pulsante in fondo a destra.
   Si rilegge il disco a ogni apertura: installare un plugin da un terminale
   dell'app e riaprire la finestra basta per vederlo. Il progetto è quello
   della sessione in primo piano (docs/plans/30). */

const extensions = { view: null, clis: null, active: 'claude', query: '' };

function renderExtensionTabs() {
  const bar = $('#ext-tabs');
  bar.replaceChildren();
  for (const cli of extensions.clis || []) {
    const n = window.AisessExtensions.countOf(cli);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(cli.id === extensions.active));
    btn.textContent = cli.label;
    const count = document.createElement('span');
    count.className = 'ext-tab-count';
    count.textContent = `${n.plugins} plugin · ${n.items} skill e comandi`;
    btn.appendChild(count);
    btn.onclick = () => { extensions.active = cli.id; renderExtensionTabs(); renderExtensions(); };
    bar.appendChild(btn);
  }
}

function renderExtensions() {
  const cli = (extensions.clis || []).find((c) => c.id === extensions.active) || null;
  extensions.view.render(cli, extensions.query);
}

function showExtensionsMessage(text, isError) {
  const body = $('#ext-body');
  body.replaceChildren();
  const p = document.createElement('p');
  p.className = isError ? 'ext-empty ext-error' : 'ext-empty';
  p.textContent = text;
  body.appendChild(p);
}

/* La cartella della sessione in primo piano; il main ne cerca la radice */
function activeProjectDir() {
  const tab = activeId ? tabs.get(activeId) : null;
  return tab ? (tab.projectRoot || tab.cwd || null) : null;
}

async function openExtensions() {
  const backdrop = $('#modal-extensions');
  if (!backdrop || !window.AisessExtensions) return;
  if (!extensions.view) extensions.view = window.AisessExtensions.createExtensionsView({ root: $('#ext-body'), document });
  extensions.query = '';
  $('#ext-search').value = '';
  $('#ext-tabs').replaceChildren();
  $('#ext-project').textContent = '';
  showExtensionsMessage('Lettura in corso…');
  backdrop.hidden = false;
  $('#ext-search').focus();
  try {
    const r = await window.aisess.listExtensions(activeProjectDir());
    if (!r || !r.ok) throw new Error((r && r.error) || 'risposta vuota');
    extensions.clis = r.clis;
    $('#ext-project').textContent = window.AisessExtensions.projectLine(r.project);
  } catch (e) {
    console.warn('list-extensions fallito', e);
    showExtensionsMessage('Impossibile leggere plugin e skill: ' + String((e && e.message) || e), true);
    return;
  }
  if (backdrop.hidden) return;
  renderExtensionTabs();
  renderExtensions();
}

function closeExtensions() {
  $('#modal-extensions').hidden = true;
}

function initExtensions() {
  const open = $('#extensions-open');
  const backdrop = $('#modal-extensions');
  if (!open || !backdrop) return;
  open.addEventListener('click', () => openExtensions());
  $('#ext-close').addEventListener('click', closeExtensions);
  $('#ext-search').addEventListener('input', (e) => { extensions.query = e.target.value; if (extensions.clis) renderExtensions(); });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeExtensions(); });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeExtensions(); } });
}
