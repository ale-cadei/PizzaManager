# Branch 4 — `fix/robustness`

**Dipende da**: branch 2. **Parallelo a**: branch 3. **Taglia**: ~4h. **Rischio**: basso.

---

## Contesto

Raccolta di sei difetti indipendenti emersi dall'analisi del 2026-09-09. Nessuno
è grave da solo; insieme sono la differenza fra un'app che quando qualcosa va
storto lo dice e una che resta muta.

Sono indipendenti fra loro: un commit ciascuno, in qualsiasi ordine.

---

### 1. `getLoginPathSync` blocca il main process

`main.js:30`. Per trovare `opencode` e `claude` anche quando l'app è lanciata
dalla GUI (dove il `PATH` è minimo), l'app chiede il PATH a una shell di login:

```js
const out = execFileSync(sh, ['-lc', 'echo $__AIS_LOGIN_PATH__; echo $PATH'], { timeout: 5000, ... });
```

`execFileSync` è **sincrono**: blocca il main process, cioè congela la finestra.
Viene chiamata mentre la UI aspetta `get-defaults`, quindi il blocco cade
esattamente all'avvio. Con una `.zshrc` che carica nvm, pyenv o rbenv sono
secondi veri di app morta — e sono i secondi in cui l'utente si fa un'idea
dell'app.

Va resa asincrona. **Attenzione alla cache**: oggi memorizza il valore
(`loginPathCache`). Passando ad async va memoizzata la **promise**, altrimenti
due chiamate concorrenti all'avvio lanciano due `zsh -lc` in parallelo.

Nota minore, gratis già che ci si è: `echo $__AIS_LOGIN_PATH__` non serve a
niente — si legge solo l'ultima riga dell'output.

### 2. L'output di `opencode` non è validato

`main.js:452`:

```js
const arr = JSON.parse(stdout);
resolve({ ok: true, sessions: arr, binary: r.path });
```

Il risultato va dritto alla UI, che assume `id`, `title`, `directory`, `created`.
È output di un processo esterno di cui non si controlla la versione: un system
boundary da manuale. Serve uno schema minimo, e un messaggio esplicito quando
non torna — così l'utente legge «opencode ha restituito un formato inatteso»
invece di trovarsi una lista vuota senza spiegazione.

### 3. Il parser JSONL di Claude fallisce in silenzio

`main.js`, handler `list-claude-sessions`. La scansione di
`~/.claude/projects/**/*.jsonl` è piena di `catch {}` vuoti: un file illeggibile,
un JSON malformato o uno schema cambiato producono semplicemente una sessione in
meno, senza che nessuno lo sappia.

È reverse-engineering di un formato interno non documentato, quindi **è giusto
non crashare** — ma il degrado va dichiarato: contare gli scarti e dirlo
(«3 sessioni non leggibili»), invece di sparire.

### 4. `await` mancante in `openNewModal`

`renderer/renderer.js:127`:

```js
function openNewModal(type) {
  ...
  updateClaudeAccountRow();   // è async, non attesa
  $('#modal-new').hidden = false;
}
```

Il modal si apre prima che la riga «Account Claude» sia popolata. Oggi non si
nota perché con il solo OAuth quella riga resta nascosta; si noterà appena si
aggiunge un profilo a chiave.

Da notare che ora `openNewModal` è raggiungibile anche da `File > Nuova sessione`
(⌘N) oltre che dal bottone.

### 5. ✅ Data non validata nel resume (fatto dal collega)

`renderer/renderer.js:299`:

```js
const date = new Date(s.created).toLocaleString();
```

Se `opencode` rinomina il campo, in lista compare `Invalid Date`. Va gestito con
un fallback leggibile.

### 6. ✅ Mutazioni in place (fatto nel branch 2; i push/sort residui sono su accumulatori locali)

`main.js:183` (`h.unshift(...)`) e `main.js:409` (`acc.push(...)`) modificano
array esistenti. Vanno riscritte come `[nuovo, ...vecchi]` e `[...acc, nuovo]`,
in linea con lo standard di progetto.

### 6-bis. Tokenizer dei profili: due divergenze dalla shell (rilevate il 2026-09-15)

Il commento in testa a `lib/command-profiles.js` promette «come in una shell»,
ma due casi divergono:

- **Backslash dentro doppi apici** scappa *qualunque* carattere:
  `"C:\Users\x"` → `C:Usersx`. In una shell POSIX dentro le virgolette doppie
  il backslash scappa solo `$`, `` ` ``, `"`, `\`. Colpisce i percorsi Windows,
  e `defaultProfiles` ha un ramo `win32`.
- **`$VAR` si espande nei valori d'ambiente ma non negli argomenti**:
  `claude --model $MODEL` passa il letterale `$MODEL`. Chi arriva da un alias
  di shell se lo aspetta espanso. Coerentemente con la filosofia del modulo —
  rifiutare ciò che non funzionerà — andrebbe o espanso, o rifiutato con un
  messaggio come per gli operatori. Oggi non fa né l'uno né l'altro.

### 6-ter. ✅ Menubar in-app: copia/incolla nei terminali (fatto il 2026-09-16)

Il menu nativo mandava `menu-edit` al renderer (selezione di xterm); la menubar
in-app — quella visibile su Linux/Windows — chiamava ancora `wc.copy()` nativo,
che nei terminali non vede niente. Allineate. Il test di cablaggio copre entrambe.

### 7. URL segnaposto del repository (in due punti)

Dopo il branch 2 l'indirizzo è in **un solo punto**: la costante `REPO_URL` in
`app/menu.js`, usata sia dal menu nativo che dalla menubar in-app. Resta
l'indirizzo sbagliato.

`main.js:253`:

```js
{ label: 'Repository AISessionManager', click: async () => { await electronShell.openExternal('https://github.com/aisessionmanager/aisessionmanager'); } },
```

Quel repository non esiste: quello vero è `github.com/ale-cadei/AISessionManager`.
Entrambe le voci portano l'utente su una 404.

> Nota: qui `openExternal` è usato correttamente — URL letterale fisso, nessun
> input dell'utente. Non va rimosso, va solo corretto l'indirizzo. (Al branch 1
> era stato tolto un `open-external` diverso, che accettava un URL arbitrario
> via IPC.)

---

## Verifica

```bash
npm run test:unit
npm start
```

Per il punto 1, la prova che conta è a occhio: l'app deve mostrare la finestra
**subito**, senza la pausa iniziale. Se serve un riscontro oggettivo, misurare il
tempo fra l'avvio e la comparsa della sidebar popolata prima e dopo la modifica.

## Criteri di uscita

- Nessuna chiamata sincrona a una shell nel percorso di avvio.
- Un test che verifica che due richieste concorrenti del login PATH producano
  **una sola** invocazione della shell.
- L'output malformato di `opencode` produce un messaggio leggibile, non una
  lista vuota: verificabile con un test che passa un JSON valido ma con i campi
  sbagliati.
- I file JSONL illeggibili vengono contati e segnalati.
- Nessuna mutazione in place nei due punti indicati.
- La voce di menu Help apre il repository giusto.

## Rollback

Nessun dato dell'utente viene toccato: `git checkout main` e non resta traccia.
I commit sono indipendenti, quindi si può fare `revert` del singolo punto.

## Fuori scope

Scorciatoie da tastiera per le schede (⌘T / ⌘W), `Esc` per chiudere i modal,
icona `.icns` per macOS, `npm run dist` che punta a Linux anche su Mac. Sono
migliorie reali ma non difetti di robustezza: meritano un branch `feat/ux` a
parte, da fare quando capita.
