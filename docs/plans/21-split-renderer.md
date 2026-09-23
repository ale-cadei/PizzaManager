# 21 — Dividere `renderer/renderer.js`

Branch: `refactor/split-renderer` · Dipende da: — · Taglia: ~2h

## Obiettivo

`renderer/renderer.js` è a 1464 righe (limite 800) e contiene quasi tutta la
UI: avvio, modali, schede, titoli, segnali, ripristino, sidebar, menu, barre.
Ogni feature di [idee.md](idee.md) ci passerebbe in mezzo. Lo si divide per
area **senza cambiare comportamento**.

## Come

Gli script del renderer sono classici (niente `import`, niente bundler): le
dichiarazioni di primo livello di uno script sono visibili a quelli caricati
dopo. Quindi la divisione è uno **spostamento di blocchi interi**, riga per
riga identici, in file caricati in quest'ordine da `index.html`:

| File | Cosa contiene |
|------|---------------|
| `app-state.js` | stato condiviso (`tabs`, `activeId`, tmux), `$`/`$$`, alias dei moduli, store di nomi/font/colori, tema del terminale, `escapeHtml` |
| `signals.js` | «ha finito» (lampeggio) e «sta lavorando» |
| `tabs.js` | ciclo di vita di una scheda: profilo comando, radice di progetto, `createTab`, `setActive`, fit, chiusura |
| `tab-names.js` | titoli automatici, primo prompt, rinomina |
| `session-list.js` | sidebar, ordine manuale, `renderSidebar`, suggerimenti |
| `new-session.js` | modal nuova sessione e directory recenti |
| `claude-accounts-ui.js` | account Claude multipli nei modal |
| `resume.js` | modal Resume |
| `restore.js` | riattacco a tmux e ripristino dopo un riavvio |
| `menu-actions.js` | menu Edit/Vista, dialog colori, menubar in-app |
| `panels.js` | pallini dei binari, schermata vuota, resize sidebar, barra usage |
| `renderer.js` | `init()` e l'avvio: resta il punto d'ingresso, caricato per ultimo |

Regola d'ordine: il codice che **gira al caricamento** (non dentro una
funzione) può usare solo ciò che sta in `app-state.js` o nel proprio file. Le
funzioni si chiamano fra file liberamente: quando `init()` parte
(`DOMContentLoaded`) sono già tutte caricate.

## Test

Quasi tutti i test sul renderer leggono il sorgente di `renderer.js` (non ha
una controparte eseguibile fuori da Electron). Dopo la divisione leggono
l'insieme dei file, nell'ordine di caricamento, da un helper
(`tests/renderer-source.js`). Un test nuovo verifica che `index.html` carichi
quei file in quell'ordine, dopo i moduli di cui hanno bisogno.

Trasformare quei controlli testuali in verifiche di comportamento è un lavoro
a parte: qui cambierebbe troppo insieme.

## Verifica

- Ricomporre i file (senza le intestazioni nuove) restituisce le stesse righe
  dell'originale: nessuna riga toccata, solo spostata.
- `npm run test:unit` verde.
- Smoke test nell'app: nuova sessione, resume, rinomina, lampeggio, chiusura,
  menu Vista, resize sidebar, riavvio con sessioni vive.

## Fuori

- Convertire i file in moduli UMD testabili come `sidebar.js`: si fa quando
  una feature tocca quel pezzo.
- La palette duplicata fra `TERM_THEME` e `tokens.css` (backlog).
