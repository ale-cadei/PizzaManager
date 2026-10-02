# 38 — Notifiche di sistema quando una sessione ha finito

Branch: `feat/notifiche-sistema` · Dipende da: — · Taglia: ~½ g
Scritto il 2026-10-02. Solo macOS e Linux; Windows dopo, con un piano suo.

**Stato (2026-10-02):** fatto (commit `feat: notifiche di sistema…` e
`feat: la scheda attiva conta come non vista…`), suite verde. Provato
nell'app installata su macOS (notifica con nome e icona di PizzaManager).
Da provare su Linux dal `.deb`.

## Obiettivo

Oggi la card lampeggia quando l'assistente ha finito, ma il lampeggio si vede
solo guardando l'app. Se l'utente è in un'altra finestra, un agente che ha
finito resta fermo ad aspettarlo senza che nessuno lo sappia.

Con questo branch, quando una card si accende **e la finestra dell'app non ha
il focus**, parte una notifica di sistema (Centro Notifiche su macOS,
libnotify/D-Bus su Linux). Cliccandola l'app torna in primo piano sulla scheda
giusta. Sul Dock (macOS) un badge conta le card accese.

È metà dell'idea «Segnale esatto "ha finito / ti sta chiedendo qualcosa"» di
[idee.md](idee.md): la parte delle notifiche, non quella del segnale.

## Confine: il segnale è quello di Ale, così com'è

Il «quando» non si decide qui. La regola che accende la card è di Ale Cadei
(`renderer/attention.js`, `renderer/running.js`, i timer in
`renderer/signals.js`), e sul segnale esatto via hook di Claude ci sta
lavorando lui. Questo branch:

- **non modifica le regole** di `attention.js` né di `running.js`, né le
  soglie in `signals.js`. Le funzioni che espongono (`left`, `seen`, …) si
  possono usare liberamente: l'utente ha dato l'ok il 2026-10-02;
- si aggancia nei punti in cui la card si accende e si spegne, con una
  chiamata per punto, senza cambiare le condizioni attorno;
- non introduce hook, `--settings` o altri segnali per Claude.

Quando arriverà il segnale di Ale, la notifica lo seguirà senza modifiche:
parte da `needsAttention`, non dall'euristica.

Se in prova le notifiche risultano rumorose (una card accesa per sbaglio è un
fastidio piccolo; una notifica sbagliata no), si annota in idee.md per Ale.
Non si correggono le soglie in questo branch.

## Cosa c'è già (non rifarlo)

- `flagAttention(t, { bell })` in `renderer/signals.js`: l'unico punto in cui
  `t.needsAttention` diventa `true`. Esclude già shell, scheda attiva e card
  già accesa.
