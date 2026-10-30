# 72 — `feat/sidebar-sessioni-collassabile`: sidebar collassabile

Taglia: ~mezza giornata.

## Perché

La sidebar delle sessioni occupa 300px anche quando servono solo per
cambiare scheda. Collassata deve restare **usabile**: stesse azioni, meno
testo.

## Cosa fa

- Un tasto nella fascia del marchio (`«` / `»`) collassa e riapre la
  sidebar. Lo stato si ricorda (`aisess.sidebarCollapsed`).
- Collassata (larghezza fissa, `--sidebar-collapsed-w`):
  - marchio → solo la pizza, più piccola;
  - Nuova / Resume → solo `+` e `⟲`, uno sotto l'altro;
  - ricerca → una lente: il click riapre la sidebar e mette il cursore
    nella casella;
  - etichetta «Sessioni aperte» e selettore Tipo/Progetto → spariti;
  - gruppi → solo l'icona del gruppo (click apre/chiude come prima); niente
    nome, contatore, `+`, resume, worktree;
  - card → icona e barretta colorata del tipo; segnali (al lavoro, ha finito,
    permesso, selezione) restano perché vivono sulla card stessa. Il nome
    va nel tooltip;
  - righe dei worktree → solo il glifo `⑂`;
  - legenda in fondo → solo i pallini; riga dei binari nascosta.
- Collassata la maniglia di ridimensionamento non trascina: la larghezza
  salvata resta quella della sidebar aperta.
- Ogni cambio rifà il fit del terminale attivo.

## Come

- `renderer/sidebar-collapse.js` (UMD, testabile): `createSidebarCollapse({
  sidebar, toggle, searchButton, searchInput, storage, onChange })` →
  `{ isCollapsed, setCollapsed, toggle }`. Mette `.collapsed` su `#sidebar`,
  aggiorna `aria-expanded`/`title` del tasto.
- Tutto il resto è CSS sotto `#sidebar.collapsed`: il markup delle card non
  cambia, la sidebar non sa di essere stretta.
- Le scritte dei tasti Nuova/Resume vanno in uno `<span class="btn-label">`
  per poterle nascondere.
- `renderer/sidebar.js`: il tooltip della card comincia col nome della
  sessione (da collassata è l'unico modo di leggerlo).
- Cablaggio in `renderer/panels.js` (`initSidebarCollapse`), accanto al
  ridimensionamento.

## Test

- `tests/sidebar-collapse.test.js`: parte aperta, legge lo stato salvato,
  il tasto alterna e salva, `onChange` chiamato, la lente riapre e dà il
  fuoco alla casella, storage che lancia non rompe niente.
- `tests/sidebar-*.test.js`: il tooltip della card contiene il nome.

## Fuori

- Animazione della larghezza (il terminale andrebbe rifittato a fine
  transizione; si valuta dopo averla vista).
- Scorciatoia da tastiera: Ctrl+B è del terminale.
