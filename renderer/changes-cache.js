/* Contatori delle modifiche sulle righe dei worktree in sidebar
 * (docs/plans/32-pannello-modifiche.md):
 *
 *   ⑂ feat/scorciatoie   da main   +120 −30   [+] [⋯]
 *
 * Senza polling: leggere git per ogni worktree ogni pochi secondi costerebbe
 * troppe chiamate. Un worktree si legge la prima volta che compare
 * (`ensure`), quando una sua sessione finisce e al ritorno della finestra
 * (`refresh`, `refreshAll`); quando la sessione in primo piano sta in un
 * worktree, la lettura del pannello vale anche qui (`put`).
 *
 * Stesso schema di worktree-cache.js: oggetto nuovo a ogni cambio, mai
 * modificato sul posto, e `onChange` (un ridisegno della sidebar) solo se i
 * numeri sono davvero cambiati. Wrapper UMD: globale nella pagina e
 * module.exports sotto Node, per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessChangesCache = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const totalsOf = (result) => (result && result.ok && result.totals
    ? { files: result.totals.files, added: result.totals.added, removed: result.totals.removed }
    : null);
  const same = (a, b) => (a === null || b === null ? a === b
    : a.files === b.files && a.added === b.added && a.removed === b.removed);
  const isClean = (t) => !t || t.files === 0;

  /**
   * @param {{read: (cwd: string, base: string|null) => Promise<object>,
   *   onChange: () => void, warn?: (...args: any[]) => void}} deps
   */
  function createChangesCache({ read, onChange, warn = (...args) => console.warn(...args) }) {
    /** percorso del worktree → { files, added, removed } */
    let byPath = {};
    /* L'ultima richiesta per percorso: una risposta più vecchia che arriva
       dopo non deve sovrascrivere quella nuova */
    const latest = new Map();

    /* Una lettura arrivata da fuori (il pannello) è la più nuova: una
       refresh partita prima non deve sovrascriverla */
    function take(path, result) {
      latest.set(path, (latest.get(path) || 0) + 1);
      put(path, result);
    }

    function put(path, result) {
      const next = totalsOf(result);
      const known = Object.prototype.hasOwnProperty.call(byPath, path);
      const prev = known ? byPath[path] : null;
      if (known && same(prev, next)) return;
      byPath = { ...byPath, [path]: next };
      // La prima lettura di un worktree pulito non cambia niente di visibile
      if (known || !isClean(next)) onChange();
    }

    async function refresh({ path, base = null }) {
      const token = (latest.get(path) || 0) + 1;
      latest.set(path, token);
      let result = null;
      try {
        result = await read(path, base);
      } catch (e) {
        warn('[modifiche] worktree non letto', path, String((e && e.message) || e));
      }
      if (latest.get(path) !== token) return;
      put(path, result);
    }

    const valid = (list) => (Array.isArray(list) ? list : []).filter((w) => w && typeof w.path === 'string' && w.path);

    return {
      get: (path) => byPath[path] || null,
      put: take,
      refresh,
      /** Legge i worktree mai letti (né in corso) */
      ensure: (list) => Promise.all(valid(list).filter((w) => !latest.has(w.path)).map(refresh)),
      refreshAll: (list) => Promise.all(valid(list).map(refresh)),
    };
  }

  return { createChangesCache };
});
