/* Ciclo di vita di una scheda: comando da usare, radice di progetto,
   terminale xterm + pty, primo piano, fit, chiusura. */

/* Comando da usare per la sessione: se il tipo ha più comandi configurati la
   scelta viene chiesta all'utente (o riusata dalla cronologia, se ancora esiste). */
async function resolveCommandProfile(type, { commandProfileId, cwd, resumeId } = {}) {
  const ui = window.AisessCommands;
  if (!ui) return { ok: true, id: commandProfileId || null, label: null };
  await ui.load();
  if (commandProfileId) {
    const known = ui.labelFor(type, commandProfileId);
    if (known) {
      ui.rememberUsed(type, commandProfileId);
      return { ok: true, id: commandProfileId, label: known };
    }
    // Comando eliminato dalla configurazione: si torna a chiedere
  }
  return ui.choose(type, { cwd, resumeId });
}

/* ---------- Radice di progetto delle schede ----------
   La risalita la fa il main (il renderer non vede il filesystem). Il risultato
   si mette in cache per directory: aprire dieci sessioni nello stesso repo non
   deve costare dieci risalite. In caso di errore vale la cwd, così la scheda
   ha comunque un gruppo. */
const projectRootCache = new Map();

async function resolveProjectRoot(cwd) {
  if (!cwd) return null;
  if (projectRootCache.has(cwd)) return projectRootCache.get(cwd);
  let root = cwd;
  try {
    const r = await window.aisess.resolveProject(cwd);
    if (r && r.ok && typeof r.root === 'string' && r.root) root = r.root;
    else if (r && !r.ok) console.warn('resolve-project fallito:', r.error);
  } catch (e) {
    console.warn('resolve-project non raggiungibile', e);
  }
  projectRootCache.set(cwd, root);
  return root;
}

/* reveal: false per le schede che tornano al riavvio dell'app. Non le ha
   scelte l'utente adesso: espanderne il gruppo cancellerebbe i collassi
   che aveva lasciato (setActive). */
