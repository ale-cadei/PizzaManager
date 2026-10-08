# 42 — `fix/opencode-resume-id`: le schede opencode tornano dopo un riavvio

## Il problema

Una scheda opencode aperta "nuova" il 07/10 in `segnaPOS`, dopo il riavvio del
computer, è stata ripristinata come sessione vuota. In `live-sessions.json` e
nella cronologia aveva `resumeId: null`: l'app non aveva mai saputo quale
conversazione fosse, e al ripristino l'ha avviata da zero. La conversazione
c'era (`opencode session list` da `segnaPOS` la mostrava).

Claude e codex non hanno il problema: le loro schede hanno tutte il `resumeId`.

## Cause (due, indipendenti)

1. **Nomi dei campi.** `pickAutoSession` (`renderer/session-titles.js`)
   riconosce la conversazione di una scheda nuova da `cwd` e `mtime`. opencode
   restituisce `directory` e `updated`/`created`: `Number(undefined) >= since`
   è sempre falso, quindi nessuna scheda opencode nuova otteneva mai il suo id.
   Il test lo nascondeva perché la fixture opencode aveva un `mtime` inventato.
2. **Ambito di `opencode session list`.** Elenca solo le sessioni del progetto
   della cwd del processo, e non ha un'opzione per vederle tutte. Lanciato dal
   main vedeva una sola cartella: le conversazioni degli altri progetti non
   comparivano né per le schede da riconoscere né nel dialog Resume.

## Correzione

- `lib/opencode-sessions.js`
  - `parseSessionOutput` aggiunge `cwd` (da `directory`), `mtime` (da
    `updated`, o `created`) e `titled` (falso per il titolo di default
    `New session - <data>`, altrimenti la scheda si chiamerebbe così). I campi
    originali restano: il Resume li usa.
  - `listOpencodeSessions` accetta `cwd` e la passa a `execFile`.
  - `listOpencodeSessionsIn(dirs, limit)`: una chiamata per directory (al più
    `MAX_DIRS` = 8, ogni chiamata costa ~2 s di CPU), risultati uniti per id e
    ordinati per `mtime`. Una directory che fallisce non nasconde le altre;
    senza directory valide si torna alla chiamata singola di prima.
  - `opencodeHistoryDirs(history)`: le directory delle sessioni opencode in
    cronologia, più recenti prima.
- `main.js`: l'handler `list-opencode-sessions` riceve `dirs`; senza, usa
  quelle della cronologia.
- `renderer/tab-names.js`: il giro dei titoli chiede nelle cwd delle schede
  opencode ancora da riconoscere.

## Fuori da questo branch

- Il dialog Resume interroga solo le 8 directory opencode più recenti della
  cronologia: conversazioni di progetti dove l'app non ha mai aperto opencode
  non compaiono. Prima comparivano solo quelle della cwd del processo.
- Le schede già salvate con `resumeId: null` non si recuperano da sole: la
  conversazione si riapre dal Resume o con `opencode --session <id>`.

## Verifica

- `npm run test:unit` verde (test nuovi in `tests/lib.test.js` con la forma
  reale dell'output di opencode 1.18).
- Con l'opencode installato: `listOpencodeSessionsIn(['…/segnaPOS'])` +
  `pickAutoSession` con l'avvio della scheda del 07/10 restituisce
  `ses_eea39d14dffeSqX30d0iGn4Odf`, la conversazione persa.
- Da provare nell'app: nuova scheda opencode, un prompt, attendere ~20 s,
  verificare `resumeId` in `live-sessions.json`.