- `retractAttention(t)` (l'assistente ha ripreso a lavorare) e
  `clearAttention(id)` (scheda selezionata o chiusa): gli unici punti in cui si
  spegne.
- `setActive(id)` in `renderer/tabs.js`: apre una scheda e spegne il suo
  segnale. Il click sulla notifica passa da qui.
- `tab.name`, `Groups.TYPE_LABELS`, `Groups.shortPath`: nome della scheda, tipo
  leggibile e percorso corto, gli stessi usati dalla sidebar e dal modal di
  rinomina (`renderer/tab-names.js`).
- `registerClipboardHandlers(ipcMain)` / `registerGitHandlers`: il modello per
  registrare gli IPC fuori da `main.js`.
- Preferenze del renderer in localStorage con una piccola factory testabile:
  `renderer/term-font.js`, `renderer/pets-config.js`.

## Progetto

### 1. `lib/notifications.js` — logica pura

Niente Electron, tutto provabile da Node.

- `isPlatformSupported(platform = process.platform)`: `darwin` e `linux`.
  Su `win32` le notifiche restano spente finché non le prova qualcuno lì: il
  comportamento su Windows non cambia.
- `shouldNotify({ enabled, focused, supported })`: notifica solo se le
  notifiche sono accese, la piattaforma è supportata e la finestra **non** ha
  il focus.
- `composeNotification(items)`: riceve una o più voci
  `{ id, name, typeLabel, where }` e restituisce `{ title, body, tabId }`.
  - una voce: titolo `«<Tipo> ha finito»`, corpo `«<nome> · <percorso corto>»`,
    `tabId` = la sua;
  - più voci: titolo `«N sessioni hanno finito»`, corpo con i nomi separati da
    ` · ` (troncato a una lunghezza massima, costante nominata), `tabId` = la
    prima.
  - Mai output del terminale nella notifica: solo nomi già visibili in sidebar.
- `validateItem(raw)`: i dati arrivano dal renderer via IPC, quindi
  `id` è stringa non vuota e i testi sono stringhe accorciate. Una voce non
  valida viene scartata.
- `createCoalescer({ windowMs, schedule, cancel })`: raccoglie le voci che
  arrivano entro `windowMs` (costante `COALESCE_MS = 1500`) e chiama `flush`
  una volta sola. Il timer è iniettato, così il test non aspetta.

### 2. `app/notify.js` — Electron

`registerNotifyHandlers(ipcMain, { getWindow, sendToRenderer, platform })`:

- `ipcMain.on('notify-finished', item)` → `validateItem` → coalescer →
  al flush, se `shouldNotify({ enabled, focused: win.isFocused(), supported:
  isPlatformSupported() && Notification.isSupported() })`, crea
  `new Notification({ title, body, silent: false })` e la mostra.
- **Riferimento alle notifiche vive**: un `Set` che le tiene finché non
  arrivano `click` o `close`. Senza riferimento il garbage collector raccoglie
  l'oggetto e il click non arriva più. È un problema noto di Electron.
- `click` → `win.isMinimized() && win.restore()`, `win.show()`, `win.focus()`;
  su macOS anche `app.focus({ steal: true })`. Poi
  `sendToRenderer('notify-open-tab', tabId)`.
- `ipcMain.on('notify-badge', count)`: su macOS `app.dock.setBadge(count ?
  String(count) : '')`; su Linux `app.setBadgeCount(count)`. Su Linux funziona
  solo con launcher che lo supportano (Unity, KDE) e altrove non fa danni.
- `ipcMain.on('notify-config', { enabled })`: tiene in memoria la preferenza
  e allinea la spunta del menu (`getMenuItemById('notifications')`).
- Al ritorno del focus sulla finestra (`win.on('focus')`) si chiudono le
  notifiche ancora aperte: l'utente è tornato e la sidebar dice già tutto.
- Errori: ogni chiamata è in `try/catch` con `console.error('[notify]', e)`.
  Una notifica che non parte non deve mai rompere il flusso del terminale.

`main.js`: solo `registerNotifyHandlers(ipcMain, { getWindow: () => mainWindow,
sendToRenderer })`. Niente logica (lo verifica un test).

### 3. Renderer

- `preload.js`: `notifyFinished(item)`, `notifyBadge(count)`,
  `notifyConfig(cfg)`, `onNotifyOpenTab(cb)`. Va aggiunto anche
  `'menu-notifications'` alla lista `allowed` di `onMenu`.
- `renderer/notify.js` (nuovo, UMD come `term-font.js`):
  `createNotifyStore(localStorage)` con chiave `aisess.notifications`, accese
  di default. Poi `notifyItem(tab)`, che compone la voce da `tab.name`, il
  tipo e il percorso corto. Caricato in `index.html` prima di `signals.js`
  (aggiornare `tests/renderer-load.test.js`).
- Agganci, una riga ciascuno:
  - `flagAttention`, subito dopo `t.needsAttention = true`:
    `window.aisess.notifyFinished(notifyItem(t))` e aggiornamento del badge;
  - `retractAttention` e `clearAttention`, quando spengono: aggiornamento del
    badge.
  - Il badge è il conteggio delle schede con `needsAttention`: lo calcola una
    funzione sola (`attentionCount()`), chiamata da tutti e tre i punti.
- `onNotifyOpenTab(id)` → se la scheda esiste ancora, `setActive(id)`.
  Altrimenti (chiusa nel frattempo) niente.
- Avvio: `notifyConfig({ enabled: notifyStore.get() })`, così il main conosce
  la preferenza e la spunta del menu è giusta.

### 4. Menu

View → «Notifiche di sistema», `type: 'checkbox'`, `id: 'notifications'`.
Il click manda `menu-notifications` al renderer, che inverte la preferenza, la
salva e la rimanda con `notifyConfig`. Su Windows la voce non c'è
(`isPlatformSupported`).

### 5. La scheda attiva, con l'app in secondo piano

Oggi `noteActivity` e `flagAttention` escludono **la scheda attiva**: si
assume che l'utente la stia guardando. Con l'app in secondo piano non è vero,
e il caso più comune («lancio Claude, passo al browser, aspetto») non
produrrebbe notifiche: la scheda è attiva, la card non si accende.

Si sistema senza cambiare le regole di `attention.js`, usando le sue API:
- in `signals.js` la condizione «già sotto gli occhi» diventa
  `t.id === activeId && windowFocused` (una funzione sola, `isWatched(t)`,
  usata da `noteActivity` e `flagAttention`);
- `blur` della finestra → `attention.left(activeId)`: parte la finestra di
  silenzio, come quando si cambia scheda. Così il ridisegno provocato dal
  cambio di focus (xterm manda `\x1b[O`, la TUI può ridisegnarsi) non accende
  la card;
- `focus` → `clearAttention(activeId)` e ridisegno della card: l'utente è
  tornato e la vede.

È un cambio di comportamento del lampeggio (ora la scheda attiva può
lampeggiare, ma solo mentre l'app è dietro), quindi va in un **commit
separato** dalle notifiche. A Ale va segnalato nella PR.

## Prima di tutto: spike di 10 minuti

Prima di scrivere il resto, nell'**app installata** e non con `npm start`.
Non serve codice: le notifiche HTML5 del renderer passano dallo stesso
meccanismo di Electron di quelle del main, quindi la console basta.

1. Aprire PizzaManager da `/Applications`.
2. View → Strumenti di sviluppo → Console, e incollare:
   `setTimeout(() => new Notification('PizzaManager', { body: 'Claude ha finito · prova' }).onclick = () => console.log('click'), 5000)`
3. Entro 5 secondi passare a un'altra applicazione.

Stato di partenza (2026-10-02): l'app installata è firmata **ad-hoc**
(`codesign -dv`: `Signature=adhoc`), bundle id `com.aisessionmanager.app`,
Electron 33.4.11.

- Con `npm start` la notifica risulta di «Electron»: è normale e non dice
  niente. Nell'app impacchettata deve comparire come PizzaManager, con la sua
  icona.
- Domanda da chiudere: **un'app firmata solo ad-hoc riesce a mostrarla?**
  Alla prima macOS chiede il permesso (Impostazioni → Notifiche →
  PizzaManager). Se non compare, ci si ferma e si torna sul piano: servirebbe
  una firma vera nel build mac (`13-release-build.md`).
- Da annotare qui: compare sì/no, nome e icona, richiesta di permesso,
  il click riporta davanti l'app e stampa `click` in console.

**Esito (2026-10-02, macOS, app installata firmata ad-hoc):** la notifica
compare con nome e icona di PizzaManager, e il click riporta l'app davanti.
La firma ad-hoc basta: si procede. Linux da provare alla verifica finale.
- Linux: la stessa prova dal `.deb`, su GNOME. Su Linux il nome lo prende dal
  file `.desktop`, che electron-builder genera da `productName`.

## Test

- `tests/notifications.test.js` (lib): `shouldNotify` nelle sue combinazioni,
  `isPlatformSupported` con `platform: 'win32'`/`'darwin'`/`'linux'`,
  `composeNotification` con una e più voci e con nomi lunghi, `validateItem`
  con input sporchi (non oggetto, id vuoto, testi enormi), coalescer con timer
  finto (tre voci in 1 s → un flush; due voci a 2 s → due flush).
- `tests/notify-store.test.js` (renderer/notify.js): default acceso, salva e
  rilegge, localStorage che lancia → default senza eccezioni.
- `renderer-load.test.js`: ordine degli script aggiornato.
- `tests/wiring.test.js`: handler `notify-*` registrati, metodi nel preload,
  `menu-notifications` nella lista `allowed`, aggancio in `flagAttention`.
- `tests/unit.test.js` deve restare verde: `main.js` senza logica e moduli
  coperti da `build.files` (`lib/**` e `app/**` li includono già).

## Verifica nell'app

macOS (app installata) e Linux (`.deb`):
1. Claude in una scheda **non attiva**, gli si chiede qualcosa, si passa a
   un'altra applicazione → a fine turno arriva la notifica, il Dock mostra 1.
1b. Lo stesso con la scheda **attiva** (passo 5) → stessa notifica; tornando
   all'app la card si spegne da sola.
2. Click sulla notifica → l'app torna davanti su quella scheda, la card si
   spegne, il badge sparisce.
3. Due sessioni che finiscono quasi insieme → una notifica sola
   «2 sessioni hanno finito».
4. Con la finestra in primo piano → nessuna notifica, solo il lampeggio.
5. View → Notifiche di sistema spenta → nessuna notifica. Il badge resta
   (dice solo quante card sono accese).
6. Shell con un build lungo → nessuna notifica (le shell non lampeggiano).
7. Riapertura dell'app con sessioni tmux ripristinate → nessuna raffica di
   notifiche all'avvio (`born` in attention.js le esclude già: va controllato).

## Fuori da questo branch

- Il segnale esatto (hook `Stop`/`Notification` di Claude, «ti sta chiedendo
  un permesso»): ci lavora Ale.
- Windows (toast, `setAppUserModelId`): piano a parte, dopo una prova vera lì.
- Suoni personalizzati, azioni nella notifica («Rispondi»), notifiche con l'app
  chiusa (con la finestra chiusa su macOS il renderer non c'è e nessuno accende
  le card).

## Commit previsti

1. `feat: notifiche di sistema quando una sessione ha finito`
   (lib + app + preload + renderer + menu + test)
2. `feat: la scheda attiva conta come non vista con l'app in secondo piano`
3. `docs: piano 38, stato e prova`
