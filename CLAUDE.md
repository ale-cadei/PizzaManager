# PizzaManager — convenzioni per chi tocca il codice

App Electron che gestisce sessioni di terminale in schede: shell, `opencode`,
`claude`, `codex`. Ogni sessione è un PTY reale (`node-pty` + `xterm.js`).
Piano di lavoro e stato in `docs/plans/README.md`.

## Struttura

```
main.js        SOLO cablaggio: registra gli handler IPC, crea gli store, avvia l'app.
               Niente logica qui dentro (un test lo verifica).
lib/           Logica pura. NESSUN require('electron'): è ciò che rende i moduli
               importabili da Node e quindi verificabili. Un test lo verifica.
app/           Ciò che dipende da Electron per natura e non ha senso testare in
               isolamento: finestra (window.js), menu (menu.js), ciclo di vita
               dei pty (pty.js), config tmux distribuita (tmux.conf).
renderer/      UI: HTML, CSS, JS della finestra. Gira sandboxed, parla col main
               solo tramite preload.js. Moduli UMD puri (sidebar.js, attention.js…)
               e, caricati dopo, gli script dell'app divisi per area
               (app-state.js … renderer.js): condividono lo scope globale,
               quindi l'ordine in index.html conta (tests/renderer-load.test.js).
tests/         Runner di Node (`npm run test:unit`, `npm run test:coverage`).
docs/plans/    Un piano per branch, autosufficienti.
```

**Dove va un pezzo di codice nuovo:**
- calcola, valida, trasforma, legge/scrive file → `lib/`
- usa `BrowserWindow`, `Menu`, `clipboard`, `dialog`, `node-pty` → `app/`
- serve solo a collegare un handler IPC a una funzione → `main.js`

Se un modulo in `lib/` ha bisogno di una directory (es. `app.getPath('userData')`),
la riceve come parametro dalla factory (`createXStore({ dir })`): `main.js` passa
quella di Electron, i test una tmpdir. Modelli: `lib/accounts.js`, `lib/history.js`,
`lib/profiles.js`.

## Test

- I test importano il codice vero. Mai ricopiare una funzione nel test per
  poterla provare: se non è importabile, va spostata in `lib/`.
- Preferire verifiche di comportamento (chiama la funzione, guarda il risultato)
  a verifiche sul testo del sorgente (`src.includes('...')`). Le seconde si
  rompono a ogni rinomina e non catturano bug.
- Le fixture stanno in `tests/fixtures/`. I test che dipendono dai tool
  installati stanno in `tests/integration.test.js` e si dichiarano saltati
  (`t.skip`) quando il tool manca — non fingono di passare.
- Prima di aprire una PR: `npm run test:unit` verde e uno smoke test dell'app.

## Sessioni dentro tmux

Con `tmux` installato ogni sessione vive nel server tmux dell'app (socket
`aisession`, config `app/tmux.conf`) e sopravvive alla chiusura dell'app; il
pty è solo un client. Regole:
- **Ogni comando tmux passa da `-L aisession`.** Senza socket colpiresti le
  sessioni personali dell'utente (e un `kill-server` le distruggerebbe).
- I metadati delle sessioni stanno in tmux (`@ais_*`): non creare registri
  paralleli.
- L'ambiente per il processo va passato con `new-session -e`: il server tmux
  cattura l'ambiente alla sua nascita e le sessioni dopo erediterebbero quello.
- Nei test usa un socket di prova (`socket: 'aistest-…'`), mai `aisession`.
- `live-sessions.json` è lo specchio di tmux per sopravvivere ai riavvii: si
  aggiorna passando da `app/pty.js` (che chiama `syncSnapshot()`), mai a mano.
- **Un file che un processo esterno deve leggere** (`app/tmux.conf` per tmux)
  nell'app impacchettata sta dentro `app.asar`, che solo Electron sa aprire.
  Va elencato in `build.asarUnpack` e il percorso passato con
  `externalPath()` (`lib/tmux.js`). È successo: barra di stato verde e Ctrl+B
  attivo nel `.deb`, perché tmux non leggeva la config.
- tmux legge `-f` solo alla nascita del server: `create()` fa `source-file`
  ogni volta, così un server avviato a mano si rimette in riga.

## Sicurezza (programma locale, ma ci teniamo)

- **CSP** in `renderer/index.html`. Se aggiungi uno script inline, un `onclick=`
  nell'HTML o una risorsa da un dominio nuovo, la CSP lo blocca e la console del
  renderer dice perché. Aggiorna la policy lì, non aggirarla. `script-src` non
  deve MAI ammettere `'unsafe-inline'`.
- Dati che arrivano da fuori (file, output di CLI, input utente) vanno nella
  pagina con `textContent` o passando da `escapeHtml`. Mai `innerHTML` con
  interpolazione non escapata.
- File che possono contenere segreti (`claude-accounts.json`,
  `command-profiles.json`) si scrivono con `mode: 0o600` **e** `chmodSync` dopo:
  `writeFileSync` applica il mode solo alla creazione.
- Le API key non lasciano il main process: alla UI vanno solo id e nomi.
- I comandi dei profili vanno in `pty.spawn` **senza shell**: niente pipe,
  redirezioni, alias. La validazione li rifiuta apposta, non li esegue diversamente.

## Windows

L'app gira anche su Windows (`docs/plans/12-windows.md`), senza tmux. Regole:
- **Niente `split('/')`, `startsWith('/')`, `':'` per il PATH.** Separatori
  `[\\/]`, `path.delimiter`, e `path.win32` quando si costruiscono percorsi
  Windows su una macchina Unix (i test). Le sonde sul filesystem usano il
  `path` della macchina.
- Le funzioni di `lib/` prendono `platform` come parametro (default
  `process.platform`): i casi Windows si verificano da Unix con
  `platform: 'win32'` in `tests/windows.test.js`, mai con `if (os.platform())`
  nel test.
- Un binario `.cmd`/`.bat` non si lancia direttamente: `buildCommand` lo
  avvolge in `cmd.exe /d /s /c` e produce `commandLine` per node-pty
  (`lib/win-command.js`, regole di cross-spawn). Non ricomporre la riga altrove.

## Dati dell'utente

- La cartella dei dati è **fissa** (`app.setPath('userData', …/AISessionManager)`
  in `main.js`) e non segue `productName`. Rinominare l'app senza questo
  sposterebbe i dati in una cartella nuova e vuota: profili, cronologia e
  account "spariti". È successo col rebrand.
- Gli store (`lib/accounts.js`, `history.js`, `profiles.js`, `live-sessions.js`)
  ricevono la cartella come parametro: mai chiamare `app.getPath` dentro `lib/`.

## Processo

- **Un branch di refactor si merge il giorno stesso.** Se aspetta, diverge da
  `main` e ricomporlo costa quanto rifarlo (è successo: PR #5).
- Refactor e correzioni di comportamento in **commit separati**, anche nello
  stesso branch: se qualcosa si rompe si capisce se è lo spostamento o la modifica.
- Un branch fa quello che dice il suo piano in `docs/plans/`. Quello che emerge
  strada facendo si annota nel piano giusto, non si infila nel branch corrente.
- Messaggi di commit: `<tipo>: <cosa>` e poi il *perché* nel corpo.
  Tipi: feat, fix, refactor, docs, test, chore.
