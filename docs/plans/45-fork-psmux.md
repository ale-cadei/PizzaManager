# 45 — Fork di psmux: le correzioni che servono a PizzaManager

Repo: fork di <https://github.com/psmux/psmux> sotto l'account dell'utente
(`JackGrieco/psmux`) · Base: tag **v3.3.8** (`66cf613`) · Dipende da: 40 ·
Taglia: ~1 g
**Si fa su Windows**: psmux è Windows-only, e le prove valgono solo lì.

> **Per chi lo riceve.** Leggi prima [`40-risultati.md`](40-risultati.md): ogni
> difetto qui sotto è stato misurato lì, con comandi e output. Questo piano dice
> *cosa* cambiare in psmux e *perché* serve a PizzaManager. Il *come* si decide
> leggendo il codice: i riferimenti sono a v3.3.8, cercali per nome.

## Regole del fork

- **Leggero**: ogni correzione è un branch sopra il tag di base, piccolo e
  autosufficiente, **ed è anche una pull request verso `psmux/psmux`**. Quando
  l'autore le accetta si torna alla sua release e il fork si spegne.
- psmux corre veloce (più di 100 commit nell'ultimo mese): un fork che diverge
  diventa impossibile da riallineare. È la lezione della PR #5 di `CLAUDE.md`,
  su un repo altrui.
- Il fork pubblica **release proprie** con la CI che psmux ha già
  (`.github/workflows/release.yml`: build Windows x64/x86/arm64 e zip). Il tag
  porta la base nel nome, es. `v3.3.8-pizza.1`. PizzaManager scarica quello
  zip a versione fissata e ne verifica lo SHA-256 (piano 46): niente Rust nella
  CI di PizzaManager.
- Prima della prima PR, un messaggio all'autore: chi siamo, che usiamo psmux
  in PizzaManager, che arrivano alcune PR. Il testo lo prepara Claude in
  inglese, lo manda l'utente.
- Ogni correzione porta i suoi test, nello stile di psmux: `tests-rs/` per i
  test Rust e `tests/` per gli script PowerShell.

## Le correzioni, in ordine di importanza

**Il fork fa la 1 e la 3, insieme.** La 1 restituisce la selezione col mouse, ma
così la rotella torna a PizzaManager, e senza la 3 smetterebbe di funzionare.
La 2 e la 4 sono facoltative: l'utente non nota la riga vuota, e per Ctrl+B
basta il ripiego in config (deciso il 2026-10-10). La 5 è solo da capire.

| | Correzione | Nel fork? |
|---|---|---|
| 1 | il mouse a psmux solo quando serve | **sì** |
| 3 | i comandi di scorrimento di PizzaManager | **sì**, insieme alla 1 |
| 2 | la riga vuota in fondo | se avanza tempo |
| 4 | `prefix None` | no, ripiego `C-M-S-F12` |
| 5 | `^B` in PowerShell | prima si riproduce fuori da PizzaManager |

### 1. Il client cattura il mouse solo quando serve — **indispensabile**

**Oggi.** All'avvio il client manda sempre `EnableMouseCapture`
(`src/main.rs`, `execute!(stdout, EnterAlternateScreen, EnableBlinking,
EnableMouseCapture, EnableBracketedPaste)`), qualunque cosa dica `mouse`.
xterm.js vede un'applicazione che ha chiesto il mouse e le dà il drag: in
PizzaManager **non si seleziona più testo**.

**Come tmux.** Con `mouse off` tmux non cattura il mouse, ma se l'applicazione
nel pane lo chiede (DECSET 1000/1002/1003) le sequenze arrivano al terminale
esterno e il mouse va all'applicazione (`app/tmux.conf`, commento su `mouse
off`).

**La correzione.** Il client accende la cattura solo se `mouse on` **oppure** il
pane attivo la chiede, e la spegne quando smette. psmux sa già quale pane la
vuole: il server manda `wants_mouse` per ogni foglia del layout
(`src/client.rs`, `pane_wants_mouse_json`), e l'inoltro degli eventi al pane
esiste già (`src/input.rs`, `pane_wants_mouse`). Si tratta di cambiare la
cattura a ogni fotogramma, non all'avvio una volta per tutte. Qualche decina
di righe.

**Per PizzaManager**: la selezione torna come su Mac. Le TUI che vogliono il
mouse (claude, codex, opencode) continuano ad averlo. **Ma la rotella torna
all'app** (`renderer/term-scroll.js`: senza mouse catturato la gestisce lei),
quindi serve la correzione 3.

### 2. Con `status off`, nessuna riga riservata — **cosmetica, facoltativa**

**Oggi.** Il client riserva `max(status_lines, 1)` righe (`src/client.rs`,
`let new_sl = (status_lines as u16).max(1);`): con `status off` il pane ha una
riga in meno della finestra, e in fondo resta una striscia vuota.

**La correzione.** Con la barra spenta si riservano 0 righe. Prima va capito
perché c'è il `.max(1)`: forse serve a `display-message` o al command-prompt
quando la barra è spenta. In quel caso vanno disegnati in sovrimpressione,
come fa tmux. PizzaManager non li usa sul client.

### 3. I comandi della copy-mode da riga di comando — **indispensabile dopo la 1**

PizzaManager scorre la history del pane con un solo processo per scatto di
rotella: `copy-mode -e ; send-keys -X -N <n> scroll-up ; display-message -p
…` (`lib/tmux.js`, `chain`, `scrollArgs`, `scrollToArgs`). In psmux tre
pezzi non funzionano:

| | Oggi | Dove |
|---|---|---|
| a | `;` come argomento a sé non separa i comandi: `display-message -p A ';' display-message -p B` stampa `A ; display-message B`. Il server le catene le conosce già (`src/server/connection.rs`, `requote_command_tail`), è la riga di comando che non le passa | `src/main.rs`, parsing degli argomenti |
| b | `send-keys -N <n>` scarta il numero **apposta**: `"-N" => { i += 1; } // repeat count, consume value` | `src/main.rs`, ramo `send-keys` |
| c | `send-keys -X goto-line <n>` sposta solo il cursore (`app.copy_pos = Some((n, 0))`), non la vista | `src/server/mod.rs`, ramo `goto-line` |

**Per PizzaManager**: con le tre correzioni `lib/tmux.js` resta **identico su
Mac e Windows**. Senza, servirebbe una variante Windows con tre processi per
scatto di rotella, e su Windows lanciare un processo costa decine di
millisecondi: la rotella andrebbe a scatti. Va controllato anche cosa intende
tmux con il numero di `goto-line`: PizzaManager gli passa righe **dal fondo**
(`scrollToArgs`, `fromBottom`).

### 4. `set -g prefix None` — **non si fa**

**Oggi** `parse_key_name("None")` non riconosce il nome e il prefisso resta
`C-b` in silenzio (`src/config.rs`, ramo `"prefix"`).

**Ripiego che funziona già**: `set -g prefix C-M-S-F12`, una combinazione che
nessuno preme (verificato: Ctrl+B arriva a Claude). La correzione vera,
`prefix_key` come `Option`, tocca client, input e formati. Si fa solo se
l'autore la vuole: per PizzaManager il ripiego basta.

### 5. Ctrl+lettera in PowerShell — **da capire**

In PowerShell Ctrl+B arriva come `^B` letterale invece di spostare il cursore
(PSReadLine). In Claude invece funziona. La causa non è nota: probabilmente come
il server scrive i caratteri di controllo nella ConPTY del pane
(`send-key-raw`). Prima si riproduce fuori da PizzaManager, in Windows
Terminal con psmux. Se succede anche lì, è una issue per l'autore.

## Fuori da questo piano

- L'avviso `unknown option 'terminal-features'`: PizzaManager avrà una config
  sua per psmux senza quella riga (piano 46).
- Il server «caldo» `__warm__`: si spegne da config, `set -g warm off`.
- L'alternate screen sempre acceso sul terminale esterno: con la history di
  psmux e la copy-mode non dà fastidio, perché è lo stesso modello di tmux su
  Mac, dove la history di xterm è vuota comunque.

## Fatto quando

- le correzioni 1 e 3 sono nel fork, ognuna con i suoi test e con la sua pull
  request aperta verso `psmux/psmux`;
- il fork ha una release `v3.3.8-pizza.N` con lo zip x64;
- con quello zip, la Q1 di `40-risultati.md` (script in «Come rifare le prove»)
  dà ✅ su tutte le righe, e nella finestra di prova si seleziona il testo e la
  rotella e la barra di scorrimento muovono la history.
