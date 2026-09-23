/* Account Claude multipli nei modal Nuova sessione e Resume. */

/* ---------- Account Claude multipli ---------- */
let claudeAccounts = { oauth: { available: false, label: '' }, accounts: [] };

async function ensureClaudeAccounts(force) {
  if (!force && ensureClaudeAccounts._done) return claudeAccounts;
  try {
    claudeAccounts = await window.aisess.listClaudeAccounts();
    ensureClaudeAccounts._done = true;
  } catch (e) { console.warn('list-claude-accounts fallito', e); }
  return claudeAccounts;
}

function claudeAccountOptions() {
  const opts = [];
  if (claudeAccounts.oauth && claudeAccounts.oauth.available)
    opts.push({ value: 'oauth', label: 'OAuth — ' + (claudeAccounts.oauth.label || 'login corrente') });
  for (const a of (claudeAccounts.accounts || []))
    opts.push({ value: a.id, label: a.name + ' (API key)' });
  if (!opts.length) opts.push({ value: 'oauth', label: 'Default (ambiente corrente)' });
  return opts;
}

function claudeAccountLabel(id) {
  if (!id || id === 'oauth') {
    if (claudeAccounts.oauth && claudeAccounts.oauth.available) return 'OAuth';
    return null;
  }
  const a = (claudeAccounts.accounts || []).find(x => x.id === id);
  return a ? a.name : null;
}

function fillAccountSelect(sel) {
  if (!sel) return;
  let last = null;
  try { last = localStorage.getItem('aisess.claudeAccount'); } catch {}
  sel.innerHTML = '';
  for (const o of claudeAccountOptions()) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  if (last && [...sel.options].some(o => o.value === last)) sel.value = last;
}

// Mostra il selettore solo se ci sono davvero più account tra cui scegliere
async function updateClaudeAccountRow() {
  const row = $('#claude-account-row');
  if (!row) return;
  if (pendingNewType !== 'claude') { row.hidden = true; return; }
  await ensureClaudeAccounts();
  const multi = claudeAccountOptions().length > 1;
  row.hidden = !multi;
  if (multi) fillAccountSelect($('#new-claude-account'));
}

async function updateResumeAccountRow() {
  const row = $('#resume-account-row');
  if (!row) return;
  if (resumeTab !== 'claude') { row.hidden = true; return; }
  await ensureClaudeAccounts();
  const multi = claudeAccountOptions().length > 1;
  row.hidden = !multi;
  if (multi) fillAccountSelect($('#resume-claude-account'));
}

function selectedResumeAccount() {
  const row = $('#resume-account-row');
  if (!row || row.hidden) return null;
  const v = ($('#resume-claude-account') || {}).value || null;
  if (v) { try { localStorage.setItem('aisess.claudeAccount', v); } catch {} }
  return v;
}

function renderAccountManager(error) {
  const box = $('#account-list');
  if (!box) return;
  box.innerHTML = '';
  if (error) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = '⚠ ' + error;
    box.appendChild(p);
  }
  const oauthRow = document.createElement('div');
  oauthRow.className = 'account-row';
  oauthRow.innerHTML = `<span class="meta">OAuth — ${escapeHtml((claudeAccounts.oauth && claudeAccounts.oauth.label) || 'login corrente')}</span>`;
  const src = document.createElement('span');
  src.className = 'src';
  src.textContent = (claudeAccounts.oauth && claudeAccounts.oauth.available) ? 'rilevato' : 'non rilevato';
  oauthRow.appendChild(src);
  box.appendChild(oauthRow);
  for (const a of (claudeAccounts.accounts || [])) {
    const el = document.createElement('div');
    el.className = 'account-row';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = a.name;
    const s = document.createElement('span');
    s.className = 'src';
    s.textContent = 'API key';
    const del = document.createElement('button');
    del.className = 'btn btn--ghost';
    del.textContent = 'Elimina';
    del.onclick = async () => {
      await window.aisess.deleteClaudeAccount(a.id);
      await ensureClaudeAccounts(true);
      fillAccountSelect($('#new-claude-account'));
      fillAccountSelect($('#resume-claude-account'));
      renderAccountManager();
      updateClaudeAccountRow();
    };
    el.appendChild(meta);
    el.appendChild(s);
    el.appendChild(del);
    box.appendChild(el);
  }
  if (!(claudeAccounts.accounts || []).length) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Nessun account API key salvato. Aggiungine uno qui sotto per poter scegliere.';
    box.appendChild(p);
  }
}
