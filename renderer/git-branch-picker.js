/* Scelta del branch nella sessione git: si apre dal nome del branch
 * nell'intestazione del pannello. Un campo che filtra i branch locali e
 * remoti e, se il testo non è un branch esistente, propone di crearlo.
 *
 * Il lavoro vero (git switch) lo fa il main (lib/git-branches.js): qui si
 * sceglie e si mostra l'esito. Nomi dei branch sempre con textContent.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessGitBranchPicker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /**
   * Branch che corrispondono al testo, e se proporre di crearne uno.
   * @param {{local?: object[], remote?: object[]}} branches da listBranches
   * @param {string} query
   */
  function filterBranches(branches, query) {
    const q = String(query || '').trim();
    const needle = q.toLowerCase();
    const match = (b) => !needle || b.name.toLowerCase().includes(needle);
    const local = (branches && branches.local || []).filter(match);
    const remote = (branches && branches.remote || []).filter(match);
    const exists = (branches && branches.local || []).some((b) => b.name === q);
    return { local, remote, create: q && !exists ? q : '' };
  }

  function createBranchPicker({ document, host, load, onSwitch, onCreate }) {
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const box = el('div', 'git-picker');
    box.hidden = true;
    const input = el('input', 'git-picker-input');
    input.type = 'text';
    input.placeholder = 'Cerca un branch o scrivi il nome di uno nuovo';
    input.setAttribute('aria-label', 'Branch');
    const list = el('div', 'git-picker-list');
    const error = el('p', 'git-picker-error small');
    error.hidden = true;
    const note = el('p', 'git-picker-note small muted',
      'Cambia il branch della directory: vale anche per le altre sessioni aperte lì.');
    box.append(input, list, error, note);
    host.appendChild(box);

    let branches = { local: [], remote: [] };
    let busy = false;

    function showError(text) {
      error.textContent = text || '';
      error.hidden = !text;
    }

    function item(label, hint, action, cls = '') {
      const b = el('button', 'git-picker-item ' + cls);
      b.type = 'button';
      b.append(el('span', 'git-picker-name', label));
      if (hint) b.append(el('span', 'git-picker-hint', hint));
      b.addEventListener('click', () => run(action));
      return b;
    }

    function render() {
      const f = filterBranches(branches, input.value);
      const nodes = [];
      if (f.local.length) nodes.push(el('div', 'git-picker-group', 'Locali'));
      for (const b of f.local) {
        nodes.push(b.current
          ? item(b.name, 'corrente', null, 'git-picker-item--current')
          : item(b.name, b.upstream ? `↔ ${b.upstream}` : '', () => onSwitch(b.name, 'local')));
      }
      if (f.remote.length) nodes.push(el('div', 'git-picker-group', 'Remoti'));
      for (const b of f.remote) {
        nodes.push(item(b.name, b.hasLocal ? `→ ${b.short} locale` : `→ nuovo ${b.short} locale`, () => onSwitch(b.name, 'remote')));
      }
      // In fondo: Invio sceglie il primo della lista, e un branch che esiste
      // viene prima di crearne uno nuovo con un nome simile
      if (f.create) nodes.push(item(`+ Crea «${f.create}»`, 'dal commit corrente', () => onCreate(f.create), 'git-picker-item--create'));
      if (!nodes.length) nodes.push(el('p', 'git-picker-empty small muted', 'Nessun branch.'));
      list.replaceChildren(...nodes);
    }

    async function run(action) {
      if (!action || busy) return;
      busy = true;
      box.classList.add('loading');
      showError('');
      try {
        const r = await action();
        if (r && r.ok) close();
        else showError((r && r.error) || 'Operazione non riuscita.');
      } catch (e) {
        showError(String((e && e.message) || e));
      } finally {
        busy = false;
        box.classList.remove('loading');
      }
    }

    async function open() {
      box.hidden = false;
      input.value = '';
      showError('');
      list.replaceChildren(el('p', 'git-picker-empty small muted', 'Carico i branch…'));
      input.focus();
      try {
        const r = await load();
        if (!r || !r.ok) { branches = { local: [], remote: [] }; showError((r && r.error) || 'Impossibile leggere i branch.'); }
        else branches = { local: r.local, remote: r.remote };
      } catch (e) {
        showError(String((e && e.message) || e));
      }
      render();
    }

    function close() {
      box.hidden = true;
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Enter') {
        const first = list.querySelector('.git-picker-item:not(.git-picker-item--current)');
        if (first) first.click();
      }
    });
    // Un clic fuori dal riquadro lo chiude (il pulsante che lo apre si gestisce da sé)
    const onOutside = (e) => {
      const t = e.target;
      if (!box.hidden && !box.contains(t) && !(t && t.closest && t.closest('.git-branch'))) close();
    };
    document.addEventListener('mousedown', onOutside);
    const destroy = () => document.removeEventListener('mousedown', onOutside);

    const toggle = () => (box.hidden ? open() : close());
    return { open, close, toggle, destroy, isOpen: () => !box.hidden, element: box };
  }

  return { createBranchPicker, filterBranches };
});
