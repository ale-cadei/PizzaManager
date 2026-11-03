# 83 — `feat/rename-sessioni`: il nome della sessione arriva alla CLI

Dipende da: 46 (iniezione degli hook). Taglia: ~2h.

## Perché

Il nome che l'utente dà a una sessione nel dialog «Nuova sessione» resta in
PizzaManager: Claude non lo sa, e nel suo `/resume`, nel riquadro del prompt e
nel titolo del terminale la conversazione ha un altro nome. Chi riprende la
conversazione da un'altra parte (terminale, altra macchina) non la ritrova.

## Cosa fa

- **Claude**: una sessione nuova con un nome scelto dall'utente parte con
  `--name=<nome>`. Il nome compare nel riquadro del prompt, nel `/resume` di
  Claude e nel titolo del terminale.
- **Solo i nomi scelti dall'utente.** Il nome generato (`claude · 3`), il
  titolo con cui si riapre una conversazione dal dialog Resume, il nome preso
  dal primo prompt: niente flag. Si passa solo il campo `sessionName`, che
  arriva dal dialog «Nuova sessione»; `label` resta il nome della scheda.
- **Il profilo vince**: se il comando configurato ha già `-n`/`--name` non si
  aggiunge niente.
- Nessun nome, nome vuoto o fatto solo di spazi → nessun flag.

## Come

- `lib/session-name.js`: `cleanName(name)` (via i caratteri di controllo,
  spazi compattati, massimo `NAME_MAX` = 60 caratteri, come
  `session-titles.js`) e `nameArgs(type, name, args)` → `['--name=<nome>']` per
  `claude`, `[]` per gli altri tipi. Forma `--name=` e non due argomenti: un
  nome che comincia con `-` non diventa un'opzione (provato con claude
  2.1.317).
- `lib/commands.js`: `buildCommand` prende `sessionName` e aggiunge
  `nameArgs` **prima** di comporre la riga per cmd.exe, come gli hook del
  piano 46. `baseArgs` (la cronologia) resta senza nome.
- `app/pty.js`: `spawn` riceve `sessionName` e lo passa a `buildCommand`. Il
  valore arriva dal renderer: `nameArgs` lo valida (stringa, lunghezza,
  caratteri di controllo). Passa come argv senza shell.
- `renderer/tabs.js`: `createTab` prende `sessionName` e lo manda a `spawn`.
  `renderer/renderer.js`: il dialog «Nuova sessione» lo passa uguale a `name`.
- `lib/agent-hooks.js` esporta `hasFlag`, che serve anche qui.

## Verificato a mano (claude 2.1.317)

- `claude --name prova` mostra il nome nel riquadro del prompt prima del primo
  messaggio; al primo messaggio il file della conversazione riceve
  `{"type":"custom-title","customTitle":"prova"}`.
- `claude --resume <id> --name altro` **rinomina subito** la conversazione
  esistente, senza turni: nel file compare un `custom-title` nuovo. Quindi un
  nome cambiato in PizzaManager si può portare a Claude al prossimo resume,
  senza scrivere `/rename` nel terminale.
- `claude '--name=-trattino'` → nome `-trattino`, nessun errore di opzione.

## Aperto: rinomina dopo l'avvio

La CLI già aperta non sa della rinomina della scheda. Scrivere `/rename` nel
terminale è stato scartato: bisogna indovinare quando l'interfaccia è pronta,
si mescola con quello che l'utente sta scrivendo e il turno in più può
accendere il segnale «ha finito» di attention.js (di Ale, non si tocca).
Da decidere con l'utente: accettarlo così, o passare `--name` al resume. Il
nome scelto è in `titleStore` insieme a quello preso dal primo prompt, quindi
nel secondo caso serve distinguerli.

## Secondo passo: opencode

opencode 1.18.30 non ha un flag per l'interfaccia interattiva (`--title` vale
solo per `opencode run`). Il plugin che già iniettiamo (piano 46) può chiamare
`client.session.update({ sessionID, title })` all'evento `session.created`,
con il nome in una variabile d'ambiente. Prima di scriverlo va provato a mano:

- (a) nell'interfaccia interattiva la sessione nasce al primo messaggio?
- (b) il titolo che opencode genera dopo il primo messaggio sovrascrive il
  nostro?
- (c) cosa riceve il plugin come argomento (oggi la default export lo ignora)?

Se la prova va male, lo si scrive qui e opencode resta fuori.

## Fuori

- codex e agy: nessun flag, solo `/rename` dentro l'interfaccia (annotati in
  `idee.md`).
- Leggere il `custom-title` di Claude nei titoli di PizzaManager
  (`lib/claude-sessions.js` oggi legge `ai-title`, primo prompt e `summary`):
  un nome dato con `/rename` dentro Claude non arriva alla scheda.

## Test

- `tests/session-name.test.js`: `nameArgs` per claude e gli altri tipi, nome
  vuoto o non stringa, caratteri di controllo, taglio a 60, `-n`/`--name`/
  `--name=` già nel profilo.
- `tests/unit.test.js`: `buildCommand` con `sessionName` mette il flag in
  `args` ma non in `baseArgs`; senza nome gli args non cambiano.
- `tests/windows.test.js`: il nome con spazi e `&` finisce intatto nella riga
  di cmd.exe.
- Smoke: `AISESS_PROFILE=nome83 npm start`, sessione Claude con un nome →
  il nome nel riquadro del prompt. ✅ 2026-11-03 (CDP sul dialog vero): nome
  `smoke 83 & -nome` → tmux lancia `claude "--name=smoke 83 & -nome"` e Claude
  lo mostra nel riquadro; senza nome la scheda è `claude · 1` e il flag non c'è.
