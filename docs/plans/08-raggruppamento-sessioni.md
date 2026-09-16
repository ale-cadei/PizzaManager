# Branch 8 — `feat/raggruppamento-per-progetto`

**Dipende da**: 2 (moduli in `lib/`, già fatto).
**Taglia**: ~mezza giornata. **Rischio**: basso — tocca solo la sidebar e aggiunge un handler IPC di sola lettura.
**Stato**: design approvato il 2026-09-16, da eseguire.

---

## Contesto

La sidebar raggruppa le sessioni aperte **per tipo**: `renderSidebar()` in
`renderer/renderer.js` costruisce una `Map` da `t.type`, con ordine fisso
(`GROUP_ORDER`) ed etichette da `GROUP_LABELS`. Lo stato collassato dei gruppi
sta in `localStorage` sotto `aisess.collapsedGroups` ed è una lista di tipi;
`setActive()` riapre il gruppo della scheda selezionata usando `t.type` come
chiave.

Chi lavora su più repository contemporaneamente non ragiona per tipo ma per
progetto: le tre sessioni aperte su `aisessionmanager` (shell, claude, codex)
finiscono oggi in tre gruppi diversi, e le sessioni dell'altro repo sono
mescolate alle loro.

## Obiettivo

L'utente sceglie come raggruppare le sessioni aperte: **per tipo** (come ora,
default) o **per progetto**, inteso come radice del repository git. La scelta si
cambia con un click nella sidebar e sopravvive al riavvio dell'app.

Fuori scope: raggruppare le voci del modal Resume, raggruppare per qualcosa che
non sia tipo o progetto, ordinamento personalizzabile.

## Cosa conta come "progetto"

La **radice git** della directory di lavoro della sessione: si risale l'albero
da `cwd` verso `/` finché si trova un `.git`. Va accettato sia come directory
(repo normale) sia come file (worktree e submodule, dove `.git` è un file che
punta altrove).

Senza `.git` il progetto è la `cwd` stessa. Così due sessioni aperte in
`repo/backend` e `repo/frontend` stanno nello stesso gruppo, e una sessione
aperta in `~/Downloads` resta un gruppo a sé.

## Architettura

Tre pezzi, ciascuno con un confine netto.

### `lib/project-root.js` — nuovo, puro

```
findProjectRoot(dir, { exists }) -> string | null
```

- risale da `dir` verso la radice del filesystem cercando `.git`;
- `exists` è iniettata (default `fs.existsSync`) per poter testare senza toccare
  il disco, oltre che con una tmpdir vera;
- nessun match → ritorna `dir` normalizzata (path assoluto, senza `/` finale);
- `dir` vuota, `null` o non stringa → ritorna `null`;
- non lancia mai: un errore del filesystem (permessi) interrompe la risalita e
  fa ritornare la `dir` di partenza.

Nessun `require('electron')`, come tutto ciò che sta in `lib/`.

### `lib/session-groups.js` — nuovo, puro

```
groupSessions(sessions, { mode, typeOrder, typeLabels }) -> Group[]
Group = { key, kind: 'type' | 'project', label, title, items }
```

Funzione pura: non muta l'array in ingresso, ritorna strutture nuove.

`mode: 'type'` — comportamento identico a oggi: ordine `typeOrder`, etichette
`typeLabels`, tipi sconosciuti in coda in ordine di apparizione.

`mode: 'project'` — chiave = `session.projectRoot`; gruppi in **ordine
alfabetico** per etichetta (`localeCompare`, poi `key` a parità, così l'ordine è
totale e stabile); etichetta = basename della root. Se due root distinte hanno
lo stesso basename (due cartelle `app`), **entrambe** passano a
`parent/basename`: disambiguare solo una delle due renderebbe il confronto
illeggibile. `title` = path completo della root. Le sessioni senza directory
finiscono in un gruppo `Senza directory` (`key: ''`) messo **in fondo**.

Dentro ogni gruppo le sessioni restano nell'ordine ricevuto (ordine di
creazione), come oggi.

### `main.js` + renderer — cablaggio

- `main.js`: handler IPC `resolve-project` che chiama `findProjectRoot(cwd)` e
  nient'altro, com'è per gli altri handler (un test lo verifica).
- `preload.js`: `resolveProject(cwd)` nel bridge.
- `renderer.js`: cache `Map<cwd, root>` per non ripetere la risalita; la
  risoluzione avviene alla creazione della scheda **dopo** `spawn`, perché il
  main può spostare la `cwd` (`res.cwd`), e il risultato si ferma su
  `tab.projectRoot`. Mentre la promise è in volo la scheda usa `cwd` come root
  provvisoria: la sidebar non deve mai aspettare l'I/O per disegnarsi.

## UI

### Il selettore

Nella riga `.side-section` di `renderer/index.html`, accanto a `#count`:

