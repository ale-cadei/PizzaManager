# 58 — `feat/resume-worktree`: ⟲ sulla riga del worktree

Dipende da: 36 (sessioni nei worktree), 8 (Resume per progetto). Taglia ~2h.

## Perché

Chiudere la card di una sessione in un worktree (✕) lascia in piedi il
worktree, e la conversazione si può riprendere: il Resume la elenca e la
riapre nella sua cartella (piano 36, punto 7). Ma per trovarla bisogna aprire
il Resume generale, o il ⟲ del progetto, e cercarla fra tutte le chat del
progetto: il filtro lavora sulla radice, e un worktree appartiene al suo
progetto. Le chat del worktree si riconoscono solo dal percorso piccolo.

La strada che viene in mente, `claude --resume` dalla cartella principale,
è quella sbagliata finché il worktree esiste: Claude ritrova la chat ma lavora
sui file di `main`.

## Cosa

Un ⟲ sulla riga del worktree, fra `+` e `⋯`:

```
⑂ feat/scorciatoie   da main   +120 −30   [+] [⟲] [⋯]
```

Apre il Resume con le sole conversazioni nate dentro quella cartella (o in una
sua sottocartella), che si riaprono lì come già succede. Non va nel `⋯`: quel
menu raccoglie le azioni che chiudono il worktree (Unisci, Tieni, Butta).

## Come

- `renderer/resume-projects.js`: `arrange` accetta `filterDir`, che tiene le
  voci la cui cartella è `filterDir` o sta sotto (`isInside`, stesse regole di
  `pathKey` per Windows). Si somma a `filterRoot`, non lo sostituisce.
- `renderer/resume.js`: `openResumeModal({ dir })` accanto a `projectRoot`;
  stato in `resumeDirFilter` (`app-state.js`). L'etichetta «Solo …» mostra la
  cartella; la ✕ dell'etichetta toglie l'uno e l'altro filtro. Il
  raggruppamento per progetto resta spento: sarebbe un gruppo solo.
- Linguetta: il Resume si apre su quella dell'ultima sessione aperta nel
  worktree (`recentTypeIn` sulla cronologia dell'app, riletta a ogni ⟲).
  Senza cronologia, o se non si legge, resta quella di prima.
- `renderer/worktree-section.js`: `onResume` → bottone `worktree-resume`.
- `renderer/sidebar.js`: `onResumeInWorktree(path, projectRoot)`.
- `renderer/session-list.js`: lo collega a `openResumeModal({ dir: path })`.

## Test

- `tests/resume-projects.test.js`: `filterDir` tiene cartella e sottocartelle,
  scarta i vicini (`feat-x` contro `feat-x2`) e confronta i percorsi Windows.
- `tests/resume-modal-projects.test.js`: aperto con `dir` mostra «Solo <dir>»,
  solo le chat del worktree, raggruppamento spento; l'apertura generale azzera.
- `tests/sidebar-worktree.test.js`: ⟲ chiama il callback con worktree e radice
  senza collassare il gruppo; senza callback non c'è.

## Fuori

- Etichetta «worktree eliminato» nel Resume: già scartata nel piano 36.
- Un ⟲ per i worktree già tolti: non hanno riga nella sidebar, le loro chat
  stanno nel ⟲ del progetto.
