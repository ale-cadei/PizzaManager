# 13 — Build, installazione e release

Branch: `chore/release-build` · Dipende da: 12 · Taglia: ~2h

## Obiettivo

Avere l'app come app vera (icona, /Applications) sul Mac di chi la sviluppa,
e pacchetti scaricabili per macOS, Linux e Windows con un link stabile nel
README. Senza firma: Apple Developer Program e certificato Windows sono una
decisione (e una spesa) separata; quando ci saranno, `electron-builder` li
usa da variabili d'ambiente senza toccare il workflow.

## Pezzi

- **`scripts/install-mac.sh`** (`npm run install:mac`): `dist:mac` + copia in
  `/Applications`. Rifiuta di girare se l'app è aperta: due istanze sarebbero
  due client sullo stesso socket tmux e sulla stessa cartella dati. Costruita
  in locale non ha l'attributo di quarantena, quindi si apre senza avvisi.
- **`package.json`**: `repository` (electron-builder lo usa per pubblicare),
  `artifactName` senza versione (`PizzaManager-mac-arm64.dmg`) così i link
  `releases/latest/download/<file>` restano validi a ogni release, target
  Windows `nsis` + `zip`, `publish: github` in bozza.
- **`.github/workflows/ci.yml`**: `npm run test:unit` a ogni push e PR, su
  Ubuntu (i casi Windows girano da Unix con `platform: 'win32'`).
- **`.github/workflows/release.yml`**: a ogni tag `v*`, tre runner (macOS
  arm64 + x64, Ubuntu, Windows) perché `node-pty` si compila per piattaforma;
  ogni runner carica i suoi file sulla Release del tag, creata in bozza.
- **README**: tabella di download per sistema, istruzioni per l'app non
  firmata (macOS 15: *Apri comunque* in Privacy e sicurezza), sezione
  «Installarla come app vera».

## Come si fa una release

```
npm version minor        # aggiorna package.json e crea il tag v1.x.0
git push --follow-tags
```

Poi su GitHub → Releases → la bozza `v1.x.0`: controllare che ci siano i sei
file (dmg ×2, AppImage, deb, exe, zip ×2) e pubblicare.

## Fuori scope

Firma e notarizzazione macOS, code-signing Windows, aggiornamento automatico
(`latest-*.yml` viene generato comunque, per quando servirà), build universale
macOS (arm64 e x64 sono due file).
