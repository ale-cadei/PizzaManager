# 43 — `feat/modifiche-staged`: «Da committare», staged e non staged

## Cosa

Nel pannello delle modifiche (piano 32, linguetta in alto a destra) il
selettore ha due modi: «Dall'ultimo commit» e «Ultimo giro». Nessuno dei due
dice cosa è già nell'indice (`git add`) e cosa no: prima di committare, o
prima di chiedere all'agente di farlo, è la domanda che conta.

Terzo modo, **«Da committare»**: lo stato del non committato in due sezioni.

```
┌─ Modifiche · da committare ──────────────┐
│ 2 staged · 3 non staged · +40 −12    [×] │
│ [Dall'ultimo commit|Ultimo giro|Da committare]
│ STAGED · 2                               │
│ ▸ M lib/a.js                  +10 −2     │
│ ▸ A lib/b.js                  +20        │
│ NON STAGED · 3                           │
│ ▸ M lib/a.js                  +3  −1     │  ← parzialmente staged: in tutte e due
│ ▸ D vecchio.txt                   −9     │
│ ▸ ? appunti.md                +7         │
└──────────────────────────────────────────┘
```

- **Staged** = `git diff --cached` (indice contro HEAD; senza commit, tutto
  l'indice è nuovo).
- **Non staged** = `git diff` (cartella contro indice) più i file non
  tracciati (`ls-files --others --exclude-standard`), letti dal disco come in
  «Dall'ultimo commit».
- Un file parzialmente staged compare in tutte e due, ciascuna col suo diff.
- Vale per qualsiasi sessione in un repository, worktree compresi (l'indice
  del worktree contro il suo HEAD): non c'è base, non c'è fotografia.
- Come «Ultimo giro», si legge solo a pannello aperto: la linguetta continua a
  parlare dall'ultimo commit, e i contatori dei worktree in sidebar non si
  toccano.
- In modalità «Unisci» il selettore non c'è (come oggi).

## Dove

- `lib/git-staging.js` (nuovo): `readStaging({ cwd })` e
  `readStagingDiff({ cwd, path, side })`. Riusa parsing e letture di
  `lib/git-changes.js` (esportati). Stesse garanzie: solo letture, il diff
  solo per un percorso che è nell'elenco attuale di quella sezione, `side`
  solo `staged` o `unstaged`, i non tracciati solo se file veri.
- `app/git.js`, `preload.js`: canali `git-staging` e `git-staging-diff`.
- `renderer/changes-model.js`: `targetFor(..., { staging })`, modo `staging`
  in `modeChoice`, titolo, riepilogo, messaggio vuoto; `itemId(f)`: con le
  sezioni lo stesso percorso compare due volte, i diff aperti si tengono per
  `side:path`.
- `renderer/changes-view.js`: terzo pulsante, intestazioni di sezione.
- `renderer/changes-panel.js`: sceglie il canale secondo il bersaglio.

## Fuori

- Fare stage/unstage dal pannello (pulsanti `+`/`−` per file o per blocco):
  sarebbe la prima scrittura del pannello, va pensata a parte (lock, conflitti
  con l'agente che lavora). Annotato in `idee.md` se serve.

## Verifica

- `npm run test:unit` verde: lib con `run` finto, modello, vista, IPC, e un
  caso con git vero in `tests/integration.test.js` (file parzialmente staged,
  rinominato in stage, cancellato non staged, non tracciato, repo senza commit).
- Smoke nell'app: aprire il pannello in un repo con un `git add -p` a metà.
