/* Comandi di avvio configurabili: pannello di configurazione (File →
 * Configurazione comandi) e modal di scelta mostrato all'avvio quando un tipo
 * di sessione ha più comandi definiti.
 *
 * Espone il globale `AisessCommands`, usato da renderer.js. Tenuto in un file
 * a sé per non gonfiare renderer.js.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const TYPE_LABELS = { shell: 'Terminale', opencode: 'OpenCode', claude: 'Claude', codex: 'Codex' };
  const TYPE_ICONS = { shell: '🖥', opencode: '⚡', claude: '🤖', codex: '✳' };
  const TYPES = ['shell', 'opencode', 'claude', 'codex'];
  const LAST_USED_KEY = 'aisess.commandProfile.';

  /* Configurazione corrente (dal main process) — sostituita, mai mutata. */
  let config = { version: 1, profiles: {} };
  let loaded = false;

  /* Bozza in editing nel pannello: { tipo: [profili] } */
  let draft = null;
  let configTab = 'shell';

  async function load(force) {
    if (loaded && !force) return config;
    try {
      const r = await window.aisess.getCommandProfiles();
      if (r && r.ok && r.config) {
        config = r.config;
        loaded = true;
      } else if (r && r.error) {
        console.error('get-command-profiles:', r.error);
      }
    } catch (e) {
      console.error('get-command-profiles fallito', e);
    }
    return config;
  }

  function profilesFor(type) {
    const list = (config.profiles && config.profiles[type]) || [];
    return list.map((p) => ({ ...p }));
  }

  function labelFor(type, id) {
    if (!id) return null;
    const p = profilesFor(type).find((x) => x.id === id);
    return p ? p.label : null;
  }

  function lastUsed(type) {
    try { return localStorage.getItem(LAST_USED_KEY + type); } catch { return null; }
  }

  function rememberUsed(type, id) {
    try { localStorage.setItem(LAST_USED_KEY + type, id); } catch {}
  }

  /* ---------- Scelta del comando all'avvio ---------- */

  /**
   * Restituisce il comando da usare per una nuova sessione.
   * Con un solo comando configurato non chiede nulla.
   * @returns {Promise<{ ok: boolean, id: string|null, label: string|null }>}
   */
  async function choose(type, context = {}) {
    await load();
    const list = profilesFor(type);
    if (!list.length) return { ok: true, id: null, label: null };
    if (list.length === 1) return { ok: true, id: list[0].id, label: list[0].label };
    return askProfile(type, list, context);
  }

  function askProfile(type, list, context) {
    const backdrop = $('#modal-pick-command');
    const box = $('#pick-command-list');
    const sub = $('#pick-command-sub');
    if (!backdrop || !box) return Promise.resolve({ ok: true, id: list[0].id, label: list[0].label });

    const where = [TYPE_LABELS[type] || type, context.cwd || null, context.resumeId ? 'resume' : null]
      .filter(Boolean)
      .join(' · ');
    sub.textContent = where;

    return new Promise((resolve) => {
      const previous = lastUsed(type);
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        backdrop.hidden = true;
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') finish({ ok: false, id: null, label: null });
      };
      const onBackdrop = (e) => {
        if (e.target === backdrop) finish({ ok: false, id: null, label: null });
      };
      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
        backdrop.removeEventListener('click', onBackdrop);
        cancelBtn.removeEventListener('click', onCancel);
        box.replaceChildren();
      };
      const onCancel = () => finish({ ok: false, id: null, label: null });
      const cancelBtn = $('#pick-command-cancel');

      const items = list.map((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cmd-choice' + (p.id === previous ? ' last-used' : '');
        b.title = p.command;
        const head = document.createElement('span');
        head.className = 'cmd-choice-label';
        head.textContent = `${TYPE_ICONS[type] || '•'} ${p.label}`;
        const cmd = document.createElement('span');
        cmd.className = 'cmd-choice-cmd';
        cmd.textContent = p.command;
        b.append(head, cmd);
        if (p.id === previous) {
          const tag = document.createElement('span');
          tag.className = 'cmd-choice-tag';
          tag.textContent = 'ultimo usato';
          b.appendChild(tag);
        }
        b.addEventListener('click', () => {
          rememberUsed(type, p.id);
          finish({ ok: true, id: p.id, label: p.label });
        });
        return b;
      });
      box.replaceChildren(...items);
      backdrop.hidden = false;
      document.addEventListener('keydown', onKey);
      backdrop.addEventListener('click', onBackdrop);
      cancelBtn.addEventListener('click', onCancel);
      const preferred = items.find((b) => b.classList.contains('last-used')) || items[0];
      if (preferred) preferred.focus();
    });
  }

  /* ---------- Pannello di configurazione ---------- */

  function cloneDraft(cfg) {
    const out = {};
    for (const type of TYPES) out[type] = ((cfg.profiles && cfg.profiles[type]) || []).map((p) => ({ ...p }));
    return out;
  }

  function newProfileId(type) {
    return `${type}:${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  }

  /** Aggiorna un campo di un profilo senza mutare la bozza esistente. */
  function updateDraft(type, index, patch) {
    draft = {
      ...draft,
      [type]: draft[type].map((p, i) => (i === index ? { ...p, ...patch } : p)),
    };
  }

  function showConfigError(message) {
    const el = $('#config-error');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = '⚠ ' + message;
    el.hidden = false;
  }

  function fieldRow(labelText, input) {
    const wrap = document.createElement('label');
    wrap.className = 'cmd-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    wrap.append(span, input);
    return wrap;
  }

  function textInput(value, placeholder, onInput) {
    const i = document.createElement('input');
    i.className = 'input';
    i.type = 'text';
    i.value = value || '';
    i.placeholder = placeholder;
    i.addEventListener('input', () => onInput(i.value));
    return i;
  }

  function renderConfigList() {
    const box = $('#config-list');
    if (!box || !draft) return;
    const list = draft[configTab] || [];
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'Nessun comando: aggiungine almeno uno per poter avviare questo tipo di sessione.';
      box.replaceChildren(p);
      return;
    }
    const rows = list.map((profile, index) => {
      const row = document.createElement('div');
      row.className = 'cmd-row';

      const head = document.createElement('div');
      head.className = 'cmd-row-head';
      const num = document.createElement('span');
      num.className = 'cmd-row-num';
      num.textContent = `${index + 1}.`;
      head.appendChild(num);
      const del = document.createElement('button');
      del.className = 'btn btn--ghost';
      del.textContent = 'Elimina';
      del.title = list.length > 1 ? 'Rimuovi questo comando' : 'Serve almeno un comando per tipo';
      del.disabled = list.length <= 1;
      del.addEventListener('click', () => {
        draft = { ...draft, [configTab]: draft[configTab].filter((_, i) => i !== index) };
        showConfigError('');
        renderConfigList();
      });
      head.appendChild(del);
      row.appendChild(head);

      row.appendChild(fieldRow('Nome', textInput(profile.label, 'es. Claude con Opus', (v) => updateDraft(configTab, index, { label: v }))));
      row.appendChild(fieldRow('Comando', textInput(profile.command, 'es. claude --model opus', (v) => updateDraft(configTab, index, { command: v }))));
      row.appendChild(fieldRow('Argomenti resume', textInput(profile.resumeArgs, 'es. --resume {id} (vuoto = resume non supportato)', (v) => updateDraft(configTab, index, { resumeArgs: v }))));
      return row;
    });
    box.replaceChildren(...rows);
  }

  function setConfigTab(type) {
    configTab = type;
    $$('#config-tabs .tab').forEach((t) => {
      const on = t.dataset.configTab === type;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    showConfigError('');
    renderConfigList();
  }

  async function openConfig() {
    await load(true);
    draft = cloneDraft(config);
    setConfigTab(configTab);
    showConfigError('');
    $('#modal-config').hidden = false;
  }

  function closeConfig() {
    $('#modal-config').hidden = true;
    draft = null;
  }

  async function saveConfig() {
    if (!draft) return;
    for (const type of TYPES) {
      if (!draft[type] || !draft[type].length) {
        setConfigTab(type);
        showConfigError(`Serve almeno un comando per "${TYPE_LABELS[type] || type}".`);
        return;
      }
    }
    let r;
    try {
      r = await window.aisess.saveCommandProfiles(draft);
    } catch (e) {
      showConfigError('Salvataggio fallito: ' + String((e && e.message) || e));
      return;
    }
    if (!r || !r.ok) {
      showConfigError((r && r.error) || 'Salvataggio fallito.');
      return;
    }
    config = r.config;
    loaded = true;
    closeConfig();
    if (typeof window.onCommandProfilesChanged === 'function') window.onCommandProfilesChanged(config);
  }

  async function resetConfig() {
    let r;
    try {
      r = await window.aisess.resetCommandProfiles();
    } catch (e) {
      showConfigError('Ripristino fallito: ' + String((e && e.message) || e));
      return;
    }
    if (!r || !r.ok) {
      showConfigError((r && r.error) || 'Ripristino fallito.');
      return;
    }
    config = r.config;
    loaded = true;
    draft = cloneDraft(config);
    showConfigError('');
    renderConfigList();
  }

  function initConfigUI() {
    $$('#config-tabs .tab').forEach((t) => t.addEventListener('click', () => setConfigTab(t.dataset.configTab)));
    $('#config-add').addEventListener('click', () => {
      const list = draft[configTab] || [];
      const base = list[0] || { command: '', resumeArgs: '' };
      draft = {
        ...draft,
        [configTab]: [...list, { id: newProfileId(configTab), label: '', command: base.command, resumeArgs: base.resumeArgs }],
      };
      showConfigError('');
      renderConfigList();
    });
    $('#config-reset').addEventListener('click', resetConfig);
    $('#config-cancel').addEventListener('click', closeConfig);
    $('#config-save').addEventListener('click', saveConfig);
    const backdrop = $('#modal-config');
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeConfig(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !backdrop.hidden) closeConfig();
    });
  }

  window.AisessCommands = { load, profilesFor, labelFor, choose, openConfig, initConfigUI, rememberUsed };
})();