async function createTab(type, { name, cwd, resumeId, claudeAccountId, commandProfileId, attachSession = null, commandProfileLabel = null, previousSession = null, startedAt = Date.now(), iconKey = 'shell', iconMode = 'auto', turnTree = null, turnAt = null, reveal = true } = {}) {
  // La sessione git non ha pty: è un pannello (renderer/git-tab.js)
  if (type === 'git') return createGitTab({ name, cwd, startedAt, reveal });
  // La sessione editor non ha pty: è un pannello (renderer/editor-tab.js)
  if (type === 'editor') return createEditorTab({ name, cwd, startedAt, reveal });
  // attachSession: riaggancio di una sessione tmux gia' viva. Il comando e' gia'
  // stato risolto quando e' nata, quindi niente scelta del profilo.
  const picked = attachSession
    ? { ok: true, id: commandProfileId || null, label: commandProfileLabel || null }
    : await resolveCommandProfile(type, { commandProfileId, cwd, resumeId });
  if (!picked.ok) return; // scelta annullata: nessuna scheda creata
  const id = 'tab-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const label = name || `${type} · ${counter++}`;
  if (type === 'claude') await ensureClaudeAccounts();
  const claudeAccountName = type === 'claude' ? claudeAccountLabel(claudeAccountId) : null;

  const wrap = document.createElement('div');
  // La classe del tipo dà --type-color alla barra di scorrimento (styles.css)
  wrap.className = 'term-wrap type-' + type;
  wrap.id = 'wrap-' + id;
  const inner = document.createElement('div');
  inner.style.width = '100%'; inner.style.height = '100%';
  wrap.appendChild(inner);
  $('#terminals').appendChild(wrap);

  // Registra e rendi visibile PRIMA di aprire il terminale: xterm misura il
  // contenitore all'apertura, quindi il wrap deve essere già laid out a
  // dimensione piena (altrimenti la prima scheda nasce 20x10).
  const tab = { id, type, name: label, cwd, projectRoot: cwd || null, resumeId, startedAt, autoNamed: !name,
    session: attachSession, reattached: Boolean(attachSession),
    // Nome tmux della sessione prima di un riavvio della macchina: la sola
    // identità stabile di una shell ricreata, per ritrovarne il posto.
    previousSession,
    promptCapture: PromptCapture.createPromptCapture(), namedFromPrompt: false,
    iconKey: ShellIcons.normalize(iconKey), iconMode: iconMode === 'manual' ? 'manual' : 'auto',
    iconCapture: ShellIcons.createCommandCapture(),
    // «Ultimo giro» del pannello delle modifiche (changes-panel.js): ogni
    // prompt inviato a un agente fotografa i file; l'ultima fotografia resta
    // qui e sulla sessione tmux
    turnCapture: AI_TYPES.includes(type) ? PromptCapture.createPromptCapture({ repeat: true }) : null,
    turnTree, turnAt,
    claudeAccountId, claudeAccountName, commandProfileId: picked.id, commandProfileLabel: picked.label, term: null, fit: null, ro: null, wrap, alive: true, needsAttention: false, idleTimer: null, running: false, runTimer: null };
  tabs.set(id, tab);
  // Quello che la sessione scrive per prima (ridisegno di tmux, conversazione
  // ripresa) è l'avvio, non un lavoro finito: al ripristino le accendeva tutte.
  if (type !== 'shell') attention.born(id, { untilTyped: !attachSession });
  updateEmpty();
  setActive(id, { reveal });

  // scrollback: senza tmux la history con cui scorre la rotella è QUESTA.
  // Le 1000 righe di default coprivano poco: allineate all'ordine di
  // grandezza di `history-limit`. Con tmux si azzera appena si sa (sotto):
  // la history è quella di tmux, e questa sarebbe a buchi.
  // allowProposedApi: term.unicode, che serve sotto, e API sperimentale in xterm 5.
  const term = new Terminal({ cursorBlink: true, scrollback: 20000, fontSize: termFont.get(), lineHeight: TERM_LINE_HEIGHT, fontFamily: "'IBM Plex Mono', JetBrains Mono, Menlo, Consolas, monospace", theme: termTheme(), allowProposedApi: true });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}
  // Larghezze dei caratteri come le conta chi sta dietro (psmux, tmux): se
  // no i ridisegni per differenze finiscono spostati (lettere sparse in Claude).
  const psmux = tmuxAvailable && tmuxInfo.name === 'psmux';
  try { AisessTermUnicode.install(term, Unicode11Addon.Unicode11Addon, { psmux }); } catch (e) { console.warn('[PizzaManager] larghezze Unicode:', e); }
  term.open(inner);
  tab.term = term;
  tab.fit = fit;

  // Rotella e barra laterale: con tmux scorrono la history di tmux (copy-mode),
  // senza quella di xterm. Vedi renderer/term-scroll.js.
  const tmuxScroll = {
    scroll: (n) => window.aisess.scroll(id, n),
    scrollTo: (n) => window.aisess.scrollTo(id, n),
    state: () => window.aisess.scrollState(id),
  };
  const xtermScroll = window.AisessTermScroll.xtermBackend(term);
  tab.scroller = window.AisessTermScroll.attach({
    term, host: wrap,
    backend: () => (tab.session ? tmuxScroll : xtermScroll),
    rowHeight: () => inner.clientHeight / Math.max(1, term.rows),
    sendKeys: (d) => window.aisess.write(id, d),
    isVisible: () => wrap.classList.contains('active'),
  });
  term.onScroll(() => { if (!tab.session) tab.scroller.refresh(); });

  term.onData((d) => {
    window.aisess.write(id, d);
    applyTypedPrompt(tab, d);
    observeShellIconInput(tab, d);
    noteTurnInput(tab, d);
    // L'utente ha chiesto qualcosa qui: la risposta va segnalata anche se breve.
    // Non i report che xterm manda da solo (mouse, focus): lampeggio a caso.
    if (Attention.isTyping(d)) {
      attention.typed(id);
      tab.scroller.noteTyping();
    }
  });
  // xterm accetta un solo gestore tasti: qui si compongono quelli dei moduli.
  // Copia/incolla: la selezione di xterm non è una selezione del documento.
  // Shift+Invio: a capo nel prompt delle TUI senza inviarlo.
  const keyHandlers = [window.AisessNewline.keyHandler(term), window.AisessClipboard.keyHandler(term)];
  term.attachCustomKeyEventHandler((e) => keyHandlers.every((h) => h(e)));
  window.AisessClipboard.attachContextMenu(term, inner);
  // Il bell è il "ho finito" esplicito degli agenti: vale senza attendere l'idle
  try { term.onBell(() => flagAttention(tab, { bell: true })); } catch {}
  // Codex manda OSC 9 a fine turno e quando chiede un'approvazione (piano 46)
  if (type === 'codex') {
    try {
      term.parser.registerOscHandler(9, (text) => { applyAgentSignal(tab, AgentState.codexOscState(text)); return true; });
    } catch (e) { console.warn('OSC 9 di Codex non intercettato, resta l euristica', e); }
  }

  // Dimensioni iniziali misurate sul contenitore reale già visibile
  let cols = 80, rows = 24;
  try {
    const dims = fit.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0) { cols = dims.cols; rows = dims.rows; }
  } catch {}
  const res = attachSession
    ? await window.aisess.attach({ id, session: attachSession, type, cols, rows })
    : await window.aisess.spawn({ id, type, cwd, resumeId, claudeAccountId, commandProfileId: picked.id, label, cols, rows, previousSession });
  if (!res.ok && res.gone) {
    // La sessione tmux non c'e' piu' (riavvio della macchina, terminata altrove):
    // caso normale, non un errore. Si offre la strada per ricrearla.
    term.write('\x1b[90mQuesta sessione non è più attiva sulla macchina.\x1b[0m\r\n');
    if (resumeId) term.write('\x1b[90mPuoi riprenderla dal dialog ⟲ Resume: la conversazione è salvata dal CLI.\x1b[0m\r\n');
    else term.write('\x1b[90mAvviane una nuova con ＋ Nuova sessione.\x1b[0m\r\n');
    tab.alive = false;
  } else if (!res.ok) {
    const msg = String(res.error || 'errore sconosciuto').replace(/\n/g, '\r\n');
    term.write(`\x1b[31mErrore avvio [${type}]: ${msg}\x1b[0m\r\n`);
    term.write(`\x1b[90mSuggerimento: apri un Terminale e verifica con: which ${type === 'shell' ? 'bash' : type} && ${type === 'shell' ? 'echo ok' : type + ' --version'}\x1b[0m\r\n`);
    tab.alive = false;
  } else {
    if (res.session) tab.session = res.session;
    if (!attachSession && type === 'shell' && (tab.iconKey !== 'shell' || tab.iconMode !== 'auto') && tab.session) {
      window.aisess.setMeta(id, { iconKey: tab.iconKey, iconMode: tab.iconMode });
    }
    if (tab.session) term.options.scrollback = 0;
    // Il main può spostare la sessione (cwd vuota, con ~ o inesistente finisce
    // nella home): senza la directory vera il titolo automatico non troverebbe
    // mai la conversazione, che viene riconosciuta proprio dalla directory.
    if (res.cwd) tab.cwd = res.cwd;
    if (res.moved) notifyMovedSession(id, res);
    // La radice si risolve sulla directory davvero usata dal pty, non su quella
    // digitata: con cwd vuota o inesistente il main sposta la sessione altrove.
    resolveProjectRoot(tab.cwd).then((root) => {
      if (!tabs.has(id) || root === tab.projectRoot) return;
      tab.projectRoot = root;
      renderSidebar();
    }).catch(() => {});
    // Fit definitivo a layout assestato (doppio rAF)
    requestAnimationFrame(() => requestAnimationFrame(() => refitTab(id)));
  }

  // Refit automatico ai cambi di dimensione del contenitore (drag sidebar, resize finestra)
  try {
    let t = null;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => refitTab(id), 50); });
    ro.observe(inner);
    tab.ro = ro;
  } catch {}
  term.focus();
  renderSidebar();
  startAutoTitles();
  // Primo giro ravvicinato: il CLI scrive la conversazione poco dopo l'avvio
  setTimeout(() => { refreshAutoTitles().catch(() => {}); }, 4000);
}

