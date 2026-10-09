# 48 — Segnalazioni e richieste, dentro l'app

Branch: `feat/segnalazioni` · Dipende da: 18 (aggiornamento), 44 (repo pubblico)
Taglia: ~1 g

## Obiettivo

Un pannello nell'app dove chi la usa vede le richieste di funzionalità e le
segnalazioni, le vota, ne apre di nuove — e soprattutto **vede cosa stiamo
effettivamente sviluppando**. Il modello è quello delle bacheche tipo Canny:
elenco ordinato per voti, linguette *Di tendenza · Recenti · Pianificato ·
Rilasciate*, etichetta di stato sulla riga, autore, e un `+` per aggiungerne.

Oggi non esiste niente: chi prova l'app non ha un posto dove dire che qualcosa
non va, e noi non abbiamo un posto dove dire su cosa stiamo lavorando.

## Perché GitHub come magazzino, e non un backend

Le issue del repo pubblico hanno già tutti i pezzi della bacheca:

| Nella bacheca | Su GitHub |
|---|---|
| i voti | reazioni 👍, e si ordina per quelle |
| *Pianificato* / *In corso* / *Completato* | etichette `stato:*` |
| i filtri in alto | filtri per etichetta |
| l'autore | chi ha aperto la issue |
| il `+` | nuova issue |

Un backend nostro (Cloudflare Workers + D1 sta in un piano gratuito) darebbe
in più **il voto senza account**, ma in cambio ci renderebbe responsabili di
spam, moderazione, dati altrui e di una cosa in più che si rompe. Si fa quando
e se il voto senza account diventa un problema vero.

**Il vincolo da sapere prima di cominciare**: per *leggere* la bacheca non
serve niente, per *scrivere* (aprire una richiesta, votare) serve un account
GitHub. Per il pubblico di questa app — gente che usa Claude Code, Codex o
OpenCode da terminale — è un account che ha già. Per un pubblico generico non
lo sarebbe.

## L'architettura che non ci costringe a scegliere adesso

```
renderer/feedback-panel.js     disegna, non decide
        ↕ IPC
app/feedback.js                rete (il renderer non puo': CSP)
        ↕
lib/feedback-source.js         list() · voteUrl() · createUrl()
        ↕
   githubSource                oggi: legge feedback.json, scrive via browser
   (backendSource)             domani, se servira'
```

Il pannello parla con **una sola interfaccia**. Il giorno in cui si volesse un
backend, si scrive la seconda implementazione e la vetrina non si tocca —
stesso schema di `lib/update-policy.js` / `app/updater.js`, che ci ha permesso
di cambiare strada sulla notarizzazione senza riscrivere il banner.

## Da dove arrivano i dati: un file, non l'API

L'app **non** interroga l'API di GitHub a ogni apertura: senza autenticazione
sono 60 richieste all'ora **per indirizzo IP**, e in un ufficio dietro NAT si
esauriscono in fretta, con l'app di tutti che smette di funzionare insieme.

Invece: una **GitHub Action** sul repo pubblico, che a ogni issue aperta,
chiusa, etichettata o reagita rigenera `feedback.json` nella radice. L'app
scarica quel file statico — nessun limite, veloce, e funziona anche quando
l'API rallenta. È lo stesso meccanismo del manifesto dell'aggiornamento
(`latest-mac.yml`), che per gli stessi motivi è un file e non una chiamata.

```json
{
  "generato": "2026-10-09T10:30:00Z",
  "voci": [
    { "numero": 12, "titolo": "…", "autore": "tizio", "voti": 7,
      "stato": "in-corso", "tipo": "richiesta", "url": "https://…" }
  ]
}
```

`stato` esce dalle etichette `stato:pianificato`, `stato:in-corso`,
`stato:completato`; senza etichetta è `aperta`. `tipo` da `bug` o
`enhancement`.

## Scrivere: cosa si può e cosa no

- **`+` nuova richiesta** — apre GitHub su una issue **precompilata**. Il
  modulo vero (titolo, descrizione, passi) sta **dentro l'app**, e il testo
  viene passato nell'indirizzo insieme alla diagnostica: versione, sistema,
  se `tmux` c'è, quali CLI sono state trovate (`checkDeps`, `app.getVersion()`).
  Oggi quelle informazioni si chiedono a mano a ogni scambio.