```
SESSIONI APERTE (4)   [ Tipo | Progetto ]
─────────────────────────────────────────
▾ 📁 aisessionmanager        2
    ◆ Claude · main
      Terminale
▾ 📁 digitiamo/api           2
```

Due bottoni (`#group-mode-type`, `#group-mode-project`) in un contenitore
`.seg`, markup statico nell'HTML. Gli handler si registrano da JavaScript:
un `onclick=` nell'attributo verrebbe bloccato dalla CSP, che non ammette
`unsafe-inline` — e non va aggirata.

Il bottone attivo ha `aria-pressed="true"` e la classe `is-on`. Stili in
`renderer/styles.css` con i token esistenti, nessun colore hardcoded.

### Header e card in modalità progetto

**Header**: icona cartella (`Icons.markup` copre solo i marchi degli agenti,
per il progetto serve un glifo neutro), nome del progetto, conteggio, chevron.
`title` = path completo.

**Card**: il sottotitolo passa da `cwd · extra` a `Tipo · sottocartella · extra`,
dove la sottocartella è il path relativo alla root del progetto e si mostra solo
se la sessione non sta nella root. Ripetere il path sotto un header che è già
quel path è rumore. Icona del tipo, pallino `live`, marker di selezione e ✕
restano invariati; il `title` completo continua a mostrare la `cwd` intera.

### Stato persistito

| Chiave localStorage | Contenuto | Default |
|---|---|---|
| `aisess.groupMode` | `'type'` o `'project'` | `'type'` |
| `aisess.collapsedGroups` | tipi collassati (già esiste) | `[]` |
| `aisess.collapsedProjects` | root di progetto collassate | `[]` |

Le due liste di collassamento sono **separate**: collassare "Claude" e
collassare "aisessionmanager" sono scelte diverse, tenerle nella stessa chiave
le farebbe interferire. Entrambe si leggono validando il JSON e scartando i
valori non attesi, come fa già il codice per `collapsedGroups`. Un
`aisess.groupMode` non riconosciuto ricade su `'type'`.

`setActive()` riapre il gruppo della scheda attiva usando la chiave della
**modalità corrente** (tipo o project root), non più `t.type` fisso.

## Gestione degli errori

- `resolve-project` fallisce o va in errore → `console.warn` e la scheda usa la
  `cwd` come root. Nessuna sessione può sparire dalla sidebar per colpa del
  filesystem.
- `localStorage` non scrivibile → `try/catch` silenzioso come nel resto del
  file: si perde la persistenza, non la funzionalità.
- Sessione senza `cwd` → gruppo `Senza directory`, non un gruppo con etichetta
  vuota.

Nessun timeout sull'IPC: la risalita è sincrona, corta e locale.

## Test

`npm run test:unit`, importando il codice vero (mai ricopiare una funzione nel
test).

`tests/project-root.test.js` (nuovo)
- tmpdir con `.git` directory → root trovata da una sottocartella profonda;
- `.git` come **file** (worktree) → riconosciuto;
- nessun `.git` fino a `/` → ritorna la `dir` di partenza;
- `dir` vuota / `null` → `null`;
- `exists` che lancia → nessuna eccezione, ritorna la `dir` di partenza.

`tests/session-groups.test.js` (nuovo)
- modalità tipo: ordine `GROUP_ORDER` invariato, tipo sconosciuto in coda;
- modalità progetto: ordine alfabetico; basename omonimi → entrambi
  `parent/base`; gruppo `Senza directory` in fondo;
- l'array in ingresso non viene mutato e i gruppi sono strutture nuove.

`tests/ui.test.js` (esistente, già ispeziona `renderSidebar`)
- i bottoni del selettore esistono in `index.html`;
- nessun handler inline nel markup aggiunto.

`tests/wiring.test.js` (esistente)
- `resolve-project` registrato in `main.js` e delegato a `lib/project-root.js`.

**Smoke manuale prima della PR**: due sessioni nello stesso repo (una in una
sottocartella) più una in un altro repo e una fuori da git; switch avanti e
indietro tra le due modalità; collasso di un gruppo in ciascuna modalità;
chiusura e riapertura dell'app per verificare che modalità e collassi tornino.

## Commit previsti

Separati, come da `CLAUDE.md`:

1. `feat: raggruppamento delle sessioni per progetto oltre che per tipo`
   — i due moduli `lib/`, l'handler IPC, il selettore, i test.
2. `refactor: la sidebar esce da renderer.js`
   — `renderer.js` è a 996 righe, sopra il limite di 800, e questo branch ne
   aggiunge: si estrae il disegno della sidebar in `renderer/sidebar.js`
   **senza** cambiare comportamento. Secondo commit apposta: se qualcosa si
   rompe si capisce subito se è lo spostamento o la funzionalità nuova.