function setActive(id, { reveal = true } = {}) {
  // La scheda che lascia il primo piano si ridisegna per il refit: quell'output
  // è una conseguenza della visita, non un lavoro nuovo (attention.js).
  if (activeId && activeId !== id) { attention.left(activeId); leaveAgentTab(activeId); }
  const previousId = activeId;
  activeId = id;
  tabs.forEach((t) => t.wrap.classList.toggle('active', t.id === id));
  // Selezionare la sessione è la conferma che l'utente ha visto il lavoro finito
  clearAttention(id);
  // Selezionare una scheda espande il suo gruppo, così la card resta visibile.
  // Va fatto SOLO qui e non in renderSidebar(), altrimenti il click sull'header
  // richiuderebbe e riaprirebbe subito il gruppo della scheda attiva.
  // Non al ripristino (reveal false): i collassi sono quelli lasciati dall'utente.
  const t = tabs.get(id);
  if (t && reveal) sidebar.expandGroupOf(t);
  // La timeline git si rilegge tornando in primo piano: intanto si è lavorato
  if (t && t.git && id !== previousId) refreshGitTab(t);
  // Anche i file aperti nell'editor: un agente può averli toccati intanto
  if (t && t.editor && id !== previousId) refreshEditorTab(t);
  renderSidebar();
  setTimeout(() => fitActive(), 30);
  refreshUsage(); // il riquadro SESSIONE parla della scheda in primo piano
  refreshChanges().catch(() => {}); // e così il pannello delle modifiche
}

