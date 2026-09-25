# 23 — Windows: la prova vera

Branch: `fix/windows` · Dipende da: 12, 13 · Taglia: ~½ g

## Obiettivo

Il piano 12 è stato scritto e verificato da Unix con `platform: 'win32'`
iniettato. Questa è la prima prova su una macchina Windows 11 vera
(Node 24, VS Build Tools 2022, `claude.exe` nativo). Obiettivo: che
`npm install && npm start` funzioni al primo colpo, che la suite passi anche
su Windows, e che una CI su Windows impedisca di rompere di nuovo le cose.

## Cosa è stato provato

- Il pacchetto **v1.0.2** scaricato dalla Release (`PizzaManager-win-x64.zip`):
  finestra, PowerShell nel pty, Claude in una repo, Resume, directory recenti,
  riavvio senza modal di ripristino. **Funziona.**
- Dal sorgente, con l'app pilotata da Playwright: stessa checklist del piano 12,
  funziona **dopo** aver aggirato l'installazione (sotto).

## Cosa si rompeva

| Dove | Problema | Correzione |
|---|---|---|
| `package.json` `postinstall` | `electron-rebuild … \|\| true`: `true` non esiste in `cmd.exe`, quindi un rebuild fallito fa fallire `npm install` | script Node (`scripts/postinstall.js`) che su Windows non ricompila e altrove non fa fallire l'install |
| `node-pty` su Windows | 1.1.0 si compila solo con le librerie Spectre di MSVC (non incluse nel carico C++ standard): `MSB8040` | non serve compilarlo: i `prebuilds/win32-*` sono N-API e girano in Electron (provato). Su Windows niente rebuild, niente Build Tools |
| `lib/command-profiles.js` | fuori dalle virgolette `\` è un escape POSIX: `C:\Tools\claude.exe` → `C:Toolsclaude.exe`; `~\repo` non si espande | `platform` come parametro: su `win32` `\` è un carattere normale e `~\` si espande |
| `lib/opencode-sessions.js`, `lib/usage/opencode-usage.js` | `execFile` su `opencode.cmd` (npm -g): Node ≥ 18.20.2 lo rifiuta con `spawn EINVAL` (CVE-2024-27980). Resume OpenCode e usage rotti | un `.cmd`/`.bat` passa da `cmd.exe /d /s /c` con la riga di `lib/win-command.js` |
| checkout Windows | `core.autocrlf=true` e nessun `.gitattributes`: tutto in CRLF (anche `app/tmux.conf`, `scripts/*.sh`) | `.gitattributes` con `* text=auto eol=lf` |
| test | 24 test presumono un host Unix: chiamano funzioni senza `platform` (il default è `process.platform`), confrontano path con `/`, verificano i permessi `0o600` e il bit `x` che Windows non ha, usano `/bin/sh` | `platform: 'linux'` esplicito; `t.skip` su win32 solo dove il comportamento è davvero solo Unix (permessi) |

## CI

`ci.yml` gira anche su `windows-2022`: i casi `platform: 'win32'` iniettati
restano, ma adesso la suite deve passare anche sull'host Windows.

Il job Windows di `release.yml` e `npm run dist:win` passano
`-c.npmRebuild=false`: il pacchetto usa i prebuilds di node-pty, come il
setup costruito e installato a mano durante la prova (funziona), e non
dipende più dalla versione di Visual Studio del runner.

## `npm run install:win`

Il gemello di `install:mac` (richiesto durante la prova): `scripts/install-win.js`
si ferma se PizzaManager è aperta (il setup non sovrascrive un .exe in uso),
lancia `dist:win` e poi il setup NSIS in silenzio (`/S`): installazione per
utente in `%LOCALAPPDATA%\Programs\PizzaManager`, collegamento nel menu Start,
come chi scarica il setup dalla Release. Provato: installa, aggiorna una copia
già installata, e con l'app aperta si rifiuta prima di costruire.

## Stato

Suite su Windows: 537 passano, 11 saltati (permessi POSIX, `/bin/sh`,
integrazioni coi tool non installati). Smoke test dell'app da sorgente dopo
un `npm install` pulito e del setup `dist:win` installato: checklist del
piano 12 tutta verde. Da fare dopo il merge: vedere verde la CI Windows e
fare una release (la v1.0.2 scaricabile oggi è indietro di 41 commit).

## Fuori scope (annotati, non fatti qui)

- La sidebar e le directory recenti mostrano `Desktop/PizzaManager` con `/`
  anche su Windows (cosmetico).
- `cwdFromProjectDir` è il fallback senza `cwd` nel `.jsonl`: i `-` diventano
  separatori (`blood-glucose` → `blood\glucose`). Lossy per costruzione, come
  su Unix.
- `pickAutoSession` confronta i cwd come stringhe: `c:\` vs `C:\` non
  combacerebbero. Non osservato nella prova.
