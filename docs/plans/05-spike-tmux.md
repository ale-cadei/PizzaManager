# Branch 5 — `spike/tmux`

**Dipende da**: niente, si può fare subito. **Taglia**: ~4h. **Il codice si butta: questo branch non si merge mai.**

---

## Perché esiste

Il branch 6 vuole spostare le sessioni dentro `tmux`, così che i processi
sopravvivano alla chiusura dell'app (vedi [06](06-tmux-backend.md) per il
perché). È un lavoro da 3-5 giorni che poggia su un'assunzione non verificata:
che le interfacce a schermo pieno di `claude` e `opencode` funzionino bene con
tre emulatori di terminale impilati.

```
claude disegna la sua interfaccia
   ↓ sequenze di escape
tmux le interpreta e le ritrasmette
   ↓
xterm.js le interpreta e le disegna nella finestra Electron
```

Ogni strato traduce, e traducendo può perdere qualcosa. Questo spike costa mezza
giornata e serve a non scoprirlo dopo tre giorni di lavoro.

## Le quattro domande

1. **`claude` dentro tmux, in un terminale normale.** I colori sono giusti (tmux
   di default declassa il truecolor a 256 colori, e le TUI moderne diventano
   sbiadite)? Il cursore si comporta bene? Il ridisegno è pulito o sfarfalla?
2. **Lo stesso, ma dentro l'app** (quindi dentro xterm.js). Se il punto 1 va bene
   e il 2 no, il colpevole è xterm.js e non tmux.
3. **I tasti.** tmux si prende `Ctrl+B` come prefisso. Serve a `claude` o a
   `opencode`? Se sì, va rimappato o disattivato (`set -g prefix None`) — e
   funziona davvero?
4. **Stacca e riattacca.** Dopo `detach` + `attach`, il contenuto torna intatto o
   si riparte da schermo pulito?

## Metodo

**Domanda 1** — nessun codice, basta un terminale:

```bash
tmux new -s prova -- claude
```

Se già qui è sfarfallante o sbiadito, il problema è tmux+claude e non c'entra
niente l'app. Ripetere con `opencode`.

**Domanda 2** — cambiare **una riga sola** in `lib/commands.js` perché il comando
passi da tmux, poi `npm start` e guardare. Codice sporco, nessuna cura: serve a
vedere, non a restare.

**Domande 3 e 4** — dentro l'app: provare le combinazioni di tasti che le due
TUI usano davvero, poi chiudere la finestra dell'app, riaprirla e verificare
cosa si ritrova.

Provare anche con `tmux -f /dev/null` (nessuna configurazione) per distinguere i
problemi di tmux in sé da quelli ereditati dal `.tmux.conf` personale.

## Criterio di stop

**Se la domanda 1 o la 2 danno esito negativo e non si risolvono con la
configurazione, il branch 6 decade** e si ripiega sull'opzione C: tenere il
comportamento attuale, aggiungere un avviso alla chiusura se ci sono sessioni
vive («3 sessioni verranno terminate») e ripristinare il solo layout delle schede
dalla cronologia già salvata in `sessions-history.json`.

Scoprirlo qui costa mezza giornata. Scoprirlo dentro il branch 6 costa una
settimana.

## Cosa consegna

**Non codice**: mezza pagina di appunti in `docs/plans/05-risultati.md` con la
risposta alle quattro domande, e — se l'esito è positivo — la configurazione
tmux minima che è servita per farlo funzionare. Quella configurazione è
l'ingrediente principale del branch 6.

Al termine si compila [`06-tmux-backend.md`](06-tmux-backend.md), che oggi è
volutamente uno stub.

## Note ambientali

Su questa macchina `tmux` c'è (3.7c, da Homebrew, in `/opt/homebrew/bin/tmux`).
**Su macOS non è preinstallato**: il branch 6 dovrà gestire il caso in cui manchi.
Vale la pena provare lo spike anche con un `.tmux.conf` personalizzato per capire
quanto la configurazione dell'utente influenzi il risultato.
