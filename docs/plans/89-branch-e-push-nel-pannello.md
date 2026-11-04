# 89 — `feature/side-git-improvements`: branch, worktree e push nel pannello delle modifiche

Dipende da: 55 (push dal selettore dei branch). Taglia: ~2h.

## Perché

Il pannello «Modifiche» (linguetta laterale di git) permette di fare commit ma
non dice su che branch né in che worktree si trova la scheda, e per pushare
bisogna aprire il selettore dei branch o il terminale.

## Cosa fa

- Barra in cima al pannello: `⎇ branch`, `worktree nome` se è un worktree
  collegato, distanza dall'upstream (`⇡2 ⇣1 origin/x`, `= origin/x`,
  `nessun upstream`, `origin/x sparito`). HEAD staccato mostra l'hash corto.
- Pulsante **Push ⇡N** (o **Pubblica** senza upstream, `git push -u`). Spento,
  con il motivo nel titolo, se: HEAD staccato, nessun commit, niente da pushare,
  upstream sparito, push o altra scrittura del pannello in corso. Se il remoto
  è più avanti il titolo avvisa che git rifiuterà.
- Esito del push sotto la barra (errore in rosso). Mai forzato.
- La barra si legge ogni 3 s solo a pannello aperto; nascosta in modalità «Unisci».

## Come

- `lib/git-head.js`: `readHead({cwd})`, solo argv via `runGit`
  (`symbolic-ref`, `rev-parse`, `for-each-ref` con `upstream:track`).
  Worktree collegato = `--git-dir` ≠ `--git-common-dir`.
- `app/git.js` canale `git-head`; `preload.js` `gitHead(cwd)`.
- `renderer/changes-head.js` (UMD): `headBar` puro, `createHeadBar` disegna
  con textContent. Montata da `changes-view.js`, dati e push da `changes-panel.js`
  (riusa `gitPush` del piano 55).

## Fuori

Pull, fetch, force push, scelta del remoto.

## Verifica

- `tests/git-head.test.js`, `tests/changes-head.test.js`.
- `tests/integration.test.js`: con git vero e remoto bare — nessun commit,
  ahead dopo `push -u`, worktree collegato, HEAD staccato.
- Smoke (profilo di prova): la barra mostra branch, worktree, «nessun upstream»
  e «Pubblica».
