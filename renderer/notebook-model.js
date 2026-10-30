/* Un notebook Jupyter (.ipynb) letto per la vista della scheda editor
 * (docs/plans/75): dal JSON nbformat 4 alle celle da disegnare, con un solo
 * formato per output e le immagini già pronte come `data:`. Non disegna
 * niente: notebook-view.js. Funzioni pure.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessNotebookModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const RASTER = ['image/png', 'image/jpeg', 'image/gif'];
  const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
  // eslint-disable-next-line no-control-regex
  const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

  const isNotebook = (rel) => typeof rel === 'string' && /(^|[\\/])[^\\/]+\.ipynb$/i.test(rel);
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** nbformat scrive il testo come stringa o come array di righe. */
  function joined(v) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.filter((s) => typeof s === 'string').join('');
    return '';
  }

  const stripAnsi = (s) => s.replace(ANSI, '');

  function base64Of(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  /* Solo base64 valido diventa un `data:`: un valore strano non finisce in un attributo */
  function rasterSrc(mime, value) {
    const b64 = joined(value).replace(/\s+/g, '');
    return BASE64.test(b64) ? `data:${mime};base64,${b64}` : null;
  }

  function imageSrc(mime, value) {
    if (mime === 'image/svg+xml') return `data:image/svg+xml;base64,${base64Of(joined(value))}`;
    return rasterSrc(mime, value);
  }

  /** Il formato più ricco che la vista sa mostrare; undefined se nessuno. */
  function richOutput(data) {
    if (!isObject(data)) return undefined;
    for (const mime of [...RASTER, 'image/svg+xml']) {
      const src = mime in data ? imageSrc(mime, data[mime]) : null;
      if (src) return { kind: 'image', src };
    }
    if ('text/html' in data) return { kind: 'html', html: joined(data['text/html']) };
    if ('text/markdown' in data) return { kind: 'markdown', text: joined(data['text/markdown']) };
    if ('text/plain' in data) return { kind: 'text', text: stripAnsi(joined(data['text/plain'])), stream: null };
    return undefined;
  }

  function output(o) {
    if (!isObject(o)) return undefined;
    if (o.output_type === 'stream') {
      return { kind: 'text', text: stripAnsi(joined(o.text)), stream: o.name === 'stderr' ? 'stderr' : 'stdout' };
    }
    if (o.output_type === 'error') {
      const traceback = Array.isArray(o.traceback) ? o.traceback.filter((s) => typeof s === 'string').join('\n') : '';
      return { kind: 'error', name: String(o.ename || 'Errore'), value: stripAnsi(String(o.evalue || '')), traceback: stripAnsi(traceback) };
    }
    return richOutput(o.data);
  }

  function attachmentsOf(cell) {
    if (!isObject(cell.attachments)) return {};
    const entries = Object.entries(cell.attachments).map(([name, data]) => {
      const rich = richOutput(isObject(data) ? data : {});
      return rich && rich.kind === 'image' ? [name, rich.src] : null;
    });
    return Object.fromEntries(entries.filter(Boolean));
  }

  function cell(c) {
    const type = c.cell_type === 'markdown' || c.cell_type === 'code' ? c.cell_type : 'raw';
    const outputs = type === 'code' && Array.isArray(c.outputs) ? c.outputs.map(output).filter(Boolean) : [];
    const count = Number.isInteger(c.execution_count) ? c.execution_count : null;
    return { type, source: joined(c.source), count, outputs, attachments: attachmentsOf(c) };
  }

  function languageOf(metadata) {
    const m = isObject(metadata) ? metadata : {};
    const fromSpec = isObject(m.kernelspec) && m.kernelspec.language;
    const fromInfo = isObject(m.language_info) && m.language_info.name;
    return String(fromSpec || fromInfo || 'python').toLowerCase();
  }

  /**
   * @param {string} text il contenuto del file
   * @returns {{ok: true, language: string, cells: object[]} | {ok: false, error: string}}
   */
  function parseNotebook(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `JSON non valido: ${e.message}` };
    }
    if (!isObject(doc)) return { ok: false, error: 'Non è un notebook: manca l\'oggetto principale.' };
    if (Number.isInteger(doc.nbformat) && doc.nbformat < 4) {
      return { ok: false, error: `Formato nbformat ${doc.nbformat}: la vista legge solo nbformat 4.` };
    }
    if (!Array.isArray(doc.cells)) return { ok: false, error: 'Non è un notebook: mancano le celle.' };
    return { ok: true, language: languageOf(doc.metadata), cells: doc.cells.filter(isObject).map(cell) };
  }

  return { isNotebook, parseNotebook };
});
