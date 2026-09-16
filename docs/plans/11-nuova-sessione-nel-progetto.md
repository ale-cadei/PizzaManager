# 11 — Nuova sessione dal gruppo progetto

Branch: `feat/nuova-sessione-nel-progetto` · Dipende da: 8 · Taglia: ~1h

## Obiettivo

Con la sidebar raggruppata per progetto, aprire una sessione nuova **in quel
progetto** senza ridigitare o cercare la directory: un «+» nell'header del
gruppo apre il dialog «Nuova sessione» con la directory già impostata sulla
radice del progetto. Il provider (shell, opencode, claude, codex, antigravity)
si sceglie lì come sempre, insieme a nome e account.

## Perché il dialog e non un menu nella sidebar

Il dialog ha già tutto quello che serve a una sessione nuova: tipo, nome,
account Claude, scelta del profilo di comando. Un menu di provider inline nella
sidebar avrebbe dovuto rifare o saltare quelle scelte. Preimpostare la
directory è la parte che manca; il resto esiste già.

## Pezzi

- **`renderer/sidebar.js`** — nuovo callback opzionale `onNewInProject(root)`.
  Con il callback, in modalità progetto ogni header con una radice riceve uno
  `span.group-add` («+») in coda, come la ✕ delle card: `stopPropagation` così
  il click non collassa il gruppo. Niente «+» per «Senza directory» (chiave
  vuota: non c'è dove creare) né in modalità tipo (la directory non è nota).
- **`renderer/renderer.js`** — `openNewModal(type, { cwd })` accetta una
  directory da proporre; `onNewInProject` la passa. Nient'altro cambia nel
  flusso di creazione.
- **`renderer/styles.css`** — `.group-add`: discreto, si accende all'hover con
  l'arancione dell'azione (crea, non distrugge: non il rosso della ✕).
- **`tests/sidebar-new-in-project.test.js`** — sul DOM finto: il «+» c'è solo
  dove deve, chiama il callback con la radice, ferma la propagazione.

## Fuori scope

Il «+» sugli header per tipo (aprirebbe il dialog col tipo preselezionato):
simmetrico e facile, ma non richiesto. Si aggiunge se serve.
