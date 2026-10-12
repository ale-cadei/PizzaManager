# 53 — `feat/commit-pannello`: stage, unstage e commit dal pannello

Secondo pezzo della «Review attiva» (`idee.md`), dopo i commenti sul diff
(44). Poi merge di un branch qualsiasi (54) e PR (55).

## Cosa

Il modo «Da committare» (piano 43) mostra staged e non staged, ma solo in
lettura: per committare si va in una shell o si chiede all'agente. Qui il
pannello diventa la prima scrittura: si sposta un file fra le due sezioni e si
committa lo staged.

```
┌─ Modifiche · da committare ──────────────┐
│ 2 staged · 3 non staged · +40 −12    [×] │
│ STAGED · 2                  [Togli tutti]│
│ ▸ M lib/a.js          +10 −2          −  │
│ ▸ A lib/b.js          +20             −  │
│ NON STAGED · 3            [Aggiungi tutti]│
│ ▸ M lib/a.js          +3  −1          ＋ │
│ ▸ ? appunti.md        +7              ＋ │
│ ┌ Messaggio del commit ───────────────┐  │
│ │ fix: controllo su null in a.js      │  │
│ └─────────────────────────────────────┘  │
│ Ctrl+Invio committa     [Committa 2 file]│
└──────────────────────────────────────────┘
```

- **Per file**: `＋` sulle righe non staged (`git add -- <path>`, anche per un
  file cancellato o non tracciato), `−` sulle staged (`git restore --staged --
  <path>`; in un repository senza commit `git rm --cached -q -- <path>`). Di un
  rinominato si passano tutti e due i nomi. Niente blocchi: per quelli c'è
  `git add -p`.
- **Tutti**: «Aggiungi tutti» (`git add -A`) e «Togli tutti» (`git reset -q`,
  senza commit `git rm --cached -r -q .`) nelle intestazioni di sezione.
- **Commit**: casella del messaggio e «Committa N file» in fondo, solo nel modo
  «Da committare». `git commit -m <messaggio>`: niente `-a`, va solo lo staged.
  Hook e firma come configurati nel repository, come da terminale: se un hook
  fallisce si mostra il suo output. Tempo massimo 60 s, poi errore. Ctrl+Invio
  nella casella committa.
- **Dopo**: messaggio svuotato, pannello riletto, una riga «Commit `abc1234` su
  `main`». Il messaggio a metà resta se il commit fallisce.
- **Quando no** (pulsanti spenti, il motivo accanto):
  - la scheda sta lavorando (`t.running`, renderer/signals.js), o un'altra
    scheda la cui cartella sta dentro la radice dello stesso repository:
    committerebbe file a metà, e si scontrerebbe con l'agente
    sull'`index.lock`;
  - niente di staged, o messaggio vuoto (solo per Committa);
  - merge o rebase a metà nel repository: un commit lì chiuderebbe il merge,
    non è quello che ci si aspetta da questo pulsante;
  - una scrittura già in corso dal pannello (una alla volta);
  - modalità «Unisci»: il selettore non c'è, come oggi.
- **`index.lock`**: se git lo trova (un altro git sta scrivendo) si dice così,
  con «riprova fra poco», non col messaggio grezzo.
- Vale per qualsiasi scheda in un repository, shell comprese: è il modo «Da
  committare», non una cosa da agente.

## Sicurezza

- Sempre `execFile` con argv (`lib/git-run.js`), mai la shell. I percorsi dopo
  `--`, e solo se compaiono **adesso** nella sezione giusta (si rilegge lo
  stato prima di scrivere, come fa il diff del piano 43) e passano
  `isSafeRelative`. Un percorso che non c'è è un errore, non un `git add`.
- Il messaggio va in argv con `-m`: niente shell, niente interpolazione.
  Vuoto (dopo `trim`) rifiutato; al massimo 10 000 caratteri; via i caratteri
  di controllo tranne a capo e tab (`sanitize` di review-notes.js, ma lato
  `lib/`).
- Nessun `--no-verify`, nessun `-c` che spenga hook o firma.

## Dove

- `lib/git-commit.js` (nuovo): `stagePaths`, `unstagePaths`, `stageAll`,
  `unstageAll`, `commitStaged({ cwd, message })`. Controlli comuni (repository,
  merge/rebase a metà, percorsi presenti nella sezione). `run` iniettabile.
- `lib/git-run.js`: opzione `timeout` (il commit con gli hook; le letture no);
  all'errore si attacca anche `stdout`, dove molti hook scrivono.
- `lib/git-staging.js`: `readStaging` dice anche `busy` (`'merge'|'rebase'|null`),
  così il pannello spegne i pulsanti prima che git rifiuti.
- `app/git.js`, `preload.js`: canali `git-stage`, `git-unstage`, `git-commit`.
- `renderer/changes-model.js`: `commitChoice(tab, tabs, result, state)` —
  cosa si può fare e perché no (puro, testato).
- `renderer/changes-view.js`: `＋`/`−` sulle righe, pulsanti di sezione,
  casella e pulsante di commit, riga dell'esito.
- `renderer/changes-panel.js`: chiama i canali, una scrittura alla volta,
  rilegge dopo; ridisegna quando una scheda parte o si ferma (signals.js).
- `renderer/styles.css`.

## Fuori

- Stage per blocco o per riga, `--amend`, scegliere l'autore, push: il push
  sta nel piano 55 (PR).
- Scartare modifiche (`git restore`): distruttivo, va pensato a parte.
- Generare il messaggio con l'agente.

## Verifica

- `npm run test:unit` verde: `lib/git-commit.js` con `run` finto (argv
  esatti, percorso assente rifiutato, merge a metà, repo senza commit,
  index.lock, messaggio vuoto/lungo/con ESC), modello (`commitChoice` per ogni
  motivo), vista (pulsanti, casella, Ctrl+Invio, nessun `innerHTML`), e git
  vero in `tests/integration.test.js` (add, reset, commit, hook che fallisce).
- Smoke nell'app: repo di prova con un file modificato e uno nuovo, `＋` su
  uno, messaggio, Committa → riga dell'esito, `git log` lo mostra; con
  l'agente finto che scrive, pulsanti spenti col motivo.
