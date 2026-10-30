# 73 — `feat/row-last-modify`: chi ha toccato la riga, e quando

Dipende da: 60 (sessione editor), 63 (barrette, `lib/editor-git.js`). Taglia: ~mezza giornata.

## Perché

Nella scheda editor una riga non dice da dove viene: per sapere chi l'ha
scritta e quando serve un terminale e `git blame`. La scheda lo mostra da sé.

## Cosa fa

- In fondo alla riga del cursore, in grigio: `Autore, 3 giorni fa · messaggio
  del commit` (stile GitLens). Mouse sopra quel testo: fumetto con hash
  corto, autore e mail, data completa, messaggio.
- Riga cambiata e non ancora committata (anche non salvata), o file non in
  HEAD: `Modifica non committata`.
- Niente testo fuori da git, per i file ignorati, senza git nel PATH.
- Compare quando il cursore si ferma (`EDITOR_BLAME_DELAY`); mentre si
  scrive si toglie.

## Come

- **git** (`lib/editor-git.js`, `blameLine(rel, line, text)`): `git blame
  --porcelain -L n,n --contents - -- <nome>` dalla cartella del file, col
  testo dell'editor sullo stdin. Così i numeri di riga sono quelli che
  l'utente vede anche con modifiche non salvate, e le righe nuove tornano con
  l'hash di zeri («Not Committed Yet»). Una riga sola: veloce anche su file
  con tanta storia. Sempre `runGit` (execFile, mai la shell).
  Errori: «no such path … in HEAD» e «no such ref: HEAD» = non committata;
  file ignorato (`check-ignore`) = `reason: 'ignored'`.
- **IPC**: `editor-blame-line` (`app/editor.js`), percorso confinato come gli
  altri canali, testo oltre `MAX_READ` rifiutato.
- **Etichetta** (`renderer/editor-blame.js`, UMD puro): testo breve con il
  tempo relativo (`Intl.RelativeTimeFormat('it')`) e il fumetto lungo.
- **Monaco** (`renderer/editor-monaco.js`): `onCursorLine(rel, line)` quando
  il cursore cambia riga o il testo cambia; `setLineInfo(rel, line, info)`
  disegna una decorazione `after` in fondo alla riga col `hoverMessage`.
- **Scheda** (`renderer/editor-blame-ui.js`): attesa, richiesta al main; una
  risposta superata (altra riga, altro file, testo cambiato nel frattempo:
  `host.version`) si scarta. Niente cache: una riga sola costa poco, e il
  cursore che si ferma è già il freno.
- Lo stacco dal codice sta nel testo (spazi non separabili), non in un
  margine CSS: Monaco può spezzare il testo iniettato in più span e il
  margine cadeva su ognuno, aprendo un buco a metà frase (visto nello smoke).

## Test

- `tests/editor-git.test.js`: git vero su tmpdir — riga committata, riga
  cambiata non salvata, file nuovo, repository senza commit, fuori da git,
  file ignorato, riga fuori range, percorso fuori dalla cartella; parsing del
  porcelain.
- `tests/editor-blame.test.js`: tempo relativo, etichetta, non committata.
- `tests/editor-monaco.test.js`: `onCursorLine`, `setLineInfo`.
- `tests/editor-blame-ui.test.js`: attesa, risposta superata, errori taciuti.
- `tests/editor-ipc.test.js`: il canale risponde e rifiuta payload cattivi.

## Fuori

- Blame di tutto il file nel margine (colonna a sinistra).
- Aprire il commit dal fumetto.
