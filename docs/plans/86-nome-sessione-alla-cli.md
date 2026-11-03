# 86 — `feat/rename-sessioni`: il nome della sessione arriva alla CLI

Dipende da: 46 (iniezione degli hook). Taglia: ~3h.

## Perché

Il nome che l'utente dà a una sessione nel dialog «Nuova sessione» resta in
PizzaManager: la CLI non lo sa, e nel suo `/resume`, nel riquadro del prompt e
nel titolo del terminale la conversazione ha un altro nome. Chi riprende la
conversazione da un'altra parte (terminale, altra macchina) non la ritrova.

## Cosa fa

- **Claude**: una sessione nuova con un nome scelto dall'utente parte con
  `--name=<nome>`. Il nome compare nel riquadro del prompt, nel `/resume` di
  Claude e nel titolo del terminale.
- **opencode**: il plugin del piano 46 dà il nome alla sessione appena nasce
  (sotto, «opencode»).
- **Rinomina dopo l'avvio**: arriva alla CLI al prossimo resume da PizzaManager
  (sotto).
- **Solo i nomi scelti dall'utente.** Il nome generato (`claude · 3`), il
  titolo del CLI con cui si riapre una conversazione, il nome preso dal primo
  prompt: niente. `label` resta il nome della scheda; alla CLI va `sessionName`.
- **Il profilo vince**: se il comando configurato ha già `-n`/`--name` non si
  aggiunge niente.
- Nessun nome, nome vuoto o fatto solo di spazi → niente.

## Come

- `lib/session-name.js`: `cleanName(name)` (via i caratteri di controllo,
  spazi compattati, massimo `NAME_MAX` = 60 caratteri, come
  `session-titles.js`) e `nameInjection(type, name, { args, resumeId })` →
  `{ args, env }` da aggiungere: `--name=<nome>` per claude, le variabili del
  plugin per opencode, niente per gli altri tipi. Forma `--name=` e non due
  argomenti: un nome che comincia con `-` non diventa un'opzione (provato con
  claude 2.1.317).
- `lib/commands.js`: `buildCommand` prende `sessionName` e aggiunge
  `nameInjection` **prima** di comporre la riga per cmd.exe, come gli hook del
  piano 46; le variabili finiscono in `injectedEnv`. `baseArgs` (la
  cronologia) resta senza nome.
- `app/pty.js`: `spawn` riceve `sessionName` e lo passa a `buildCommand`. Il
  valore arriva dal renderer: `nameInjection` lo valida (stringa, lunghezza,
  caratteri di controllo). Passa come argv senza shell.
- `renderer/tabs.js`: `createTab` prende `sessionName` e manda a `spawn`
  `cliNameFor(...)` (sotto). `renderer/renderer.js`: il dialog «Nuova
  sessione» lo passa uguale a `name`.
- `lib/agent-hooks.js` esporta `hasFlag` e i nomi delle variabili; il plugin di
  opencode ha il blocco della rinomina.

## Verificato a mano (claude 2.1.317)

- `claude --name prova` mostra il nome nel riquadro del prompt prima del primo
  messaggio; al primo messaggio il file della conversazione riceve
  `{"type":"custom-title","customTitle":"prova"}`.
- `claude --resume <id> --name altro` **rinomina subito** la conversazione
  esistente, senza turni: nel file compare un `custom-title` nuovo. Quindi un
  nome cambiato in PizzaManager si può portare a Claude al prossimo resume,
  senza scrivere `/rename` nel terminale.
- `claude '--name=-trattino'` → nome `-trattino`, nessun errore di opzione.

## Rinomina dopo l'avvio: arriva al prossimo resume

La CLI già aperta non sa della rinomina della scheda. Scrivere `/rename` nel
terminale è stato scartato: bisogna indovinare quando l'interfaccia è pronta,
si mescola con quello che l'utente sta scrivendo e il turno in più può
accendere il segnale «ha finito» di attention.js (di Ale, non si tocca).
Deciso con l'utente il 2026-11-03: il nome arriva a Claude al prossimo resume
da PizzaManager, con `--resume <id> --name=<nome>`.

- `renderer/session-titles.js`: `setName(type, id, name, { chosen })` segna i
  nomi scelti dall'utente in una chiave a parte
  (`aisess.session-names.chosen.v1`), così il formato dei nomi resta quello di
  prima. `chosenNameFor` li restituisce; un nome non scelto (primo prompt)
  toglie il segno. `cliNameFor(store, { type, resumeId, sessionName })`: il
  nome del dialog, se no quello scelto per la conversazione ripresa.
- `renderer/tabs.js`: `createTab` passa a `spawn` `cliNameFor(...)` e segna la
  scheda con `nameChosen`. Vale per ogni strada che apre con un `resumeId`
  (dialog Resume, cronologia, ripristino dopo un riavvio).
