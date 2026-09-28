/* Finestra "Plugin e skill" (docs/plans/29): il contenuto di una scheda,
 * cioè plugin e cartelle di skill di un CLI, con il filtro.
 *
 * Nomi e descrizioni arrivano da file scritti da altri (manifest, SKILL.md):
 * si costruisce tutto con createElement e textContent, mai innerHTML.
 *
 * Espone il globale `AisessExtensions`; sotto Node esporta lo stesso oggetto.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessExtensions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const norm = (s) => String(s || '').toLowerCase();
  const matches = (q, ...fields) => fields.some((f) => norm(f).includes(q));

  /**
   * Solo ciò che contiene il testo cercato. Un plugin che corrisponde per nome
   * o descrizione tiene tutto il suo contenuto; altrimenti restano le sue
   * skill che corrispondono.
   */
  function filterCli(cli, query) {
    const q = norm(query).trim();
    if (!q || !cli) return cli;
    const hit = (i) => matches(q, i.name, i.description);
    const plugins = cli.plugins.flatMap((p) => {
      if (matches(q, p.name, p.description, p.marketplace)) return [p];
      const items = p.items.filter(hit);
      return items.length ? [{ ...p, items }] : [];
    });
    const skillDirs = cli.skillDirs
      .map((d) => ({ ...d, items: d.items.filter(hit) }))
      .filter((d) => d.items.length);
    return { ...cli, plugins, skillDirs };
  }

  /** Quanti plugin e quante skill/comandi, per l'etichetta della scheda. */
  function countOf(cli) {
    if (!cli) return { plugins: 0, items: 0 };
    const inPlugins = cli.plugins.reduce((n, p) => n + p.items.length, 0);
    const inDirs = cli.skillDirs.reduce((n, d) => n + d.items.length, 0);
    return { plugins: cli.plugins.length, items: inPlugins + inDirs };
  }

  /** "3 skill · 2 comandi" */
  function itemsSummary(items) {
    const skills = items.filter((i) => i.kind !== 'command').length;
    const commands = items.length - skills;
    return [skills ? `${skills} skill` : '', commands ? `${commands} ${commands === 1 ? 'comando' : 'comandi'}` : '']
      .filter(Boolean).join(' · ');
  }

  /** Cosa dire accanto al nome: disattivato, mancante, valido solo in un progetto. */
  function pluginFlags(p) {
    const flags = [];
    if (p.enabled === false) flags.push({ text: 'disattivato', tone: 'off' });
    if (p.missing) flags.push({ text: 'non trovato su disco', tone: 'warn' });
    if (p.scope) flags.push({ text: p.scope, tone: '' });
    return flags;
  }

  /** "Skill", "Comandi", "Skill del progetto"… */
  function dirTitle(d) {
    const what = d.items.some((i) => i.kind === 'command') ? 'Comandi' : 'Skill';
    return d.project ? `${what} del progetto` : what;
  }

  /** La riga sotto il titolo: di quale progetto si vedono anche le skill. */
  function projectLine(project) {
    return project
      ? `Globali e del progetto ${project}.`
      : 'Solo globali: apri una sessione in un progetto per vedere anche le sue.';
  }

  function createExtensionsView({ root, document: doc = (typeof document !== 'undefined' ? document : null) }) {
    if (!root || !doc) throw new Error('createExtensionsView: servono root e document');

    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      return node;
    }

    function itemRow(i) {
      const li = el('li', 'ext-item');
      const head = el('div', 'ext-item-head');
      head.appendChild(el('span', 'ext-item-name', i.kind === 'command' ? `/${i.name}` : i.name));
      if (i.kind === 'command') head.appendChild(el('span', 'ext-chip', 'comando'));
      li.appendChild(head);
      li.appendChild(el('div', 'ext-desc', i.description || 'Nessuna descrizione.'));
      return li;
    }

    function itemList(items) {
      const ul = el('ul', 'ext-items');
      for (const i of items) ul.appendChild(itemRow(i));
      return ul;
    }

    function pluginHead(p) {
      const head = el('div', 'ext-plugin-head');
      head.appendChild(el('span', 'ext-plugin-name', p.name));
      if (p.version) head.appendChild(el('span', 'ext-chip', p.version));
      if (p.marketplace) head.appendChild(el('span', 'ext-muted', p.marketplace));
      for (const f of pluginFlags(p)) head.appendChild(el('span', `ext-chip${f.tone ? ` ext-chip--${f.tone}` : ''}`, f.text));
      const count = itemsSummary(p.items);
      if (count) head.appendChild(el('span', 'ext-count', count));
      return head;
    }

    /* Con skill o comandi il plugin si apre e si chiude; senza, è solo la sua riga */
    function pluginCard(p, open) {
      const desc = el('div', 'ext-desc', p.description || 'Nessuna descrizione.');
      if (!p.items.length) {
        const card = el('div', 'ext-plugin');
        card.appendChild(pluginHead(p));
        card.appendChild(desc);
        return card;
      }
      const card = el('details', 'ext-plugin');
      card.open = open;
      const summary = el('summary');
      summary.appendChild(pluginHead(p));
      summary.appendChild(desc);
      card.appendChild(summary);
      card.appendChild(itemList(p.items));
      return card;
    }

    function section(title, detail) {
      const box = el('section', 'ext-section');
      const h = el('h3', 'ext-section-title', title);
      if (detail) h.appendChild(el('span', 'ext-muted', detail));
      box.appendChild(h);
      return box;
    }

    /** Disegna un CLI; `query` filtra, e apre i plugin per mostrare cosa corrisponde. */
    function render(cli, query) {
      root.replaceChildren();
      if (!cli) return;
      if (!cli.ok) {
        root.appendChild(el('p', 'ext-empty ext-error', `Lettura non riuscita: ${cli.error || 'errore sconosciuto'}`));
        return;
      }
      const shown = filterCli(cli, query);
      const filtering = Boolean(norm(query).trim());
      if (!shown.plugins.length && !shown.skillDirs.length) {
        root.appendChild(el('p', 'ext-empty', filtering ? 'Nessun plugin o skill corrisponde.' : `Nessun plugin o skill trovato per ${cli.label}.`));
        return;
      }
      if (shown.plugins.length) {
        const box = section('Plugin', String(shown.plugins.length));
        for (const p of shown.plugins) box.appendChild(pluginCard(p, filtering));
        root.appendChild(box);
      }
      for (const d of shown.skillDirs) {
        const box = section(dirTitle(d), `${d.dir} · ${d.items.length}`);
        if (d.project) box.classList.add('ext-section--project');
        box.appendChild(itemList(d.items));
        root.appendChild(box);
      }
    }

    return { render };
  }

  return { filterCli, countOf, itemsSummary, pluginFlags, dirTitle, projectLine, createExtensionsView };
});
