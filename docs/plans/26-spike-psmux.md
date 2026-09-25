# 26 — Spike: psmux al posto di tmux su Windows

Branch: `spike/psmux` (codice usa-e-getta, **non si mergia**; si mergia solo
questo piano e i risultati) · Dipende da: 6, 8, 24 · Taglia: ~½ g
**Si fa su una macchina Windows**: da Mac non si prova niente di utile.

## Perché

Su Mac e Linux ogni sessione vive nel server tmux dell'app (socket
`aisession`) e sopravvive alla chiusura dell'app; dopo un riavvio del
computer il registro `live-sessions.json` permette di ripartire con
`claude --resume` (branch 8). Su Windows tmux non c'è: `detectTmux` restituisce
`null` su `win32` (`lib/tmux.js`), e le sessioni **muoiono con l'app**.

Esiste **psmux**, un clone di tmux nativo per Windows, scritto in Rust e
basato su ConPTY: niente WSL, Cygwin o MSYS2. Dichiara 76 comandi tmux, la
lettura di `.tmux.conf`, e installa anche un comando `tmux`. Esistono anche
wmux e minimux (stessa architettura: demone + named pipe), meno completi.

- <https://github.com/psmux/psmux> (c'è anche <https://github.com/wojtek/psmux>:
  capire quale è l'originale e quale il fork, e usare quello mantenuto)
- <https://lib.rs/crates/psmux>
- <https://github.com/bahri-hirfanoglu/wmux>, <https://github.com/llk214/minimux>

**L'idea**: tutto il backend tmux passa da `lib/tmux.js`, che si limita a
lanciare comandi tmux. Se psmux li capisce tutti, su Windows basta accettare
psmux in `detectTmux`: `app/pty.js`, il registro, il ripristino e lo
scorrimento restano come sono. Niente seconda codebase, niente repo separata.

**Il rischio**: «76 comandi» non vuol dire «quelli che usiamo noi». Lo spike
serve a rispondere a questa domanda con i fatti, non con il README di psmux.

## Domande a cui rispondere

