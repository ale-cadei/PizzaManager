/* Dialogo «Animaletti» (menu View): accesi o no, quanti di ogni personaggio,
 * dimensione e velocità. Ogni ritocco passa a `onChange`, che ridisegna la
 * striscia: si vede mentre si sceglie. «Annulla» (o Esc, o click fuori)
 * rimette quello salvato. La logica sta in pets-config.js; qui solo il DOM.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = root
    ? factory(root.AisessPetsConfig, root.AisessPetsSprites)
    : factory(require('./pets-config'), require('./pets-sprites'));
  if (root) root.AisessPetsUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Config, Sprites) {
  const SIZE_LABELS = { s: 'Piccoli', m: 'Medi', l: 'Grandi' };
  const SPEED_LABELS = { lenta: 'Lenti', normale: 'Normali', veloce: 'Veloci' };
  const CAST_IDS = Object.keys(Sprites.CAST);

  const countOf = (cast, id) => cast.filter((c) => c === id).length;
  /** Il cast nell'ordine del catalogo: le voci uguali stanno vicine. */
  const castFrom = (counts) => CAST_IDS.flatMap((id) => Array(counts[id] || 0).fill(id));

  /**
   * @param {{ doc: Document, backdrop: HTMLElement, body: HTMLElement,
   *   saveBtn: HTMLElement, cancelBtn: HTMLElement,
   *   store: ReturnType<Config['createPetsStore']>,
   *   onChange?: (config: object) => void }} opts
   */
  function createPetsDialog({ doc, backdrop, body, saveBtn, cancelBtn, store, onChange = () => {} }) {
    let draft = store.get();
    let refresh = () => {};
    let isOpen = false;

    function update(patch) {
      draft = Config.sanitizeConfig({ ...draft, ...patch });
      refresh();
      onChange(draft);
    }

    function el(tag, props = {}, children = []) {
      const node = doc.createElement(tag);
      Object.entries(props).forEach(([k, v]) => {
        if (k === 'dataset') Object.assign(node.dataset, v);
        else node[k] = v;
      });
      children.forEach((c) => node.appendChild(c));
      return node;
    }

    function select(field, labels) {
      const node = el('select', { className: 'input', dataset: { field } },
        Object.entries(labels).map(([value, textContent]) => el('option', { value, textContent })));
      node.value = draft[field];
      node.addEventListener('change', () => update({ [field]: node.value }));
      return node;
    }

    function castRow(id) {
      const count = el('span', { className: 'pets-count', dataset: { count: id } });
      const minus = el('button', { type: 'button', className: 'btn btn--ghost pets-step', textContent: '–', dataset: { step: '-1' } });
      const plus = el('button', { type: 'button', className: 'btn btn--ghost pets-step', textContent: '+', dataset: { step: '1' } });
      const change = (delta) => {
        const counts = Object.fromEntries(CAST_IDS.map((c) => [c, countOf(draft.cast, c)]));
        update({ cast: castFrom({ ...counts, [id]: Math.max(0, counts[id] + delta) }) });
      };
      minus.addEventListener('click', () => change(-1));
      plus.addEventListener('click', () => change(1));
      const row = el('div', { className: 'pets-row', dataset: { cast: id } },
        [el('span', { className: 'pets-name', textContent: Sprites.CAST_LABELS[id] }), minus, count, plus]);
      const paint = () => {
        const n = countOf(draft.cast, id);
        count.textContent = String(n);
        minus.disabled = n === 0;
        plus.disabled = draft.cast.length >= Config.MAX_CAST;
      };
      return { row, paint };
    }

    function build() {
      const enabled = el('input', { type: 'checkbox', dataset: { field: 'enabled' } });
      enabled.checked = draft.enabled;
      enabled.addEventListener('change', () => update({ enabled: enabled.checked }));
      const rows = CAST_IDS.map(castRow);
      const total = el('p', { className: 'muted small pets-total' });
      body.replaceChildren(
        el('label', { className: 'pets-toggle' }, [enabled, el('span', { textContent: 'Mostra gli animaletti in fondo alla finestra' })]),
        ...rows.map((r) => r.row),
        total,
        el('label', { textContent: 'Dimensione' }, [select('size', SIZE_LABELS)]),
        el('label', { textContent: 'Velocità' }, [select('speed', SPEED_LABELS)]),
      );
      refresh = () => {
        rows.forEach((r) => r.paint());
        total.textContent = `Scelti: ${draft.cast.length} su ${Config.MAX_CAST}`;
      };
      refresh();
    }

    function close(config) {
      if (!isOpen) return;
      isOpen = false;
      backdrop.hidden = true;
      doc.removeEventListener('keydown', onKey);
      onChange(config);
    }

    const onKey = (e) => { if (e.key === 'Escape') close(store.get()); };
    saveBtn.addEventListener('click', () => close(store.save(draft)));
    cancelBtn.addEventListener('click', () => close(store.get()));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(store.get()); });

    function open() {
      if (isOpen) return;
      isOpen = true;
      draft = store.get();
      build();
      backdrop.hidden = false;
      doc.addEventListener('keydown', onKey);
    }

    return { open, isOpen: () => isOpen };
  }

  return { createPetsDialog };
});
