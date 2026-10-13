/* Nomi delle sessioni.
 *
 * Il nome di una scheda arriva da due fonti, in ordine di precedenza:
 *   1. la rinomina manuale dell'utente (doppio click sulla card), salvata qui
 *   2. il titolo che il CLI stesso dà alla conversazione (primo prompt utente
 *      per Claude/Codex/OpenCode, `Preview` per Antigravity)
 * La (2) è la stessa stringa mostrata nel dialog di resume: così il nome che si
 * vede nella sidebar e quello che si cerca al resume non divergono mai.
 *
 * Una scheda nuova non conosce l'id della conversazione (lo crea il CLI dopo
 * l'avvio): `pickAutoSession` lo ricava dalla conversazione comparsa nella
 * stessa directory dopo l'istante di avvio della scheda.
 *
 * Espone il globale `AisessTitles`; sotto Node esporta lo stesso oggetto, per
 * poterlo testare senza browser.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessTitles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const STORAGE_KEY = 'aisess.session-names.v1';
  const NAME_MAX = 60;

  function keyOf(type, id) {
    return `${type}:${id}`;
  }

  /**
   * Store dei nomi manuali, persistito in localStorage.
   * @param {{getItem:Function,setItem:Function}|null} storage assente = nessuna persistenza
   */
  function createTitleStore(storage) {
    function readAll() {
      if (!storage) return {};
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {}; // storage corrotto: si riparte da zero, senza rompere la UI
      }
    }

    function writeAll(next) {
      if (!storage) return;
      try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    }

    function nameFor(type, id) {
      if (!id) return null;
      const v = readAll()[keyOf(type, id)];
      return typeof v === 'string' && v ? v : null;
    }

    /** Nome vuoto = l'utente ha annullato la rinomina, quindi si torna all'automatico. */
    function setName(type, id, name) {
      if (!id) return;
      const clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      const all = readAll();
      if (!clean) {
        const { [keyOf(type, id)]: _removed, ...rest } = all;
        writeAll(rest);
        return;
      }
      writeAll({ ...all, [keyOf(type, id)]: clean });
    }

    function clearName(type, id) {
      setName(type, id, '');
    }

    return { nameFor, setName, clearName, readAll };
  }

  /** Nome da mostrare: rinomina manuale se c'è, altrimenti il titolo del CLI. */
  function displayName(store, type, id, fallback) {
    const custom = store && id ? store.nameFor(type, id) : null;
    return custom || fallback || '';
  }

  function sessionCwd(s) {
    return String((s && (s.cwd || s.directory)) || '').replace(/\/+$/, '');
  }

  /**
   * Conversazione appena creata da una scheda: stessa directory, comparsa dopo
   * l'avvio. Se non c'è nulla di nuovo restituisce null — meglio nessun titolo
   * che il titolo di un'altra conversazione.
   * Le conversazioni già di un'altra scheda (`exclude`) non contano: con due
   * schede nella stessa directory, quella che va avanti nella prima non è
   * quella della seconda.
   * @param {Array<object>} sessions elenco dal lister del tipo
   * @param {{cwd: string, since: number, exclude?: Iterable<string>}} ctx
   */
  function pickAutoSession(sessions, { cwd, since, exclude } = {}) {
    if (!Array.isArray(sessions)) return null;
    const want = String(cwd || '').replace(/\/+$/, '');
    const after = Number(since) || 0;
    const taken = new Set(exclude || []);
    const candidates = sessions.filter((s) => s && !taken.has(s.id) && sessionCwd(s) === want && Number(s.mtime) >= after);
    if (!candidates.length) return null;
    return candidates.reduce((best, s) => (Number(s.mtime) > Number(best.mtime) ? s : best));
  }

  /**
   * Schede che il giro automatico deve guardare. L'id della conversazione
   * serve a tutte (è ciò che rende la scheda ripristinabile dopo un riavvio),
   * quindi si cerca anche per chi ha già un nome suo: rinominata a mano, nome
   * dato nel dialog, etichetta di un ripristino. Il titolo automatico invece
   * riguarda solo chi non è stato rinominato. Le shell e le schede git ed
   * editor non hanno conversazioni.
   */
  function needsAutoRefresh(tab) {
    if (!tab || tab.type === 'shell' || tab.type === 'git' || tab.type === 'editor') return false;
    return Boolean(tab.autoNamed) || !tab.resumeId;
  }

  return { createTitleStore, displayName, pickAutoSession, needsAutoRefresh, STORAGE_KEY, NAME_MAX };
});