- `renderer/tab-names.js`: la rinomina salva con `chosen: true`; il giro dei
  titoli lega il nome della scheda alla conversazione con
  `chosen: tab.nameChosen`. Il nome dal primo prompt resta fuori: Claude ha
  già un titolo suo, migliore di 40 caratteri del prompt.
- I nomi dati prima di questo branch non hanno il segno: non arrivano a Claude
  finché non si rinomina di nuovo.

Smoke ✅ 2026-11-03 (CDP, profilo di prova): conversazione ripresa, rinominata
dal modal in «rinominata in pizza», tmux chiuso, ripresa di nuovo → tmux lancia
`claude --resume <id> "--name=rinominata in pizza"`, Claude lo mostra nel
riquadro e il file della conversazione ha il `custom-title`.

## opencode: il nome passa dal plugin

opencode non ha un flag per l'interfaccia interattiva (`--title` vale solo per
`opencode run`). Il nome arriva al plugin che già iniettiamo (piano 46) con
due variabili d'ambiente, `AISESS_SESSION_NAME` e, al resume,
`AISESS_SESSION_ID`; il plugin chiama `client.session.update`.

Provato a mano il 2026-11-03 (1.18.30, poi 1.19.5 dopo l'aggiornamento
automatico di opencode), con un plugin sonda e il modello gratuito di Zen:

- (a) la sessione nasce al primo messaggio: `session.created` arriva lì.
- (b) il titolo resta il nostro anche dopo il turno e il `session.idle`:
  opencode genera il suo solo se il titolo è quello di default.
- (c) il plugin riceve `{ client, project, worktree, directory, serverUrl, $ }`.
  Funziona `client.session.update({ path: { id }, body: { title } })`; la
  forma `{ sessionID, title }` dà «Unexpected server error».
- Al resume `session.created` non arriva: il plugin rinomina all'avvio (fuori
  dall'init, con `setTimeout`) la sessione di `AISESS_SESSION_ID`. Nessun turno.

Regole nel plugin: una sola rinomina per processo, mai una sessione figlia
(`parentID`, i subagenti), mai al resume una sessione nuova creata dopo con
`/new`. Errori taciuti come per il segnale: il plugin non deve rompere
opencode. Le regole del segnale non cambiano: il blocco è a parte e
`session.created` non era tra gli eventi del segnale.

Le variabili ci sono sempre per opencode, vuote senza nome: quelle dell'app
(avviata da una scheda opencode con un nome) non devono passare a un'altra
sessione, come il file del segnale (piano 59).

Se il profilo ha già `OPENCODE_CONFIG_CONTENT` il plugin non si inietta, e il
nome non arriva: stessa rinuncia del segnale.

Smoke ✅ 2026-11-03 (CDP, profilo di prova, opencode 1.19.5): dialog «Nuova
sessione» con nome → tmux ha `AISESS_SESSION_NAME`, al primo messaggio
`opencode session list` mostra il nome; rinomina in PizzaManager, tmux chiuso,
ripresa → il titolo cambia senza messaggi.

## Fuori

- codex e agy: nessun flag, solo `/rename` dentro l'interfaccia (annotati in
  `idee.md`).
- Leggere il `custom-title` di Claude nei titoli di PizzaManager
  (`lib/claude-sessions.js` oggi legge `ai-title`, primo prompt e `summary`):
  un nome dato con `/rename` dentro Claude non arriva alla scheda.

## Test

- `tests/session-name.test.js`: `nameInjection` per claude, opencode e gli
  altri tipi; il plugin di opencode caricato come modulo con un `client` finto
  (prima sessione sì, figlie e seconde no, resume, senza nome, errori); nome
  vuoto o non stringa, caratteri di controllo, taglio a 60, `-n`/`--name`/
  `--name=` già nel profilo.
- `tests/session-titles.test.js`: nomi scelti e no, segno che sopravvive al
  riavvio e si toglie, formato dei nomi invariato, `cliNameFor`.
- `tests/unit.test.js`: `buildCommand` con `sessionName` mette il flag in
  `args` ma non in `baseArgs`; senza nome gli args non cambiano; per opencode
  nome e id ripreso finiscono in `injectedEnv`.
- `tests/windows.test.js`: il nome con spazi e `&` finisce intatto nella riga
  di cmd.exe.
- Smoke: `AISESS_PROFILE=nome83 npm start`, sessione Claude con un nome →
  il nome nel riquadro del prompt. ✅ 2026-11-03 (CDP sul dialog vero): nome
  `smoke 83 & -nome` → tmux lancia `claude "--name=smoke 83 & -nome"` e Claude
  lo mostra nel riquadro; senza nome la scheda è `claude · 1` e il flag non c'è.
