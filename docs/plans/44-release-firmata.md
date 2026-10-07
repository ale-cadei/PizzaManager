# 44 — Release firmata, e pacchetti aggiornati

Branch: `chore/release-firmata` · Dipende da: 13 · Taglia: ~½ g

## Obiettivo

L'ultima release scaricabile è la **1.0.2 del 21 settembre**: da allora `main`
ha preso 159 commit e 19 funzionalità (worktree, pannello modifiche, notifiche,
mappa dei branch, temi, scrollback…). Chi scarica il pacchetto usa un'app di
due settimane fa.

Qui si fa una **1.1.0 firmata e notarizzata** per macOS, con i pacchetti per
Linux e Windows aggiornati nello stesso giro. L'utente ha preso l'Apple
Developer Program: la firma, che il piano 13 aveva lasciato fuori per questo,
ora si può fare.

**Si resta sul repo privato** (scelta dell'utente, 2026-10-07): tu e il collega
scaricate da loggati. I link `releases/latest/download/…` del README continuano
quindi a non funzionare per chi non ha accesso, e l'aggiornamento automatico
resta fuori — vedi [18](18-aggiornamento-automatico.md), che richiede un
indirizzo pubblico.

## Cosa cambia la firma

| | Prima (non firmata) | Dopo (firmata + notarizzata) |
|---|---|---|
| macOS, prima apertura | «PizzaManager è danneggiato», serve *Apri comunque* o `xattr -cr` | si apre, nessun avviso |
| Linux | nessun avviso | invariato |
| Windows | avviso SmartScreen | **invariato**: serve un certificato Windows, altra spesa |

Sblocca anche due cose rimandate: `safeStorage` per le API key (differito dal
branch 3 perché su app non firmata il Keychain perde accesso a ogni rebuild) e,
quando si vorrà, l'aggiornamento automatico su Mac.

## Com'è fatta la configurazione

Poco, perché electron-builder 26 fa quasi tutto da sé:

- **Gli entitlement di default sono già quelli giusti** per Electron
  (`allow-jit`, `allow-unsigned-executable-memory`,
  `disable-library-validation`): nessun file da scrivere.
- **`hardenedRuntime` è già `true`** per default, ed è un requisito della
  notarizzazione.
- **La notarizzazione è opt-out**, non opt-in: parte da sé appena le
  credenziali sono nell'ambiente. Non serve `mac.notarize: true`; serve che i
  secret esistano.
- Quindi il lavoro è: togliere `CSC_IDENTITY_AUTO_DISCOVERY: false` dal
  workflow (c'era per dire «non cercare certificati») e passargli i secret.

`CSC_IDENTITY_AUTO_DISCOVERY` va **spento quando il certificato non c'è**,
altrimenti un build senza secret (un fork, o questo branch prima che i secret
esistano) tenterebbe di firmare e fallirebbe. Si lega al secret stesso:
`${{ secrets.MAC_CSC_LINK != '' }}`.

### Credenziali: la chiave API, non la password dell'Apple ID

Per notarizzare electron-builder accetta tre strade; la documentazione
consiglia la prima e la seguiamo:

1. `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — chiave di App
   Store Connect, revocabile da sola, non è la password di nessuno;
2. `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`;
3. un profilo nel keychain (solo in locale).

La chiave è un file `.p8`: nei secret ci va il **contenuto**, e il workflow lo
scrive in un file temporaneo prima del build, perché `APPLE_API_KEY` vuole un
percorso.

## Prima in locale, poi sul CI

Ogni giro del workflow costa ~5 minuti e la firma sbaglia in modi che si
leggono male. Quindi si valida sul Mac, dove il certificato è già nel keychain
e il ciclo è immediato:

```
npm run dist:mac
codesign -dv --verbose=4 "dist/mac-arm64/PizzaManager.app"   # Authority = Developer ID Application
spctl -a -vvv -t install "dist/mac-arm64/PizzaManager.app"   # accepted, source=Notarized Developer ID
xcrun stapler validate "dist/PizzaManager-mac-arm64.dmg"     # The validate action worked!
```

Solo quando questi tre passano si esportano il `.p12` e i secret e si tagga.

## Pezzi

- **`package.json`** — `version: 1.1.0`.
- **`.github/workflows/release.yml`** — i secret di firma e notarizzazione nel
  job di build, `CSC_IDENTITY_AUTO_DISCOVERY` legato alla presenza del
  certificato, il `.p8` scritto su file prima del build.
- **`README.md`** — la nota «I pacchetti non sono firmati» diventa vera: su
  macOS non serve più niente, su Windows l'avviso resta.
- **`docs/plans/13-release-build.md`** — la riga «fuori scope: firma» non vale
  più: rimanda qui.

Niente test: non c'è codice. La verifica è la lista qui sopra più il download
del `.dmg` dalla release su una macchina (o da un utente) che non l'ha mai
visto.

## Cosa serve dall'utente (non si può fare da qui)

1. **Certificato «Developer ID Application»**: Xcode → Settings → Accounts →
   il team → *Manage Certificates* → **+** → *Developer ID Application*.
   Nel keychain oggi c'è solo un «Apple Development», che serve a far girare
   l'app sui propri dispositivi e **non** vale per distribuire.
2. **Chiave di App Store Connect** (appstoreconnect.apple.com → Users and
   Access → Integrations → Keys), ruolo *Developer*: si scarica una volta sola.
3. **I secret nel repo**, dopo che il locale funziona: `MAC_CSC_LINK` (il
   `.p12` in base64), `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`,
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

## Fuori scope

- **Firma Windows**: altro certificato, altra spesa, e SmartScreen resta
  scettico finché non accumula reputazione.
- **Repo pubblico e aggiornamento automatico**: piano 18, quando si decide.
- **Il dominio**: non serve a niente di tutto questo. Se arriva, il sito può
  linkare gli asset o si passa a `provider: generic`; la firma vale comunque.
