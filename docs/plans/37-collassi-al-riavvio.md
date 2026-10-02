# 37 — I gruppi collassati restano collassati alla riapertura

Branch: `fix/collassi-al-riavvio`. Taglia: ~1h.

## Problema

La sidebar salva già i gruppi collassati in localStorage
(`aisess.collapsedGroups`, `aisess.collapsedProjects`, `renderer/sidebar.js`).
Ma alla riapertura dell'app ogni sessione che torna passa da `createTab` →
`setActive`, e `setActive` espande il gruppo della scheda (`expandGroupOf`),
salvando l'espansione. Risultato: ogni gruppo con almeno una sessione si
riapriva, e il collasso andava perso.

## Soluzione

`setActive(id, { reveal })`: con `reveal: false` non espande il gruppo.
`createTab` e `createGitTab` inoltrano l'opzione. La passano `false` le
schede che tornano da sole o dal ripristino, non scelte dall'utente in
quel momento:

- sessioni tmux riattaccate (`reattachLiveSessions`, `renderer/restore.js`)
- sessioni ricreate dopo un riavvio della macchina (`sessionRestoreItem`)
- schede git riaperte (`restoreGitSessions`, `gitRestoreItem`)

Click su una card, nuova sessione, ricerca: espandono come prima.

## Verifica

`tests/collapsed-restore.test.js`. Nell'app: collassare un gruppo con
sessioni, chiudere e riaprire l'app → resta collassato.
