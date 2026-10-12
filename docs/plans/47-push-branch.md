# 47 — `feat/push-branch`: push di un branch dal selettore

Ultimo pezzo della «Review attiva» (`idee.md`), dopo i commenti sul diff (44),
il commit dal pannello (45) e il merge di un branch (46). Doveva essere «PR:
push e apertura»; deciso con l'utente il 2026-10-09: **ci si ferma al push**.
Le PR si aprono a mano su GitHub, o le apre l'agente (che ha già `gh` o il
browser). Niente token, niente `gh` nell'app.

## Cosa

Nel selettore dei branch della sessione git (piano 27), sulle righe dei
branch locali, un pulsante ⇡ «Push»:

```
┌─ Branch ──────────────────────────────────────────┐
│ Locali                                            │
│ main                              corrente   [⇡2] │
│ feat/login   ↔ origin/feat/login     [⇡1] [⤵] [🗑] │
│ feat/nuovo                        [⇡] [⤵] [🗑]     │
└───────────────────────────────────────────────────┘
```

- **Quando c'è**: il branch non ha upstream (si pubblica), oppure ha commit
  che l'upstream non ha (`ahead > 0`, da `%(upstream:track)`, senza fetch).
  Un branch allineato non ha il pulsante. Il numero dice quanti commit.
- **Senza upstream**: `git push -u <remoto> refs/heads/<b>:refs/heads/<b>`.
  Il remoto è `origin` se c'è, altrimenti l'unico remoto; con più remoti e
  nessun `origin` si rifiuta col motivo (si fa da terminale).
- **Con upstream**: `git push <remoto> refs/heads/<b>:<merge>` con remoto e
  ramo di `branch.<b>.remote` / `branch.<b>.merge`: esattamente l'upstream,
  qualunque sia `push.default`.
- **Mai forzato**. Se il remoto è più avanti git rifiuta: si mostra il suo
  messaggio e ci si ferma («fai pull o rebase dal terminale»).
- **Esito** nel selettore: «`feat/x` pushato su `origin/feat/x`» (con «nuovo
  upstream» se è stato creato); i branch si rileggono.
- Nessuna conferma: il push non tocca la cartella né la storia locale, e si
  vede cosa parte (numero di commit nel titolo del pulsante).

## Quando no

- nome non valido (`validateBranchName`) o branch locale che non esiste;
- upstream locale (`branch.<b>.remote = .`): non c'è niente da pubblicare;
- nessun remoto, o più remoti senza `origin`;
- nome di remoto che comincia con `-` (git lo leggerebbe come opzione).

## Credenziali

Quelle di git, come da terminale (chiave SSH in `ssh-agent`, credential
helper). L'app non chiede e non salva niente. `GIT_TERMINAL_PROMPT=0` c'è
già (lib/git-run.js): senza terminale git non resta appeso a chiedere una
password; un errore di autenticazione si riconosce e l'errore lo spiega
(«fai un push dal terminale una volta, o carica la chiave in ssh-agent»).
Tempo massimo 2 minuti (la rete è più lenta di un hook di commit), poi git
si interrompe e l'errore lo dice.

## Sicurezza

- Solo argv. Nome del branch validato; refspec sempre completo
  (`refs/heads/…`), così un nome non viene mai letto come altro.
- Niente `--force`, `--no-verify`, `--mirror`, `--all`, `--delete`: l'hook
  pre-push gira come da terminale.

## Dove

- `lib/git-branches.js`: `FORMAT` con `%(upstream:track)`; le righe locali
  hanno `ahead` e `behind` (`gone` se l'upstream non c'è più).
- `lib/git-push.js` (nuovo): `pushBranch({ cwd, name })`. `run` iniettabile.
- `app/git.js`, `preload.js`: canale `git-push`.
- `renderer/git-branch-picker.js`: pulsante ⇡ sulle righe locali,
  `onPush(name)`, esito nel selettore come il merge.
- `renderer/git-tab.js`: `onPush` chiama `gitPush` e rilegge la timeline.
- `renderer/styles.css`.

## Fuori

- Aprire la PR (a mano o dall'agente).
- Fetch, pull, rebase; push di branch remoti; scegliere il remoto da UI.
- Push forzato, cancellare branch remoti, tag.

## Verifica

- `npm run test:unit` verde: `lib/git-push.js` con `run` finto (argv con e
  senza upstream, scelta del remoto, nome con `-`, rifiutato dal remoto,
  autenticazione, tempo scaduto); `%(upstream:track)` in parseBranches; il
  pulsante nel selettore; git vero in `tests/integration.test.js` con un
  remoto bare (pubblica con upstream, push dopo un commit, rifiutato quando
  il remoto è più avanti, niente force).
- Smoke nell'app: repo con remoto bare, ⇡ su un branch nuovo → upstream
  creato; commit, ⇡1 → pushato; remoto più avanti → errore e niente push.
