/* Nomi delle schede: titoli automatici dal CLI, primo prompt digitato,
   rinomina manuale. */

/* ---------- Nomi delle sessioni ----------
   Automatici dal titolo che il CLI dà alla conversazione, finché l'utente non
   ne sceglie uno suo: da lì in poi vince il suo e l'automatico non lo tocca. */
const AUTO_TITLE_MS = 20000;
let autoTitleTimer = null;

function listSessionsFor(type) {
  if (type === 'opencode') return window.aisess.listOpencode(100);
  if (type === 'claude') return window.aisess.listClaude(100);
  if (type === 'codex') return window.aisess.listCodex(100);
  if (type === 'antigravity') return window.aisess.listAntigravity(100);
  return null; // lo shell non ha conversazioni
}

function applyTitle(tab, title) {
  const next = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!next || next === tab.name) return false;
  tab.name = next;
  syncLabel(tab);
  return true;
}

/** Il nome della scheda si salva sulla sessione tmux: al riattacco torna. */
function syncLabel(tab) {
  if (tab && tab.session && tab.alive) window.aisess.setLabel(tab.id, tab.name);
}

/**
 * Nome dal primo prompt digitato. Vale per ogni tipo di sessione, anche per
 * quelli di cui non sappiamo leggere le conversazioni, e arriva subito: non
 * serve aspettare che il CLI scriva il suo file.
 */
function applyTypedPrompt(tab, data) {
  if (!tab.promptCapture) return;
  let line = null;
  try { line = tab.promptCapture.feed(data); } catch { return; }
  if (!line) return;
  tab.promptCapture = null;
  if (!tab.autoNamed) return; // l'utente ha già scelto un nome suo
  // Il titolo del CLI non deve più scavalcare il prompt scritto dall'utente
  tab.namedFromPrompt = true;
  if (tab.resumeId) titleStore.setName(tab.type, tab.resumeId, line);
  if (applyTitle(tab, line)) renderSidebar();
}

/**
 * Aggiorna id conversazione e nome delle schede. L'id si cerca per OGNI scheda
 * che non lo conosce, rinominata o no: e' cio' che la rende ripristinabile
 * dopo un riavvio (finisce sulla sessione tmux e da li' in live-sessions.json).
 * Il titolo automatico invece tocca solo le schede non rinominate.
 */
async function refreshAutoTitles() {
  const targets = [...tabs.values()].filter(Titles.needsAutoRefresh);
  if (!targets.length) return;
  const byType = new Map();
  for (const t of targets) if (!byType.has(t.type)) byType.set(t.type, listSessionsFor(t.type));
  let changed = false;
  for (const [type, promise] of byType) {
    let data = null;
    try { data = await promise; } catch { continue; }
    if (!data || !data.ok) continue;
    for (const t of targets.filter((x) => x.type === type)) {
      // Con un resume l'id è noto; per una scheda nuova va riconosciuto. Le
      // conversazioni già di altre schede sono escluse: due schede nello stesso
      // progetto non devono finire sulla stessa conversazione.
      const s = t.resumeId
        ? (data.sessions || []).find((x) => x.id === t.resumeId)
        : Titles.pickAutoSession(data.sessions, { cwd: t.cwd, since: t.startedAt - 5000, exclude: knownResumeIds(t) });
      if (!s) continue;
      if (!t.resumeId) {
        t.resumeId = s.id;
        // Appena l'id e' noto lo si salva sulla sessione tmux: e' cio' che rende
        // ripristinabile dopo un riavvio una scheda nata "nuova".
        if (t.session && t.alive) window.aisess.setMeta(t.id, { resumeId: s.id });
      }
      // Nome scelto dall'utente (rinomina, dialog, prompt digitato): si lega
      // alla conversazione appena se ne conosce l'id, così sopravvive al
      // resume. Il titolo del CLI perde.
      if (t.namedFromPrompt || !t.autoNamed) {
        if (!titleStore.nameFor(t.type, t.resumeId)) titleStore.setName(t.type, t.resumeId, t.name);
        continue;
      }
      // Conversazione appena creata, senza ancora un prompt: il suo "titolo" è
      // solo l'id. Meglio tenere il nome provvisorio e riprovare al giro dopo.
      if (s.titled === false) continue;
      const custom = titleStore.nameFor(t.type, t.resumeId);
      if (custom) { t.autoNamed = false; changed = applyTitle(t, custom) || changed; continue; }
      changed = applyTitle(t, s.title) || changed;
    }
  }
  if (changed) renderSidebar();
}

/** Id delle conversazioni già assegnate ad altre schede dello stesso tipo. */
function knownResumeIds(tab) {
  return [...tabs.values()].filter((t) => t !== tab && t.type === tab.type && t.resumeId).map((t) => t.resumeId);
}

function startAutoTitles() {
  if (autoTitleTimer) return;
  autoTitleTimer = setInterval(() => { refreshAutoTitles().catch(() => {}); }, AUTO_TITLE_MS);
}

/**
 * Chiede il nuovo nome con un modal interno: in Electron la prompt() del
 * browser lancia "prompt() is and will not be supported.".
 * @returns {Promise<string|null>} null se annullato
 */
function askSessionName(tab) {
  const backdrop = $('#modal-rename');
  const input = $('#rename-input');
  const confirmBtn = $('#rename-confirm');
  const cancelBtn = $('#rename-cancel');
  if (!backdrop || !input || !confirmBtn || !cancelBtn) return Promise.resolve(null);

  const sub = $('#rename-sub');
  if (sub) sub.textContent = [Groups.TYPE_LABELS[tab.type] || tab.type, Groups.shortPath(tab.cwd)].filter(Boolean).join(' · ');
  input.value = tab.name || '';
  backdrop.hidden = false;
  input.focus();
  input.select();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      backdrop.hidden = true;
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && e.target === input) finish(input.value);
    };
    const onBackdrop = (e) => { if (e.target === backdrop) finish(null); };
    const onConfirm = () => finish(input.value);
    const onCancel = () => finish(null);
    const cleanup = () => {
      document.removeEventListener('keydown', onKey);
      backdrop.removeEventListener('click', onBackdrop);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', onBackdrop);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

/** Rinomina manuale: il nome resta legato alla conversazione, non alla scheda. */
async function renameTab(tab) {
  const current = await askSessionName(tab);
  if (current === null) return; // annullato
  const clean = String(current).replace(/\s+/g, ' ').trim();
  if (tab.resumeId) titleStore.setName(tab.type, tab.resumeId, clean);
  if (clean) { tab.name = clean.slice(0, 40); tab.autoNamed = false; syncLabel(tab); }
  else { tab.autoNamed = true; }
  if (tab.type === 'git') saveGitSessions();
  renderSidebar();
  if (!clean) refreshAutoTitles().catch(() => {});
}