- **Voto** — ⚠️ **GitHub non permette di aggiungere una reazione da un link.**
  Il pulsante apre la issue, e la persona preme 👍 lì. È una frizione reale e
  va detta nell'interfaccia («apre GitHub»), non nascosta dietro una freccia
  che sembra votare e invece non vota.
  Si risolverebbe col login GitHub dell'utente (device flow, ~1 g) o con il
  backend. Fuori da questo branch.

## La rete la fa il main

`connect-src 'none'` nella CSP del renderer, e **resta così**: il renderer non
chiama niente. Il main scarica, mette in cache e passa i dati via IPC — come
`lib/usage/claude-quota.js` per la quota. Cache di 10 minuti e un pulsante per
rileggere: la bacheca non cambia ogni minuto.

## Pezzi

- **`lib/feedback-source.js`** (puro) — l'interfaccia e l'implementazione
  GitHub: `parseFeed(json)` normalizza e ordina, `filterBy(voci, linguetta)`
  applica *Di tendenza / Recenti / Pianificato / Rilasciate*, `createUrl({…})`
  compone l'indirizzo della issue precompilata (con `encodeURIComponent`:
  nel titolo e nel corpo ci finisce testo scritto dall'utente),
  `voteUrl(numero)`. `fetch` iniettato, come in `claude-quota.js`.
- **`lib/diagnostics.js`** (puro) — la riga di diagnostica da allegare, da
  versione, piattaforma, presenza di tmux ed elenco delle CLI. Separata perché
  servirà anche a `Help → Segnala un problema`.
- **`app/feedback.js`** — `registerFeedbackHandlers(ipcMain, …)`: scarica,
  mette in cache, apre gli indirizzi con `shell.openExternal`.
- **`renderer/feedback-panel.js`** — il pannello, sul modello di
  `extensions-panel.js`: linguette, elenco, riquadro del voto, etichetta di
  stato, modulo del `+`. `textContent`, mai `innerHTML`: titoli e descrizioni
  arrivano da estranei.
- **`renderer/index.html`**, **`styles.css`**, **`panels.js`** — il pannello e
  il suo pulsante, accanto a «Plugin e skill».
- **`main.js`** — due righe, come gli altri `register*`.

Nel **repo pubblico** (non qui):
- `.github/workflows/feedback.yml` — l'Action che rigenera `feedback.json`
- `.github/ISSUE_TEMPLATE/segnalazione.yml` e `richiesta.yml` — i moduli, con
  i campi che l'app precompila
- le etichette `stato:pianificato`, `stato:in-corso`, `stato:completato`

## Test

- `tests/feedback-source.test.js` — ordinamento per voti, i quattro filtri,
  stato dedotto dalle etichette (anche assente e sconosciuto), indirizzi
  composti con caratteri da sfuggire (`&`, `#`, accenti, a capo), feed
  malformato che non fa cadere il pannello.
- `tests/diagnostics.test.js` — la riga su macOS/Linux/Windows, con e senza
  tmux, con CLI assenti.
- `tests/feedback-panel.test.js` — sul DOM finto: le linguette filtrano, una
  voce mostra stato e autore, il pulsante del voto chiama chi apre il browser,
  elenco vuoto con un messaggio invece che vuoto e basta.

## Verifica nell'app

1. Aprire il pannello senza rete: deve dirlo, non restare bianco.
2. Aprire una richiesta dal `+`: GitHub si apre con titolo, corpo e
   diagnostica già dentro; la issue creata compare nel pannello entro un paio
   di minuti (il tempo dell'Action).
3. Mettere `stato:in-corso` su una issue: l'etichetta compare nel pannello.
4. Mettere 👍 da due account: l'ordine di *Di tendenza* cambia.

## Fuori scope

- **Backend proprio** e voto senza account: vedi sopra.
- **Login GitHub dentro l'app** (device flow), che toglierebbe il passaggio
  dal browser per votare.
- **Moderazione**: le issue si chiudono da GitHub, come sempre.
- **Notifiche** quando una richiesta cambia stato.

## Scelte prese (utente, 2026-10-09)

- **Voti veri**, letti dalle reazioni 👍: il contatore è condiviso e
  attendibile. Il pulsante apre la issue per votare — scartata l'ipotesi del
  voto locale, perché un numero che sembra di tutti e invece è tuo mente.
- **Il pannello sta accanto a «Plugin e skill»**, in fondo a destra: è lo
  stesso tipo di finestra ed è dove uno lo cerca.
- **Si chiama «Segnalazioni»**: copre sia i problemi sia le richieste.