| # | Domanda |
|---|---|
| Q1 | psmux accetta **esattamente** gli argomenti che costruisce `lib/tmux.js`? (tabella sotto) |
| Q2 | Il server psmux **sopravvive alla chiusura di PizzaManager**? (su Windows i figli possono stare in un Job Object che muore con l'app) |
| Q3 | Le TUI (`claude`, `codex`, `opencode`) e PowerShell reggono dentro psmux dentro xterm.js? Colori, resize, caratteri box-drawing |
| Q4 | La nostra `app/tmux.conf` viene applicata? (niente prefisso, niente barra di stato, niente mouse, niente alternate screen) |
| Q5 | Come si distingue psmux dal tmux di MSYS2/Cygwin (`tmux -V`? nome del binario?) — il piano 12 ha spento la ricerca su `win32` proprio per non prendere quello |
| Q6 | Dopo un riavvio di Windows il server psmux è morto (atteso) e il ripristino del branch 8 propone le sessioni? |

## Preparazione

1. `git pull`, `git switch spike/psmux`, `npm install` (su Windows non serve
   compilare node-pty: piano 24).
2. `npm run test:unit` verde **prima** di toccare niente (la CI gira già su
   `windows-2022`, deve essere verde anche in locale).
3. Installare psmux seguendo il suo README (release precompilata, oppure
   `cargo install psmux` — da verificare). Annotare versione e percorso del
   binario, e l'output di `psmux -V` e `tmux -V`.
4. **Socket di prova sempre**: `-L aistest-psmux`, mai `aisession` (regola di
   `CLAUDE.md`). Alla fine: `psmux -L aistest-psmux kill-server`.

## Q1 — I comandi, uno per uno

Da PowerShell, `$b = 'C:\percorso\psmux.exe'`, `$L = '-L','aistest-psmux'`,
`$f = '-f', "$PWD\app\tmux.conf"`. Ogni riga viene da una funzione di
`lib/tmux.js` (tra parentesi). Riempire la colonna «Esito» in `26-risultati.md`.

| Cosa | Comando | Atteso |
|---|---|---|
| nascita con dimensioni, cwd, env (`spawnArgs`, `sizeArgs`) | `& $b @L @f new-session -d -s ais-shell-prova -x 120 -y 30 -c C:\Users -e FOO=bar -- powershell.exe` | exit 0 |
| la variabile arriva al processo | attaccarsi, `echo $env:FOO` | `bar` |
| il PATH del client arriva al comando iniziale (vedi commento di `spawnArgs`) | lanciare il client con un PATH modificato, poi `echo $env:PATH` dentro | il PATH modificato |
| metadati (`metaArgs`) | `& $b @L @f set-option -t ais-shell-prova @ais_type shell` | exit 0 |
| elenco coi metadati (`listArgs`, `LIST_FORMAT`) | `& $b @L @f list-sessions -F '#{session_name}<\|>#{session_created}<\|>#{session_attached}<\|>#{@ais_type}'` | `ais-shell-prova<\|><epoch><\|>0<\|>shell` (`<\|>` è `FIELD_SEP`; l'app chiede tutte le `META_KEYS`) |
| esistenza col match esatto (`hasArgs`) | `& $b @L @f has-session -t '=ais-shell-prova'` / `-t '=ais-shell'` | exit 0 / exit ≠ 0 (il `=` impedisce il match per prefisso) |
| attacco (`attachArgs`) | `& $b @L @f attach-session -t '=ais-shell-prova'` | si vede la shell |
| riapplicare la config (`sourceArgs`) | `& $b @L @f source-file "$PWD\app\tmux.conf"` | exit 0, niente errori |
| stato dello scorrimento (`SCROLL_FORMAT`) | `& $b @L display-message -p -t '=ais-shell-prova:' '#{pane_in_mode}<\|>#{scroll_position}<\|>#{history_size}<\|>#{pane_height}<\|>#{alternate_on}'` | 5 campi valorizzati (produrre prima un po' di output: `1..300`) |
| scorrere, comandi concatenati con `;` (`scrollArgs`, `chain`) | `& $b @L copy-mode -e -t '=ais-shell-prova:' ';' send-keys -t '=ais-shell-prova:' -X -N 10 scroll-up ';' display-message -p -t '=ais-shell-prova:' '#{scroll_position}'` | `10` |
| salto (`scrollToArgs`) | `send-keys -X goto-line 50`, poi `send-keys -X cancel` | posizione 50, poi fuori dalla copy-mode |
| cattura con colori (`captureArgs`, piano 25) | `& $b @L capture-pane -p -e -S -2000 -t '=ais-shell-prova:'` | il testo, con le sequenze di colore |
| morte (`killArgs`) | `& $b @L kill-session -t '=ais-shell-prova'` | exit 0, sparisce da `list-sessions` |

Se un comando fallisce, provare la variante più vicina e annotarla: è
informazione utile per decidere se adattare `lib/tmux.js` (con una funzione
per piattaforma, non con `if` sparsi) o rinunciare a quella funzione su Windows.

## Q1 bis — I test d'integrazione veri contro psmux

`tests/integration.test.js` ha già 5 test su un tmux reale (ciclo di vita con
metadati e registro, mouse, alternate screen, scorrimento, scrollback). Oggi su
Windows si dichiarano saltati perché `detectTmux` restituisce `null`.

Per lo spike, **modifica locale da non committare** in `detectTmux`: su `win32`,
se c'è `process.env.AIS_TMUX_BIN`, usare quel binario invece di restituire
`null`. Poi:

```powershell
$env:AIS_TMUX_BIN = 'C:\percorso\psmux.exe'
node --test tests/integration.test.js
```

Annotare quali passano e, per quelli che falliscono, il messaggio di
asserzione (sono scritti apposta per dire *cosa* si è rotto).

## Q2, Q3, Q4 — L'app vera

Con la stessa modifica locale e `AIS_TMUX_BIN` impostata, `npm start`:

- Nuova → Terminale e Nuova → Claude in una repo. Colori, box-drawing, resize
  della finestra, selezione col mouse e copia, rotella (deve scorrere la
  history di psmux, non mandare frecce alla shell).
- `Ctrl+B` **non** deve fare niente; nessuna barra di stato verde in basso.
- Chiudere PizzaManager. Da PowerShell: `& $b -L aisession list-sessions` →
  **le sessioni devono esserci ancora** (Q2). Qui, nell'app vera, si usa il
  socket dell'app: alla fine pulire con `kill-session`, non `kill-server`, se
  si usa psmux anche per altro.
- Riaprire PizzaManager: le schede si riagganciano, l'output è quello di prima.
- Aspettare 10–15 minuti con l'app chiusa e ricontrollare (lo spike tmux del
  piano 5 ha trovato morti di sessione che dipendevano dall'ambiente, non da tmux).

## Q6 — Riavvio

Con due sessioni aperte (una Claude con conversazione già avviata, una shell):
riavviare Windows, riaprire l'app → deve comparire il modal «Ripristinare le
sessioni di prima?» e Claude deve ripartire con `--resume`.

## Consegna

`docs/plans/26-risultati.md`, sul modello di `05-risultati.md`:

- ambiente: versione di Windows, psmux (e da quale repo), Node, Electron;
- **verdetto** in testa: sì / sì con rinunce / no;
- una sezione per domanda, con i comandi e l'output che lo dimostrano;
- la tabella di Q1 compilata.

Poi riga 26 nella tabella di `README.md`. Il codice dello spike resta sul
branch e non va su `main`.

## Cosa viene dopo, a seconda del verdetto

- **Sì** → piano 27 `feat/psmux-backend`: `detectTmux` su `win32` accetta un
  binario solo se `-V` lo identifica come psmux (Q5), `confPath` con percorso
  Windows, casi in `tests/windows.test.js` con `platform: 'win32'`, i test
  d'integrazione girano con psmux se installato e si dichiarano saltati se no.
  psmux resta un **prerequisito opzionale** come tmux su Mac: senza, l'app
  funziona come oggi. Il server psmux gira dalla cartella di psmux, non dalla
  nostra: non blocca i file dell'aggiornamento automatico (piano 18).
- **Sì con rinunce** (es. niente scorrimento) → come sopra, con le funzioni
  mancanti spente su Windows in `lib/tmux.js`, in una funzione sola.
- **No** → su Windows resta il percorso B del piano 25 (ripristino dal
  registro + `--resume` + scrollback con `@xterm/addon-serialize`; il piano è
  sul branch `feat/scrollback-shell`). L'alternativa pesante — un nostro
  demone che tiene i ConPTY, come wmux/minimux — va valutata a parte: è
  riscrivere un pezzo di tmux, e su Windows il demone terrebbe bloccati i file
  dell'app durante gli aggiornamenti.

## Fuori scope

- Installare psmux al posto dell'utente o impacchettarlo con l'app.
- WSL (escluso già dal piano 12).
- Qualunque modifica a `main` oltre a questo piano e ai risultati.
