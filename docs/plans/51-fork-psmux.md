# 51 — Fork di psmux: rifiniture, non bloccanti

Repo: fork di <https://github.com/psmux/psmux> sotto l'account dell'utente
(`JackGrieco/psmux`, clonato sul fisso Windows, branch `pizza/base`) · Base:
tag **v3.3.8** (`66cf613`) · Dipende da: 40 · Taglia: ~1 g
**Si fa su Windows**: psmux è Windows-only, e le prove valgono solo lì.

> **Stato (2026-10-10): non serve al piano 52.** Il difetto bloccante, la
> selezione col mouse, si è rivelato una riga di config (`set -g mouse on`,
> vedi «Il mouse» in [`40-risultati.md`](40-risultati.md)). Il pacchetto usa
> quindi **psmux originale**. Questo piano resta come idea per migliorare
> (`idee.md`, «Distribuzione»): rende la barra di scorrimento fluida e precisa.
> Si fa quando dà fastidio, o quando una release di psmux rompe qualcosa che
> va corretto da noi.

## Regole del fork

- **Leggero**: ogni correzione è un branch sopra il tag di base, piccolo e
  autosufficiente, **ed è anche una pull request verso `psmux/psmux`**. Quando
  l'autore le accetta, PizzaManager prende la sua release e il fork non serve
  più.
- psmux corre veloce (più di 100 commit nell'ultimo mese): un fork che diverge
  diventa impossibile da riallineare. È la lezione della PR #5 di `CLAUDE.md`,
  su un repo altrui.
- Se mai il pacchetto dovesse usare il fork, il fork pubblica **release
  proprie** con la CI che psmux ha già (`.github/workflows/release.yml`). Il
  tag porta la base nel nome, es. `v3.3.8-pizza.1`. Il piano 52 cambia solo
  l'URL e lo SHA-256 dello zip.
- Prima della prima PR, un messaggio all'autore: chi siamo, che usiamo psmux
  in PizzaManager, che arrivano alcune PR. Il testo lo prepara Claude in
  inglese, lo manda l'utente.
- Ogni correzione porta i suoi test, nello stile di psmux: `tests-rs/` per i
  test Rust e `tests/` per gli script PowerShell.

## Com'è oggi, con `mouse on`

Il client psmux mette sempre il terminale esterno in modalità mouse
(`\e[?1003;1006h`). Per `renderer/term-scroll.js` è quindi sempre «un
programma a schermo intero che vuole il mouse»:

- la **rotella** va a psmux come evento di mouse, e psmux scorre la sua history;
- la **barra** non usa `scrollArgs`/`scrollToArgs`: trasforma il trascinamento
  in scatti di rotella (`sendTicks`) e ne **stima** la lunghezza (lo stato
  «virtuale»). Funziona, verificato dall'utente, ma va **un po' a scatti**:
  ogni pezzo di trascinamento è uno scatto da mandare. Inoltre la sua
  lunghezza non è quella vera della history.

## Le correzioni, in ordine di utilità

| | Correzione | Cosa migliora |
|---|---|---|
| 3 | i comandi di scorrimento da riga di comando | barra fluida e lunga quanto la history |
| 2 | la riga vuota in fondo | cosmetica, l'utente non la nota |
| 4 | `prefix None` | niente: il ripiego `C-M-S-F12` funziona |
| 5 | `^B` in PowerShell | prima si riproduce fuori da PizzaManager |

La vecchia correzione 1 (catturare il mouse solo quando serve) **non si fa**: la
causa vera era `mouse off`. Con quel valore il server **scarta** gli eventi di
mouse destinati al pane (`src/server/mod.rs`, ramo `CtrlReq::PaneMouse`:
`if app.mouse_enabled { … }`), quindi Claude non riceveva il trascinamento e non
selezionava. Con `mouse on` riceve gli stessi byte che senza psmux. Nelle
shell seleziona psmux, e copia sia negli appunti di Windows sia via OSC 52.

### 3. I comandi della copy-mode da riga di comando

PizzaManager scorre la history del pane con un solo processo per scatto:
`copy-mode -e ; send-keys -X -N <n> scroll-up ; display-message -p …`
(`lib/tmux.js`, `chain`, `scrollArgs`, `scrollToArgs`). In psmux tre pezzi
non funzionano:

| | Oggi | Dove |
|---|---|---|
| a | `;` come argomento a sé non separa i comandi: `display-message -p A ';' display-message -p B` stampa `A ; display-message B`. Il server le catene le conosce già (`src/server/connection.rs`, `requote_command_tail`), è la riga di comando che non le passa | `src/main.rs`, parsing degli argomenti |
| b | `send-keys -N <n>` scarta il numero **apposta**: `"-N" => { i += 1; } // repeat count, consume value` | `src/main.rs`, ramo `send-keys` |
| c | `send-keys -X goto-line <n>` sposta solo il cursore (`app.copy_pos = Some((n, 0))`), non la vista | `src/server/mod.rs`, ramo `goto-line` |

Da solo non basta. Perché la barra usi la strada vera, `term-scroll.js` deve
smettere di trattare il client psmux come una TUI che vuole il mouse. Serve
quindi anche un modo per sapere se il **pane** vuole il mouse: `dump-state` ha
già `wants_mouse` e `alternate_screen`. Questa parte va disegnata nel piano 52,
non qui. Va controllato anche cosa intende tmux con il numero di `goto-line`:
PizzaManager gli passa righe **dal fondo** (`scrollToArgs`, `fromBottom`).

### 2. Con `status off`, nessuna riga riservata

Il client riserva `max(status_lines, 1)` righe (`src/client.rs`,
`let new_sl = (status_lines as u16).max(1);`): con `status off` il pane ha
una riga in meno della finestra. Prima va capito perché c'è il `.max(1)`:
forse serve a `display-message` o al command-prompt quando la barra è spenta.

### 4. `set -g prefix None`

`parse_key_name("None")` non riconosce il nome e il prefisso resta `C-b`
in silenzio (`src/config.rs`, ramo `"prefix"`). Il ripiego
`set -g prefix C-M-S-F12` funziona (Ctrl+B arriva a Claude). Si corregge solo
se l'autore lo vuole.

### 5. Ctrl+lettera in PowerShell

In PowerShell Ctrl+B arriva come `^B` letterale invece di spostare il cursore
(PSReadLine); in Claude funziona. Prima si riproduce in Windows Terminal con
psmux: se succede anche lì, è una issue per l'autore.

## Fatto quando

- la correzione 3 è nel fork con i suoi test e con la sua pull request aperta
  verso `psmux/psmux`;
- nella finestra di prova la barra di scorrimento segue il trascinamento senza
  scatti ed è lunga quanto la history vera.
