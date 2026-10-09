/* Scelta del branch nella sessione git: si apre dal nome del branch
 * nell'intestazione del pannello. Un campo che filtra i branch locali e
 * remoti e, se il testo non è un branch esistente, propone di crearlo.
 *
 * Il lavoro vero (git switch) lo fa il main (lib/git-branches.js): qui si
 * sceglie e si mostra l'esito. Nomi dei branch sempre con textContent.
 * Da ogni riga che non è il corrente si unisce quel branch nel corrente
 * (⤵, docs/plans/46): la conferma la dà il pannello delle modifiche.
 * Un branch locale con commit che il remoto non ha, o senza upstream, si
 * pusha da ⇡ (docs/plans/47).
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

  /* Larghezza: si trascina il bordo destro, vale per tutte le schede git e
     resta fra un'apertura e l'altra (localStorage, come la sidebar). */
  const MIN_W = 280;
  const DEFAULT_W = 440;
  const MARGIN = 32; // 16px a sinistra (styles.css) + 16px di respiro a destra
  const WIDTH_KEY = 'aisess.gitPickerW';

  /** Larghezza fra MIN_W e lo spazio disponibile; un valore illeggibile vale DEFAULT_W. */
  function clampPickerWidth(width, available) {
    const w = Number(width);
    const max = Math.max(MIN_W, Number(available) || 0);
    return Math.round(Math.min(max, Math.max(MIN_W, Number.isFinite(w) && w > 0 ? w : DEFAULT_W)));
  }

  /**
   * Il pulsante ⇡ di un branch locale, o null se non c'è niente da pushare.
   * I numeri vengono da `%(upstream:track)`: l'ultimo fetch, non il remoto adesso.
   * @param {{name: string, upstream?: string, upstreamRemote?: string, ahead?: number, behind?: number, gone?: boolean}} b
   * @returns {{text: string, title: string}|null}
   */
  function pushLabel(b) {
    if (!b || !b.name) return null;
    if (!b.upstream) return { text: '⇡', title: `Pubblica ${b.name} sul remoto (nuovo upstream)` };
    if (b.upstreamRemote === '.') return null;
    if (b.gone) return { text: '⇡', title: `Ripubblica ${b.name} su ${b.upstream}: sul remoto non c'è più` };
    const ahead = Number(b.ahead) || 0;
    if (ahead <= 0) return null;
    const behind = Number(b.behind) || 0;
    const warn = behind > 0 ? ` · il remoto ha ${behind} commit che ${b.name} non ha: git rifiuterà` : '';
    return { text: `⇡${ahead}`, title: `Push ${b.name} su ${b.upstream} (${ahead} commit)${warn}` };
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /* Cestino: tracciati statici, nessun dato dentro */
  const TRASH = ['M3 4h10', 'M6.5 4V2.5h3V4', 'M4.5 4l.6 9.5h5.8l.6-9.5', 'M7 6.5v5', 'M9 6.5v5'];

  /**
   * @param {object} o
   * @param {(name: string, kind: 'local'|'remote', into: string) =>
   *   Promise<{ok: true, text: string}|{ok: false, error: string}|{cancelled: true}>} [o.onMerge]
   * @param {(name: string) => Promise<{ok: true, text: string}|{ok: false, error: string}>} [o.onPush]
   */
  function createBranchPicker({ document, host, load, onSwitch, onCreate, onDelete = null, onMerge = null, onPush = null, storage = null }) {
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
    const notice = el('p', 'git-picker-notice small');
    notice.hidden = true;
    const note = el('p', 'git-picker-note small muted',
      'Cambia il branch della directory: vale anche per le altre sessioni aperte lì.');
    const grip = el('div', 'git-picker-grip');
    grip.title = 'Trascina per cambiare la larghezza · doppio clic: larghezza iniziale';
    box.append(input, list, error, notice, note, grip);
    host.appendChild(box);

    const savedWidth = () => {
      try { return storage ? storage.getItem(WIDTH_KEY) : null; } catch { return null; }
    };
    const saveWidth = (w) => {
      try { if (storage) storage.setItem(WIDTH_KEY, String(w)); } catch {}
    };
    function applyWidth(w) {
      const width = clampPickerWidth(w, host.clientWidth - MARGIN);
      box.style.width = width + 'px';
      return width;
    }
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = box.getBoundingClientRect().width;
      let width = startW;
      grip.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      const onMove = (ev) => { width = applyWidth(startW + ev.clientX - startX); };
      const onUp = () => {
        grip.classList.remove('dragging');
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveWidth(Math.round(width));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    grip.addEventListener('dblclick', () => saveWidth(applyWidth(DEFAULT_W)));

    let branches = { local: [], remote: [] };
    let busy = false;
    // Branch da eliminare in attesa di conferma; notMerged: git ha già
    // rifiutato -d, la seconda conferma userebbe -D
    let confirming = null;
    // Un merge aspetta la conferma nel pannello: il clic là non chiude il selettore
    let merging = false;

    function showError(text) {
      error.textContent = text || '';
      error.hidden = !text;
      if (text) showNotice('');
    }

    function showNotice(text) {
      notice.textContent = text || '';
      notice.hidden = !text;
    }

    const currentBranch = () => (branches.local.find((b) => b.current) || {}).name || null;

    function item(label, hint, action, cls = '') {
      const b = el('button', 'git-picker-item ' + cls);
      b.type = 'button';
      b.append(el('span', 'git-picker-name', label));
      if (hint) b.append(el('span', 'git-picker-hint', hint));
      b.addEventListener('click', () => run(action));
      return b;
    }

    function trashIcon() {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('aria-hidden', 'true');
      for (const d of TRASH) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
      }
      return svg;
    }

    function button(cls, text, onClick) {
      const b = el('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', onClick);
      return b;
    }

    /* Un branch locale: la voce per passarci e, se non è il corrente, il
       cestino. Confermando, la riga diventa la domanda. */
    function localRow(b) {
      if (confirming && confirming.name === b.name) return confirmRow(b.name);
      const row = el('div', 'git-picker-row');
      row.append(b.current
        ? item(b.name, 'corrente', null, 'git-picker-item--current')
        : item(b.name, b.upstream ? `↔ ${b.upstream}` : '', () => onSwitch(b.name, 'local')));
      const push = pushButton(b);
      if (push) row.append(push);
      const merge = b.current ? null : mergeButton(b.name, 'local');
      if (merge) row.append(merge);
      if (!b.current && onDelete) {
        const del = button('git-picker-delete', undefined, () => {
          confirming = { name: b.name, notMerged: false };
          showError('');
          render();
        });
        del.title = `Elimina il branch locale ${b.name}`;
        del.setAttribute('aria-label', del.title);
        del.append(trashIcon());
        row.append(del);
      }
      return row;
    }

    /* ⤵: unisce `name` nel branch corrente. Niente se la cartella è su un
       commit staccato (nessun corrente) */
    function mergeButton(name, kind) {
      const into = currentBranch();
      if (!onMerge || !into) return null;
      const b = button('git-picker-merge', '⤵', () => runMerge(name, kind, into));
      b.title = `Unisci ${name} in ${into}`;
      b.setAttribute('aria-label', b.title);
      return b;
    }

    /* ⇡: push del branch locale, sull'upstream o pubblicandolo */
    function pushButton(b) {
      const label = onPush ? pushLabel(b) : null;
      if (!label) return null;
      const btn = button('git-picker-push', label.text, () => runPush(b.name));
      btn.title = label.title;
      btn.setAttribute('aria-label', label.title);
      return btn;
    }

    /* Nessuna conferma: il push non tocca la cartella. Il selettore resta
       aperto e dice com'è andata */
    async function runPush(name) {
      if (busy) return;
      busy = true;
      box.classList.add('loading');
      confirming = null;
      showError('');
      showNotice(`Push di ${name}…`);
      render();
      let r = null;
      try {
        r = await onPush(name);
      } catch (e) {
        r = { ok: false, error: String((e && e.message) || e) };
      } finally {
        busy = false;
        box.classList.remove('loading');
      }
      if (!r || !r.ok) { showError((r && r.error) || 'Push non riuscito.'); return; }
      showNotice(r.text);
      await reload();
    }

    function remoteRow(b) {
      const row = el('div', 'git-picker-row');
      row.append(item(b.name, b.hasLocal ? `→ ${b.short} locale` : `→ nuovo ${b.short} locale`, () => onSwitch(b.name, 'remote')));
      const merge = mergeButton(b.name, 'remote');
      if (merge) row.append(merge);
      return row;
    }

    /* Il selettore resta aperto: dice di confermare nel pannello, poi l'esito */
    async function runMerge(name, kind, into) {
      if (busy) return;
      busy = true;
      merging = true;
      box.classList.add('loading');
      confirming = null;
      showError('');
      showNotice(`Guarda nel pannello delle modifiche cosa porta ${name} e conferma lì.`);
      render();
      let r = null;
      try {
        r = await onMerge(name, kind, into);
      } catch (e) {
        r = { ok: false, error: String((e && e.message) || e) };
      } finally {
        busy = false;
        merging = false;
        box.classList.remove('loading');
      }
      if (r && r.cancelled) { showNotice(''); return; }
      if (!r || !r.ok) { showError((r && r.error) || 'Merge non riuscito.'); return; }
      showNotice(r.text);
      await reload();
    }

    function confirmRow(name) {
      const row = el('div', 'git-picker-row git-picker-confirm' + (confirming.notMerged ? ' git-picker-confirm--danger' : ''));
      const text = confirming.notMerged
        ? `«${name}» non è unito ad altri branch: i suoi commit andrebbero persi.`
        : `Eliminare il branch locale «${name}»?`;
      const force = confirming.notMerged;
      const no = button('git-picker-confirm-no', 'Annulla', () => { confirming = null; render(); input.focus(); });
      const yes = button('git-picker-confirm-yes', force ? 'Elimina comunque' : 'Elimina', () => runDelete(name, force));
      row.append(el('span', 'git-picker-confirm-text', text), no, yes);
      return row;
    }

    async function runDelete(name, force) {
      if (busy) return;
      busy = true;
      box.classList.add('loading');
      showError('');
      let r = null;
      try {
        r = await onDelete(name, force);
      } catch (e) {
        r = { ok: false, error: String((e && e.message) || e) };
      } finally {
        busy = false;
        box.classList.remove('loading');
      }
      if (r && r.ok) {
        confirming = null;
        await reload();
        input.focus();
        return;
      }
      // Non unito: la riga stessa lo spiega e propone di eliminarlo comunque
      if (r && r.notMerged && !force) confirming = { name, notMerged: true };
      else { confirming = null; showError((r && r.error) || 'Eliminazione non riuscita.'); }
      render();
    }

    function render() {
      const f = filterBranches(branches, input.value);
      const nodes = [];
      if (f.local.length) nodes.push(el('div', 'git-picker-group', 'Locali'));
      for (const b of f.local) nodes.push(localRow(b));
      if (f.remote.length) nodes.push(el('div', 'git-picker-group', 'Remoti'));
      for (const b of f.remote) nodes.push(remoteRow(b));
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
      applyWidth(savedWidth());
      input.value = '';
      confirming = null;
      showError('');
      showNotice('');
      list.replaceChildren(el('p', 'git-picker-empty small muted', 'Carico i branch…'));
      input.focus();
      await reload();
    }

    /* Rilegge i branch: all'apertura e dopo un'eliminazione */
    async function reload() {
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

    input.addEventListener('input', () => { confirming = null; render(); });
    input.addEventListener('keydown', (e) => {
      // Esc annulla prima una conferma in corso, poi chiude
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (confirming) { confirming = null; render(); } else close();
        return;
      }
      if (e.key === 'Enter' && !confirming) {
        const first = list.querySelector('.git-picker-item:not(.git-picker-item--current)');
        if (first) first.click();
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target !== input && confirming) {
        e.stopPropagation();
        confirming = null;
        render();
        input.focus();
      }
    });
    // Un clic fuori dal riquadro lo chiude (il pulsante che lo apre si gestisce da sé)
    const onOutside = (e) => {
      const t = e.target;
      if (!box.hidden && !merging && !box.contains(t) && !(t && t.closest && t.closest('.git-branch'))) close();
    };
    document.addEventListener('mousedown', onOutside);
    const destroy = () => document.removeEventListener('mousedown', onOutside);

    const toggle = () => (box.hidden ? open() : close());
    return { open, close, toggle, destroy, isOpen: () => !box.hidden, element: box };
  }

  return { createBranchPicker, filterBranches, clampPickerWidth, pushLabel, PICKER_MIN_W: MIN_W, PICKER_DEFAULT_W: DEFAULT_W };
});
