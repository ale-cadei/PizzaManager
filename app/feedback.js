'use strict';
const { parseFeed, createUrl, voteUrl, FEED_URL } = require('../lib/feedback-source');
const { diagnosticLine, collectDeps } = require('../lib/diagnostics');
const { checkDeps, AGENTS } = require('../lib/setup-check');

/**
 * La bacheca delle segnalazioni: scarica il feed, lo tiene in cache, apre
 * GitHub quando si vota o si scrive.
 *
 * La rete la fa il MAIN, non il renderer: la CSP della pagina ha
 * `connect-src 'none'` e deve restare cosi' (docs/plans/48-segnalazioni.md).
 * Stesso schema di lib/usage/claude-quota.js.
 *
 * Il feed e' un file statico rigenerato da una Action, non l'API di GitHub:
 * senza autenticazione sono 60 richieste l'ora PER INDIRIZZO IP, e in un
 * ufficio dietro NAT si esaurirebbero per tutti insieme.
 */
const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

function registerFeedbackHandlers(ipcMain, {
  electron,
  viaTmux = () => false,
  // Iniettabile per i test: di suo interroga il PATH, che e' lento e dipende
  // dalla macchina.
  deps = () => collectDeps(checkDeps({ tmuxAvailable: viaTmux() }), AGENTS, viaTmux()),
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  feedUrl = FEED_URL,
  ttlMs = TTL_MS,
  now = () => Date.now(),
} = {}) {
  const { app, shell } = electron;
  /** Unico stato: la cache. Sostituita, mai modificata. */
  let cache = null;

  async function scarica() {
    if (!fetchImpl) return { voci: [], errore: 'rete non disponibile' };
    try {
      const res = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return { voci: [], errore: `GitHub ha risposto ${res.status}` };
      return { ...parseFeed(await res.text()), errore: null };
    } catch (e) {
      // Offline e' un caso normale: si dice, non si urla.
      return { voci: [], errore: String((e && e.message) || e) };
    }
  }

  ipcMain.handle('feedback-list', async (event, { ricarica } = {}) => {
    if (!ricarica && cache && now() - cache.quando < ttlMs) return cache.dati;
    const dati = await scarica();
    // Un errore non butta via una bacheca che avevamo: meglio dati vecchi
    // che una finestra vuota quando la rete cade per un minuto.
    if (dati.errore && cache) return { ...cache.dati, errore: dati.errore };
    cache = { quando: now(), dati };
    return dati;
  });

  /** La riga di contesto da allegare: versione, sistema, tmux, CLI trovate. */
  ipcMain.handle('feedback-diagnostics', async () => {
    const d = await deps();
    return diagnosticLine({
      version: app.getVersion(),
      platform: process.platform,
      tmux: Boolean(d.tmux),
      clis: d.clis || {},
    });
  });

  ipcMain.handle('feedback-create', async (event, { tipo, titolo, corpo, diagnostica } = {}) => {
    await shell.openExternal(createUrl({ tipo, titolo, corpo, diagnostica }));
    return { ok: true };
  });

  // Da un link non si puo' aggiungere una reazione: si apre la issue e la
  // persona preme 👍 li'. Il pannello lo dice, non finge.
  ipcMain.handle('feedback-vote', async (event, { numero } = {}) => {
    const url = voteUrl(numero);
    if (!url) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });
}

module.exports = { registerFeedbackHandlers, TTL_MS };