function refitTab(id) {
  const t = tabs.get(id);
  if (!t || !t.fit || !t.term) return;
  // Le schede nascoste hanno dimensione 0: fittare qui le rovinerebbe
  if (!t.wrap.classList.contains('active')) return;
  try { t.fit.fit(); window.aisess.resize(t.id, t.term.cols, t.term.rows); } catch {}
  if (t.scroller) t.scroller.refresh();
}

function fitActive() {
  if (activeId) refitTab(activeId);
}

async function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  if (!PANEL_TYPES.includes(t.type)) await window.aisess.kill(id);
  clearAttention(id);
  attention.forget(id);
  agentState.forget(id);
  clearTimeout(t.runTimer);
  running.forget(id);
  try { if (t.ro) t.ro.disconnect(); } catch {}
  try { if (t.term) t.term.dispose(); } catch {}
  try { if (t.git) t.git.picker.destroy(); } catch {}
  if (t.editor) disposeEditorTab(t);
  t.wrap.remove();
  tabs.delete(id);
  if (activeId === id) {
    const rest = [...tabs.keys()];
    activeId = rest.length ? rest[rest.length - 1] : null;
    if (activeId) tabs.get(activeId).wrap.classList.add('active');
  }
  updateEmpty();
  if (tabs.size) fitActive();
  renderSidebar();
  refreshChanges().catch(() => {});
  if (t.type === 'git') saveGitSessions();
  if (t.type === 'editor') saveEditorSessions();
}

/** Termina davvero: uccide la sessione tmux e poi chiude la scheda. */
async function terminateTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  if (t.session) await window.aisess.terminate(id);
  await closeTab(id);
}

/* Il main ha fatto partire la sessione altrove perché la cartella non c'è più
   (lib/workdir.js, describeWorkdir). Lo dice un fumetto dalla card, che resta
   finché non lo si legge: una riga nel terminale la ridisegnerebbe tmux. Dopo
   un worktree tolto conta più che mai: l'agente può credersi ancora sul suo
   branch (docs/plans/36, passo 7). */
function notifyMovedSession(id, res) {
  const text = res.moved === 'worktree'
    ? `Il worktree ${res.requested} non esiste più: la sessione parte nella cartella del progetto, ${res.cwd}. `
      + 'Controlla il branch prima di lavorare: non è più quello del worktree.'
    : `La cartella ${res.requested} non esiste: la sessione parte in ${res.cwd}.`;
  // Al frame dopo: la card della sessione deve essere già nella sidebar
  requestAnimationFrame(() => {
    const anchor = findAnchor(id);
    if (anchor) closeConfirm.tell({ anchor, key: id, title: 'Sessione spostata', text }).catch(() => {});
    else console.warn('[sessione spostata]', text);
  });
}

/* La ✕ della card. Chiude la sessione per davvero (il processo muore): prima
   lo si chiede, con un fumetto appoggiato alla card. La domanda si salta solo
   per una sessione già terminata, dove non c'è niente da perdere. */
const closeConfirm = ConfirmBubble.createConfirmBubble();
async function requestClose(id, anchor) {
  const t = tabs.get(id);
  if (!t) return;
  // Una scheda editor non ha processi: chiede solo per i file non salvati
  if (t.type === 'editor') {
    if (await confirmEditorClose(t, anchor)) await terminateTab(id);
    return;
  }
  // Una scheda git non ha processi da perdere: niente domanda
  if (t.alive && anchor && !PANEL_TYPES.includes(t.type)) {
    const yes = await closeConfirm.ask({
      anchor,
      key: id,
      name: t.name,
      detachable: Boolean(tmuxAvailable && t.session),
    });
    if (!yes) return;
  }
  await terminateTab(id);
}
