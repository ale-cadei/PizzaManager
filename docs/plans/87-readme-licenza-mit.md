# 87 — `docs/readme-licenza-mit`: licenza MIT e README allineati alla 2.0.0

Taglia: ~2h. Fatto il 2026-11-03, dopo l'uscita della 2.0.0.

## Perché

- **La licenza contraddiceva il repository.** `LICENSE` era proprietaria
  («You may not modify… or attempt to derive its source code»), ma il
  repository è pubblico e il README invitava a clonarlo e modificarlo.
  Giacomo e Ale hanno scelto la **MIT**.
- **`README.en.md` era fermo a prima di Windows**: «there is no package yet»,
  niente riga Windows fra i download, niente psmux.
- **Nessuno dei due README parlava della 2.0.0** (editor, notebook, conflitti
  git, schermo diviso), e i due si erano separati: quello inglese aveva git e
  worktree, il pannello modifiche e gli aggiornamenti, quello italiano no.
- **«Una sola richiesta di rete, i font» era falso**: l'app controlla gli
  aggiornamenti, chiede la quota di Claude ad Anthropic e legge l'elenco delle
  segnalazioni. E i font sono IBM Plex Sans, non Inter.
- **`THIRD-PARTY-NOTICES.md` mancava di due componenti**:
  `@xterm/addon-unicode11` (caricato dal terminale) e `marked` (dentro il
  bundle di Monaco, come `dompurify`).

## Cosa cambia

1. `LICENSE` → testo MIT, copyright Giacomo Grieco e Alessandro Cadei, più il
   rimando a `THIRD-PARTY-NOTICES.md` e ai loghi dei prodotti di terzi.
   `package.json`: `"license": "MIT"`.
2. `README.md` e `README.en.md` con la **stessa struttura** (installazione,
   aggiornamenti, sorgente, cosa fa, guida rapida, configurazione e rete,
   Windows, problemi, segnalazioni, sviluppo, licenza), le funzioni della 2.0.0,
   la rete descritta per intero, i test a ~25 s (misurati, non ~2 s), e nella
   licenza i ringraziamenti a xterm.js, node-pty, Monaco, Electron, tmux e
   psmux.
3. `THIRD-PARTY-NOTICES.md`: le due voci mancanti, con i testi di licenza, e
   la data di generazione.

## Annotato strada facendo, fuori da questo branch

- `package.json` ha come autore `PizzaManager <support@example.com>`, un
  segnaposto che finisce nei metadati dei pacchetti. Non si toglie e basta:
  electron-builder vuole un'email dell'autore per costruire il `.deb`. Serve
  un indirizzo vero da mettere al suo posto.
- `docs/rilasci/v1.2.1.md` dice ancora «software proprietario»: sono le note
  di una versione passata, e restano com'erano.
- Gli avvisi di terze parti si aggiornano a mano: un test che confronti la
  tabella con `npm ls --omit=dev` avrebbe preso le due voci mancanti.
