/* Pezzi fissi della finestra: pallini dei binari, schermata vuota,
   sidebar ridimensionabile, barra dell'uso. */

/* Pallini dei binari in fondo alla sidebar. Si rilegge anche da «Ricontrolla»
   nella schermata vuota: chi ha appena installato un assistente deve vederlo
   acceso senza riavviare. */
async function refreshDeps() {
  try {
    const deps = await window.aisess.checkDeps();
    if (welcome) welcome.update(deps.setup || null);
    const fmt = (b, name) => b && b.found ? `✔ ${name}: ${b.path}` : `✘ ${name} non trovato`;
    $('#deps-status').textContent = AI_TYPES.map(n => `${deps[n] && deps[n].found ? '✔' : '✘'} ${n}`).join(' · ');
    $('#deps-status').title = AI_TYPES.map(n => fmt(deps[n], n)).join('\n') + '\nPATH: ' + deps.path;
    const mark = (id, b) => {
      const el = $(id);
      if (!el) return;
      el.style.opacity = b && b.found ? '1' : '0.45';
      el.title = b && b.found ? b.path + ' (' + (b.via || '') + ')' : 'NON TROVATO nel PATH:\n' + (b && b.searchedPath);
    };
    for (const n of AI_TYPES) mark('#dep-' + n, deps[n]);
    // tmux non e' un tipo di sessione ma decide se le sessioni sopravvivono
    // all'app: senza indicatore, chi non ce l'ha scopre la differenza solo
    // perdendole. Stesso trattamento dei binari, con la spiegazione nel tooltip.
    const tmuxEl = $('#dep-tmux');
    if (tmuxEl) {
      tmuxEl.style.opacity = tmuxAvailable ? '1' : '0.45';
      tmuxEl.title = tmuxAvailable
        ? `tmux: ${tmuxPath}\nLe sessioni restano vive alla chiusura dell'app e tornano alla riapertura.`
        : 'tmux non trovato: le sessioni muoiono con la finestra.\nInstallalo (brew install tmux / apt install tmux) e riavvia l\'app.';
    }
    if (AI_TYPES.some(n => !deps[n] || !deps[n].found)) {
      console.warn('[PizzaManager] binari mancanti:', deps);
    }
  } catch (e) {
    console.warn('check-deps fallito', e);
    if (welcome) welcome.update(null);
  }
}

function updateEmpty() {
  const el = $('#empty');
  if (el) el.style.display = tabs.size ? 'none' : 'block';
}

/* ---------- Schermata vuota (onboarding) ----------
   Che cosa manca per usare l'app lo calcola il main (lib/setup-check.js) e
   arriva con `check-deps`, la schermata lo disegna (renderer/welcome.js). Si
   chiede all'avvio e a ogni «Ricontrolla»: non a ogni apertura della
   schermata, perché cercare i binari legge il filesystem. */
let welcome = null;

function initWelcome() {
  const root = $('#empty');
  if (!root || !window.AisessWelcome) return;
  welcome = window.AisessWelcome.createWelcome({
    root, document,
    onCopy: (text) => { window.aisess.clipboardWrite(text).catch((e) => console.warn('copia fallita', e)); },
    onRecheck: () => { refreshDeps(); },
    onNew: () => openNewModal(),
    onResume: () => openResumeModal(),
  });
}

/* Sidebar ridimensionabile via drag, larghezza persistita in localStorage */
function initSidebarResize() {
  const sidebar = $('#sidebar');
  const resizer = $('#sidebar-resizer');
  if (!sidebar || !resizer) return;
  const DEFAULT_W = 300, MIN_W = 180, MAX_W = 480;
  try {
    const saved = parseInt(localStorage.getItem('aisess.sidebarW'), 10);
    if (saved >= MIN_W && saved <= MAX_W) sidebar.style.width = saved + 'px';
  } catch {}
  resizer.addEventListener('dblclick', () => {
    sidebar.style.width = DEFAULT_W + 'px';
    try { localStorage.setItem('aisess.sidebarW', String(DEFAULT_W)); } catch {}
    fitActive();
  });
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizer.classList.add('dragging');
    const startX = e.clientX;
    const startW = sidebar.getBoundingClientRect().width;
    const onMove = (ev) => {
      const w = Math.min(MAX_W, Math.max(MIN_W, startW + ev.clientX - startX));
      sidebar.style.width = w + 'px';
    };
    const onUp = () => {
      resizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('aisess.sidebarW', String(Math.round(sidebar.getBoundingClientRect().width))); } catch {}
      fitActive();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ---------- Barra dell'uso ----------
   Il main process legge i log dei CLI (lib/usage) e restituisce i totali gia'
   aggregati. Qui si decide solo *quando* chiederli: ogni 8 secondi, e subito
   dopo un cambio di scheda, perche' il riquadro SESSIONE cambia con essa.
   Un errore non svuota la barra: si tiene l'ultima fotografia buona, un buco
   di pochi secondi vale meno di una riga che lampeggia. */
const USAGE_REFRESH_MS = 8000;
let usageBar = null;
let usageTimer = null;

function activeUsageSession() {
  const t = activeId ? tabs.get(activeId) : null;
  if (!t || !t.resumeId || t.type === 'shell') return null;
  return { source: t.type, sessionId: t.resumeId };
}

/* Di quale account mostrare la quota di Claude: solo gli id, la config dir
   la ricava il main dal profilo (docs/plans/35-quota-per-profilo.md). */
function activeUsageTab() {
  const t = activeId ? tabs.get(activeId) : null;
  if (!t) return null;
  return { type: t.type, commandProfileId: t.commandProfileId || null, claudeAccountId: t.claudeAccountId || null };
}

async function refreshUsage() {
  if (!usageBar) return;
  try {
    const r = await window.aisess.usage(activeUsageSession(), activeUsageTab());
    if (r && r.ok && r.usage) usageBar.update(r.usage);
  } catch (e) {
    console.warn('usage-snapshot fallito', e);
  }
}

function initUsageBar() {
  const root = $('#usagebar');
  if (!root || !window.AisessUsageBar) return;
  usageBar = window.AisessUsageBar.createUsageBar({ root, document });
  usageBar.setCurrent(activeId ? tabs.get(activeId) : null);
  refreshUsage();
  if (usageTimer) clearInterval(usageTimer);
  usageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS);
}
