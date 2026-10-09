# 50 — Rifiniture alla bacheca delle segnalazioni

Branch: `fix/segnalazioni-rifiniture`. Dipende dal 48 (bacheca). Taglia: ~1h.

Difetti trovati rileggendo il pannello dopo il rilascio della 1.5.0, più due
che ha visto l'utente usandolo davvero. Sono indipendenti fra loro; stanno
insieme perché toccano le stesse quattro righe di interfaccia.

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

## 4. Quello che scrivevi nell'app non arrivava su GitHub

**Il difetto peggiore del lotto**, e non si vedeva da nessun test: la
descrizione scritta nel pannello finiva nel nulla.

`createUrl` passava il testo come `body=…`. Su un template Markdown semplice
funzionerebbe, ma i nostri sono **moduli** (`.yml` con dei campi), e un modulo
si precompila con **l'ID dei suoi campi**. `body` lì è un nome riservato:
GitHub lo scarta in silenzio, apre la pagina col campo vuoto e la persona si
ritrova a riscrivere tutto. Nessun errore, nessun avviso.

Verificato aprendo davvero l'indirizzo: col vecchio, «Cosa succede» restava
sul segnaposto mentre titolo ed etichetta `bug` arrivavano; passando
`passi=…` e `ambiente=…` quei due campi si riempivano. Quindi non era GitHub
a non precompilare: era quel nome.

I campi `id: body` dei due moduli si chiamano ora `descrizione`, e `createUrl`
manda `descrizione` e `ambiente`. La diagnostica va nel suo campo invece che
appiccicata in coda al testo, dove sembrava scritta dalla persona; a
`richiesta.yml`, che non ce l'aveva, si aggiunge il campo. Nei commenti di
`lib/feedback-source.js` e in cima ai moduli sta scritto che **nessun campo
può chiamarsi `body`**.

## 5. Pulsanti grigi e textarea che si trascina

`.btn` da sola non ha né fondo né colore (`tokens.css`): la variante è
obbligatoria. Nel pannello mancava, e «＋ Nuova» e «Continua su GitHub»
uscivano grigi mentre ogni altro modale dell'app usa `btn--primary` per la
conferma. Ora: `btn--outline` per «Nuova» (come il «+ Nuova» della sidebar),
`btn--primary` per la conferma, `btn--secondary` per il ⟳ (come «↻ Ricarica»
di Resume). Un test conta i `class="btn"` nudi in `index.html` e si ferma al
primo.

La `textarea` della descrizione era l'**unica** di tutta l'app, e nasceva con
la maniglia di ridimensionamento: trascinata sfonda il dialogo. In
`tokens.css`, dove stanno i componenti di base, `textarea.input` ora ha
`resize: none` — vale anche per le prossime.

## 6. «＋ Nuova» e «Annulla» non facevano niente

Un sintomo solo, una causa sola, e spiega anche come l'utente ha visto le
cose del punto 5 senza mai premere «Nuova».

```css
#fb-form { display: flex; … }     /* specificita' (1,0,0) */
[hidden] { display: none }        /* UA stylesheet, (0,1,0) */
```

Il selettore di id vince: l'attributo `hidden` su `#fb-form` **non nasconde
niente**. Il modulo della nuova segnalazione era quindi sempre aperto, e da
lì i due sintomi: «＋ Nuova» non apriva niente perché era già aperto,
«Annulla» non chiudeva niente perché metteva `hidden` e il CSS lo ignorava.
Nessuno dei due pulsanti era scollegato: facevano il loro lavoro su un
attributo che non contava nulla.

La trappola era già nota nel repo: `.group-body[hidden] { display: none }`
ha sopra un commento che la spiega, e `.type-colors-reset[hidden]` fa lo
stesso. Mancava solo qui. Si aggiunge `#fb-form[hidden] { display: none }`.

Un test nuovo la cerca da sola: per ogni elemento di `index.html` che nasce
`hidden` e ha un id, se il CSS gli dà un `display` suo allora deve esserci
anche `#id[hidden]`. Provato togliendo la correzione: diventa rosso e dice
quale id. Guarda solo gli id — una regola `#id` si applica di sicuro a
quell'elemento, mentre per le classi servirebbe un vero motore di selettori.

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
- `tests/feedback-source.test.js`: il testo va in `descrizione` e `ambiente`,
  e **`body` non viene mandato**. Un test non può accorgersi che GitHub
  ignora un parametro, ma può impedire che quel nome torni.
- `tests/ui.test.js`: nessun `class="btn"` senza variante in `index.html`.
- Il filo colorato e il `resize` si guardano a occhio: il CSS non si prova qui.
