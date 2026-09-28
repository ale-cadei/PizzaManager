# 28 — La rotella su codex scorre la chat, non i prompt inviati

Branch: `fix/rotella-codex` · Dipende da: 6 (backend tmux) · Taglia: ~1h

## Il difetto

In una sessione codex la rotella non scorre la conversazione: sfoglia, uno
alla volta, i prompt già inviati, come la freccia su/giù in una shell.

## Perché

Misurato su codex-cli 0.157.0 (2026-09-25), catturando le sequenze che manda
all'avvio: `?1049h` (alternate screen) e `?1007h` (rotella → frecce), **nessuna**
modalità mouse (`?1000`/`?1002`/`?1003`/`?1006`). Claude e opencode invece il
mouse lo chiedono, e la rotella va a loro.

Nell'app:

1. `term.modes.mouseTrackingMode` resta `'none'`, quindi `renderer/term-scroll.js`
   non passa la rotella al programma;
2. tmux riporta `#{alternate_on}` = 1 per il pane;
3. il ramo pensato per less/vim/man manda `ESC[A` / `ESC[B` a ogni scatto;
4. nel prompt di codex freccia su/giù richiama i messaggi precedenti.

Scorrere la history di tmux non è un'alternativa: dentro l'alternate screen
tmux ne ha zero righe, la chat esiste solo nella memoria di codex.

## La correzione

`codex --no-alt-screen` (vale anche per `codex resume <id>`) disegna inline:
la conversazione resta nella schermata normale ed entra nella history di tmux,
che la rotella già scorre con la copy-mode, come per le shell. Senza tmux
(Windows) entra nello scrollback di xterm, stesso risultato.

Il flag si aggiunge al lancio in `buildCommand` (`lib/commands.js`), non nel
profilo di default: i `command-profiles.json` già salvati dicono solo `codex`,
e cambiare il default non li toccherebbe. Un profilo che lo contiene già non lo
riceve due volte.

## Verificato (socket di prova, `app/tmux.conf`, pane 100×20)

| | `alternate_on` | `history_size` dopo 3× `/status` |
|---|---|---|
| `codex` | 1 | 0 |
| `codex --no-alt-screen` | 0 | 76 |

La history inline contiene il riquadro iniziale, i `/status` e le loro
risposte. Dopo un ridimensionamento (70×16 → 110×24) il prompt resta in fondo,
integro.

## Da sapere

- Il riquadro «OpenAI Codex» compare due volte in cima alla history: il primo
  fotogramma («model: loading») resta sopra quello definitivo. Estetico, viene
  da codex.
- Chi vuole l'alternate screen non ha modo di riaverlo dal profilo. Se servirà,
  si aggiunge un'uscita; oggi nessuno l'ha chiesta.

## Test

`tests/unit.test.js`: sessione nuova e resume ricevono `--no-alt-screen`, un
profilo che lo ha già non lo duplica, claude e opencode restano come sono.
