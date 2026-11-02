/* L'esecuzione di una cella vista dal renderer (docs/plans/79): gli eventi
 * del ponte (app/kernel-bridge.py) diventano gli output della cella, come
 * li scrive Jupyter. Tutto puro: ogni funzione torna uno stato nuovo.
 *
 * Wrapper UMD come notebook-edit.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessNotebookRun = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const DEFAULT_KERNEL = 'python3';
  /* nbformat spezza in righe questi mime, oltre a text/* (nbformat.v4.rwbase) */
  const SPLIT_MIMES = ['application/javascript', 'image/svg+xml'];

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const textOf = (v) => (Array.isArray(v) ? v.join('') : String(v === undefined || v === null ? '' : v));

  /**
   * @typedef {{outputs: object[], clearPending: boolean, count: number|null, done: boolean, status: string|null}} RunState
   * @returns {RunState}
   */
  const startRun = () => ({ outputs: [], clearPending: false, count: null, done: false, status: null });

  /* Jupyter unisce gli stream consecutivi dello stesso nome */
  function appendOutput(outputs, output) {
    const last = outputs[outputs.length - 1];
    if (output.output_type === 'stream' && last && last.output_type === 'stream' && last.name === output.name) {
      return [...outputs.slice(0, -1), { ...last, text: textOf(last.text) + textOf(output.text) }];
    }
    return [...outputs, output];
  }

  /**
   * @param {RunState} state
   * @param {{ev: string}} event dal ponte, per questa corsa
   * @returns {RunState}
   */
  function applyEvent(state, event) {
    switch (event && event.ev) {
      case 'started':
        return { ...state, count: Number.isInteger(event.count) ? event.count : state.count };
      case 'clear':
        return event.wait ? { ...state, clearPending: true } : { ...state, outputs: [], clearPending: false };
      case 'output': {
        const { output } = event;
        if (!isObject(output) || typeof output.output_type !== 'string') return state;
        const base = state.clearPending ? [] : state.outputs;
        return { ...state, outputs: appendOutput(base, output), clearPending: false };
      }
      case 'done':
        return {
          ...state, done: true, status: String(event.status || ''),
          count: Number.isInteger(event.count) ? event.count : state.count,
        };
      default:
        return state;
    }
  }

  /** Le righe di nbformat: ognuna col suo `\n`. */
  const linesOf = (text) => (text ? text.split(/(?<=\n)/) : []);
  const splits = (mime) => mime.startsWith('text/') || SPLIT_MIMES.includes(mime);

  function fileData(data) {
    if (!isObject(data)) return data;
    return Object.fromEntries(Object.entries(data).map(([mime, v]) => [mime, splits(mime) && typeof v === 'string' ? linesOf(v) : v]));
  }

  /** Gli output come li scrive Jupyter nel file: testi a righe. */
  function toFileOutputs(outputs) {
    return outputs.map((out) => {
      if (out.output_type === 'stream') return { ...out, text: linesOf(textOf(out.text)) };
      if ('data' in out) return { ...out, data: fileData(out.data) };
      return out;
    });
  }

  /** Il kernel del notebook: `metadata.kernelspec.name`, altrimenti python3. */
  function kernelNameOf(doc) {
    const spec = isObject(doc) && isObject(doc.metadata) && doc.metadata.kernelspec;
    return isObject(spec) && typeof spec.name === 'string' && spec.name ? spec.name : DEFAULT_KERNEL;
  }

  /**
   * Cosa manca per eseguire, da dire nella barra.
   * @param {{missing?: string, what?: string, kernel?: string, available?: string[]}} m
   */
  function missingMessage(m) {
    if (m.missing === 'python') return 'Python non trovato nel PATH: installalo per eseguire le celle.';
    if (m.what === 'jupyter_client') return 'Manca jupyter_client: pip install jupyter_client ipykernel';
    const available = Array.isArray(m.available) ? m.available : [];
    if (!available.length) return `Nessun kernel Jupyter installato: pip install ipykernel`;
    return `Kernel «${m.kernel}» non installato. Disponibili: ${available.join(', ')}`;
  }

  return { startRun, applyEvent, toFileOutputs, kernelNameOf, missingMessage };
});
