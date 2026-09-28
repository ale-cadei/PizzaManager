/* All'avvio: riattacco alle sessioni tmux vive e ripristino dopo un
   riavvio della macchina. */

/**
 * All'avvio: le sessioni tmux vive dell'app tornano come schede, riattaccate.
 * E' il motivo per cui esiste il backend tmux (docs/plans/06-tmux-backend.md).
 */
async function reattachLiveSessions() {
  if (!tmuxAvailable) return;
  let live = [];
  try { live = await window.aisess.listLive(); } catch (e) { console.warn('list-live-sessions fallito', e); return; }
  for (const s of live) {
    // Si salta solo cio' che questo renderer ha gia' in una scheda. Un client
    // attaccato nel main senza una scheda qui e' di un renderer precedente
    // (hard refresh): va riagganciato, e attach() chiude quello vecchio.
    if ([...tabs.values()].some((t) => t.session === s.name)) continue;
    await createTab(s.type || 'shell', {
      name: s.label || null,
      cwd: s.cwd || undefined,
      resumeId: s.resumeId || null,
      claudeAccountId: s.accountId || null,
      commandProfileId: s.profileId || null,
      commandProfileLabel: s.profileLabel || null,
      attachSession: s.name,
      // L'istante di avvio e' quello della sessione tmux, non del riattacco:
      // senza id, la conversazione va cercata da quando e' nata davvero.
      startedAt: s.createdAt || Date.now(),
    });
  }
}

/**
 * Dopo un riavvio della macchina tmux e' vuoto ma il registro no: si propone
 * di ricreare quelle sessioni. Con l'id della conversazione si riprende
 * (`--resume`); senza, si riparte pulita nella stessa directory. Si chiede,
 * non si fa da soli: N processi che partono senza permesso sono invadenti.
 * Nella stessa lista le schede git aperte al riavvio (restoreGitSessions),
 * che si propongono anche senza tmux.
 */
async function offerRestore(gitLost = []) {
  let lost = [];
  if (tmuxAvailable) {
    try { lost = await window.aisess.restorable(); } catch (e) { console.warn('restorable-sessions fallito', e); }
  }
  const items = [...lost.map(sessionRestoreItem), ...gitLost.map(gitRestoreItem)];
  if (!items.length) return;

  const backdrop = $('#modal-restore');
  const list = $('#restore-list');
  const sub = $('#restore-sub');
  if (!backdrop || !list) return;
  list.innerHTML = '';
  sub.textContent = items.length === 1
    ? 'Una sessione era aperta quando il computer si è spento o l\'app è stata chiusa dal sistema.'
    : `${items.length} sessioni erano aperte quando il computer si è spento o l'app è stata chiusa dal sistema.`;
  const rows = items.map((item) => {
    const row = restoreRow(item);
    list.appendChild(row.el);
    return { cb: row.cb, item };
  });

  // Il registro tmux si ricostruisce da solo con le nuove sessioni; quello
  // delle schede git si riscrive con quelle riaperte (nessuna, se "Non ora").
  const forget = () => (lost.length ? window.aisess.discardRestorable() : Promise.resolve());
  const saveGit = () => (gitLost.length ? saveGitSessions() : Promise.resolve());
  await new Promise((resolve) => {
    const done = () => { backdrop.hidden = true; confirmBtn.onclick = null; dismissBtn.onclick = null; resolve(); };
    const confirmBtn = $('#restore-confirm');
    const dismissBtn = $('#restore-dismiss');
    confirmBtn.onclick = async () => {
      const chosen = rows.filter((r) => r.cb.checked).map((r) => r.item);
      done();
      await forget();
      for (const item of chosen) await item.restore();
      await saveGit();
    };
    dismissBtn.onclick = async () => { done(); await forget(); await saveGit(); };
    backdrop.hidden = false;
  });
}

/* Una voce della finestra: cosa mostrare e come riaprirla */
function sessionRestoreItem(s) {
  const plan = restorePlanFor(s);
  const type = plan.type;
  const how = plan.mode === 'resume' ? 'riprende la conversazione' : (type === 'shell' ? 'nuova shell' : 'ripartirà pulita, senza id');
  return {
    type, name: s.label || type, cwd: s.cwd, how,
    restore: () => createTab(plan.type, { name: plan.name, cwd: plan.cwd, resumeId: plan.resumeId, claudeAccountId: plan.claudeAccountId, commandProfileId: plan.commandProfileId, previousSession: plan.previousSession }),
  };
}

function gitRestoreItem(s) {
  const repoName = String(s.cwd || '').split(/[\\/]/).filter(Boolean).pop();
  return {
    type: 'git', name: s.name || repoName || 'git', cwd: s.cwd, how: 'timeline git',
    restore: () => createGitTab({ name: s.name, cwd: s.cwd, startedAt: s.startedAt }),
  };
}

/* Stessa card della sidebar (scatola, barra colorata del tipo, icona), con
   una spunta a sinistra. Un div e non un <label>: nei modal i label sono in
   colonna per i campi dei form e metterebbero la spunta sopra. */
function restoreRow({ type, name, cwd, how }) {
  const row = document.createElement('div');
  row.className = `session-item type-${type} restore-row`;
  row.setAttribute('role', 'checkbox');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = true; cb.className = 'restore-check';
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.innerHTML = Icons.markup(type); // markup statico, nessun dato utente
  const meta = document.createElement('span');
  meta.className = 'meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = [Groups.shortPath(cwd), how].filter(Boolean).join(' · ');
  sub.title = [cwd || '', how].filter(Boolean).join(' · ');
  meta.appendChild(nameEl); meta.appendChild(sub);
  row.appendChild(cb); row.appendChild(icon); row.appendChild(meta);
  const sync = () => { row.setAttribute('aria-checked', String(cb.checked)); row.classList.toggle('is-off', !cb.checked); };
  row.onclick = (e) => { if (e.target !== cb) cb.checked = !cb.checked; sync(); };
  cb.onchange = sync;
  sync();
  return { el: row, cb };
}

/** Stessa logica di lib/live-sessions.js#restorePlan, lato renderer (che non puo' importarla). */
function restorePlanFor(s) {
  const type = s.type || 'shell';
  const base = { type, cwd: s.cwd || undefined, commandProfileId: s.profileId || null, claudeAccountId: s.accountId || null, name: s.label || null, previousSession: s.name || null };
  if (type !== 'shell' && s.resumeId) return { ...base, resumeId: s.resumeId, mode: 'resume' };
  return { ...base, resumeId: null, mode: 'fresh' };
}
