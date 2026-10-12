# 56 — `feat/scarta-file`: scartare le modifiche non staged di un file

Chiesto dall'utente il 2026-10-09, dopo la «Review attiva» (44, 53–55). In «Da
committare» (piano 53) si mette e si toglie dallo stage, ma per buttare via
quello che l'agente ha scritto in un file serve il terminale.

## Cosa

Sulle righe **non staged** di «Da committare», accanto a ＋, un pulsante ↶
«Scarta»:

```
Non staged
 M lib/a.js       +3 −1    [↶] [＋]
 ? nuovo.txt      +12      [↶] [＋]
```

- **Solo il non staged.** Il file torna com'è nello stage (l'indice): quello
  già staged resta. Sulle righe staged niente ↶.
- File tracciato modificato o cancellato → `git restore --worktree -- <file>`.
  File non tracciato → si cancella dal disco.
- **Conferma** nel footer del pannello, come Unisci: «Scartare le modifiche
  non staged a `lib/a.js`? Da git non si recuperano.» (per un non tracciato:
  «Cancellare `nuovo.txt`? Non è in git.»). Annulla / Scarta.
- **Annulla dopo.** Prima di scartare l'app salva il contenuto in git
  (`git hash-object -w`: un oggetto non referenziato, che git tiene finché
  un `gc` non lo pota, settimane). Dopo lo scarto il footer dice «Scartate le
  modifiche a `lib/a.js` · Annulla». Annulla rimette il contenuto e i
  permessi di prima, **solo se il file è ancora com'era subito dopo lo
  scarto**: se nel frattempo l'agente l'ha toccato, rifiuta e dice perché.
  Vale l'ultimo scarto, finché il pannello resta aperto sullo stesso target.
- Niente «scarta tutto»: un file alla volta, si vede cosa si butta (il diff è
  lì sopra).

## Quando no

- percorso non valido o non più fra le modifiche non staged (stesso
  controllo di `stagePaths`, piano 53: `pathsInSide(..., 'unstaged', ...)`);
- merge o rebase a metà (`BUSY`, come il commit);
- un non tracciato che non è un file regolare (symlink, cartella): si
  rifiuta, da terminale;
- un file tracciato che è un symlink: si scarta, ma senza Annulla (il
  contenuto salvato sarebbe il bersaglio, non il link).
- scheda non git o pannello in sola lettura (diff di un branch, piano 54):
  nessun ↶, come per ＋.

## Annulla, nel dettaglio

Lo scarto restituisce un **gettone** `{ path, blob, mode, after }`:
- `blob`: sha del contenuto salvato (null se il file era cancellato: allora
  Annulla lo ricancella);
- `mode`: i permessi del file prima (eseguibile o no);
- `after`: com'è il file subito dopo lo scarto — lo sha del contenuto
  nell'indice per un tracciato, `null` (assente) per un non tracciato
  cancellato.

`undoDiscard({ cwd, token })` nel main ricontrolla tutto: `blob` è uno sha
esadecimale ed esiste come blob, `path` è relativo e sicuro
(`isSafeRelative`), lo stato attuale del file (`git hash-object` senza `-w`,
o assente) è uguale ad `after`. Poi scrive il file da `git cat-file blob`
con `mode` (e `chmodSync`, perché il mode di `writeFileSync` vale solo alla
creazione). Il gettone vive nel renderer; il main non si fida e rifà i
controlli: al massimo un renderer bugiardo scrive in un file del repository
un blob che è già nel repository.

## Sicurezza

- Solo argv, `--literal-pathspecs` e `--` prima dei percorsi (come 53).
- La cancellazione di un non tracciato passa da `fs.rmSync` su
  `path.join(root, p)` dopo `isSafeRelative` e il controllo che sia un file
  regolare (`lstat`): mai fuori dal repository, mai una cartella.
- Nessun `git checkout -f`, `reset --hard`, `clean`.

## Dove

- `lib/git-discard.js` (nuovo): `discardPaths({ cwd, path })` e
  `undoDiscard({ cwd, token })`. `run` ed `exists`/`fs` iniettabili.
  Riusa `withRepo`/`writeError`/`BUSY` (`lib/git-commit.js`) e
  `pathsInSide` (da esportare: commit di refactor separato).
- `app/git.js`, `preload.js`: canali `git-discard`, `git-discard-undo`.
- `renderer/changes-view.js`: ↶ in `stageButton` per le righe non staged.
- `renderer/changes-model.js`: testi di conferma e del footer.
- `renderer/changes-panel.js`: conferma, gettone dell'ultimo scarto,
  Annulla; il gettone si butta cambiando target o chiudendo il pannello.
- `renderer/styles.css`.

## Fuori

- Scartare lo staged, o riportare a HEAD.
- Scartare un singolo hunk o una riga.
- Scarta tutto.

## Verifica

- `npm run test:unit`: `lib/git-discard.js` con `run` finto (argv, percorso
  non più non staged, busy, non tracciato regolare / symlink, gettone) e
  col git vero in `tests/integration.test.js` (modificato, cancellato, non
  tracciato, parzialmente staged: lo staged resta; Annulla rimette il
  contenuto e il bit eseguibile; Annulla rifiutato se il file è cambiato
  dopo); ↶ e conferma col DOM finto.
- Smoke nell'app: scarta, Annulla, scarta un non tracciato, Annulla
  rifiutato dopo una modifica.
