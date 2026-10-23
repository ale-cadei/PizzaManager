# 67 — il versionamento torna nel repo del codice

`chore/versionamento-qui`

## Il problema

Le release stavano su `JackGrieco/PizzaManager-releases`, un secondo repo che
conteneva solo i pacchetti, le issue delle segnalazioni e il `feedback.json`
che l'app scarica. Il codice stava qui, privato.

Quel repo esisteva per una ragione sola, scritta nel workflow al rigo 28:

> La Release vive nel repo PUBBLICO: il codice resta privato, i pacchetti sono
> release asset e non file di quel repo.

L'aggiornamento automatico scarica il manifesto **senza autenticazione**,
quindi il manifesto deve stare in un posto pubblico. L'alternativa era mettere
un token dentro l'app distribuita, cioè regalarlo a chi la scarica.

**Da quando questo repo è pubblico, quella ragione non esiste più**, e il
secondo repo è solo un pezzo di impalcatura che costa: un PAT con scadenza, un
passaggio di file fra repo, due posti dove cercare le cose, e le note di
release che non si possono generare perché là non c'è la storia.

## Cosa cambia

Tutto in `ale-cadei/PizzaManager`: codice, release, issue, feed.

| | prima | dopo |
|---|---|---|
| destinazione dei pacchetti | `JackGrieco/PizzaManager-releases` | questo repo |
| token per caricarli | PAT `PUBLIC_RELEASE_TOKEN` (scadeva il 4-10-2027) | `GITHUB_TOKEN` del workflow |
| bacheca segnalazioni | issue del repo separato | issue di questo repo |
| feed `feedback.json` | `raw.githubusercontent.com/JackGrieco/…` | `raw.githubusercontent.com/ale-cadei/PizzaManager/main/feedback.json` |
| minuti di Actions | contati (privato): macOS ×10 | gratis (pubblico, runner standard) |
| «Source code» allegato alla release | il README del repo separato | il codice vero al tag |

Il job `draft` **resta**: serviva anche a evitare che quattro build in
parallelo creassero quattro bozze dello stesso tag (successo con la v1.0.2), e
quella gara non dipende da quale repo ospita la Release.

## File toccati

- `package.json` — `build.publish` → `ale-cadei/PizzaManager`; `homepage`
- `.github/workflows/release.yml` — via `RELEASES_REPO` e il PAT, via i
  `--repo` dai tre comandi `gh`
- `.github/workflows/feedback.yml`, `.github/feedback.js` — portati qui dal
  repo separato; erano già agnostici (`REPO: ${{ github.repository }}`)
- `feedback.json` — seminato vuoto, così il feed non risponde 404 prima del
  primo giro del workflow
- `lib/feedback-source.js` — `REPO`
- `lib/update-policy.js` — `DOWNLOAD_URL`
- `tests/update-policy.test.js` — l'asserzione sull'indirizzo
- `README.md` — badge della release e cinque link di download
- `docs/rilasci/README.md` — §2 riscritta, e la §9 sui minuti: non si contano
  più
- `docs/rilasci/secret.md` — da sei secret a cinque
- `docs/rilasci/rinnovo-token.md` — **eliminato**, il PAT non c'è più

## Fuori da questo branch: le cose che non si fanno con un commit

1. **Le 6 etichette** (`stato:*` più `bug` e `enhancement`) vanno ricreate
   qui, altrimenti la bacheca nasce senza vocabolario (piano 50).
2. **I 12 asset della v1.5.0** vanno copiati sulla Release di questo repo.
   Delle sette release del repo separato è l'unica che ne ha: da 1.1.0 a 1.4.0
   sono già vuote.
3. **La bozza v1.5.1** del 9 ottobre ha 3 soli asset Linux: si butta e si
   taglia una 1.6.0 pulita da `main`.
4. **Il PAT va revocato** su GitHub → Settings → Developer settings.
5. **Cancellare il repo separato rompe l'aggiornamento automatico** di ogni
   copia già installata: l'updater continua a chiedere `latest-mac.yml` là, e
   un repo cancellato risponde 404. Lo stesso per il feed delle segnalazioni,
   che però degrada senza far cadere il pannello (è una regola di
   `lib/feedback-source.js`). Finché le copie in giro sono solo le nostre si
   reinstalla a mano; se ce ne sono altre, il repo vecchio resta in piedi
   finché non si sono aggiornate.

## Verifica

- `npm run test:unit` verde
- `grep -rn 'PizzaManager-releases' --exclude-dir=node_modules .` non trova
  niente fuori da `docs/plans/` (dove sono annotazioni storiche: i piani 18,
  44 e 50 raccontano com'era, e si lasciano come sono)
- dopo il primo tag: la bozza nasce qui, i 12 asset ci sono, e
  `https://github.com/ale-cadei/PizzaManager/releases/latest/download/PizzaManager-mac-arm64.dmg`
  scarica
