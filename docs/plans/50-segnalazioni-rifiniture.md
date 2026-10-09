# 50 — Tre rifiniture alla bacheca delle segnalazioni

Branch: `fix/segnalazioni-rifiniture`. Dipende dal 48 (bacheca). Taglia: ~1h.

Tre difetti trovati rileggendo il pannello dopo il rilascio della 1.5.0. Sono
indipendenti fra loro; stanno insieme perché toccano le stesse quattro righe
di interfaccia.

## 1. Il titolo non apre niente

Oggi l'unica cosa cliccabile di una riga è il riquadro `▲` del voto. Chi vuole
**leggere** una segnalazione deve premere un pulsante il cui tooltip parla di
votare: è l'opposto di quello che si aspetta.

Si rende cliccabile anche il corpo della riga (titolo, stato, autore). Va
dove va il riquadro — la pagina della issue — ma lo dice con parole sue:
«Apri la segnalazione su GitHub».

Due pulsanti affiancati, non uno dentro l'altro: `fb-voto` e `fb-corpo` sono
fratelli. Un `<button>` dentro un `<button>` non è HTML valido e il click
interno si comporta in modo diverso da browser a browser.

### Il nome che mentiva

`voteUrl`, `feedback-vote`, `feedbackVote`, `onVote`: tutti nomi che
promettono un voto, mentre la funzione **apre la pagina della issue** — su
GitHub una reazione non si può aggiungere da un link, ed è scritto in tre
commenti. Ora che lo stesso indirizzo serve a due pulsanti, il nome sbagliato
diventa confusione vera: si rinomina in `issueUrl` / `feedback-open-issue` /
`feedbackOpenIssue` / `onOpen`. Niente cambia di comportamento: è un
rinominare, e sta in un commit a parte.

## 2. Il tipo si calcola e non si vede

La catena c'è tutta: il modulo `segnalazione.yml` mette l'etichetta `bug`,
`.github/feedback.js` ne ricava `tipo: 'segnalazione'`, `feedback-view.js`
scrive la classe `tipo-segnalazione` sulla riga… e nel CSS quella classe **non
esiste**. Un problema e una richiesta sono identici a vedersi.

Si dipinge un filo verticale a sinistra della riga: `--accent` per i problemi,
`--border-strong` per le richieste. Due colori, non uno solo e l'altro niente:
una classe scritta nel DOM e mai usata è esattamente il difetto che stiamo
correggendo.

## 3. Le etichette `stato:*` non esistono sul repo pubblico

Erano state create provando il giro e si sono perse con la issue di prova
cancellata. Senza di loro `statoDa()` risponde sempre `'aperta'`: nessuna
riga mostra il badge e la linguetta «Pianificato» resta vuota per sempre.

Ricreate il 9 ottobre 2026 su `JackGrieco/PizzaManager-releases`, coi colori
dei badge del pannello:

| Etichetta | Colore | Descrizione |
|---|---|---|
| `stato:pianificato` | `#FF9B6F` (`--action-text`) | Lo faremo |
| `stato:in-corso` | `#F04E23` (`--action`) | Ci stiamo lavorando |
| `stato:completato` | `#7EE2A8` (il verde del badge) | Fatto, in una versione rilasciata |

Non è codice, è configurazione del repo pubblico: si rifà con
`gh label create "stato:…" --repo JackGrieco/PizzaManager-releases --color …`.
È annotato qui perché la prossima volta si sappia dove guardare — si erano
perse con la issue di prova cancellata, e nessuno se ne accorge finché non
manca il badge.

## Commenti da correggere, gratis

Tre intestazioni dicono che i filtri stanno in `lib/feedback-source.js`:
`renderer/feedback-view.js`, `renderer/feedback-panel.js` e
`tests/feedback-panel.test.js`. `filterBy` sta invece **dentro
feedback-view.js**, e il perché è spiegato bene in `lib/feedback-source.js`:
il renderer gira sandboxed e non può importare da `lib/`. Il test si
contraddice da solo, riga 2 contro riga 8.

## Prove

- I test della bacheca (`tests/feedback-panel.test.js`) coprono già le righe:
  si aggiunge che il corpo è cliccabile e porta allo stesso numero del
  riquadro, e che la riga porta la classe del tipo.
- Lo stile del filo colorato si verifica a occhio: la CSS non si testa qui.
