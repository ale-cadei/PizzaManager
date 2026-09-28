# 29 — Plugin e skill installati, consultabili dall'app

Branch: `feat/plugin-skill` · Dipende da: — · Taglia: ~½ g

## Obiettivo

Un pulsante nella barra in fondo apre una finestra con i plugin e le skill
installati per **Claude Code, Codex e opencode**, ognuno con una breve
descrizione. Si filtra per nome o descrizione. Solo consultazione: niente
installa, attiva o disattiva.

## Scelte

- Si legge il disco, non si lanciano i CLI: più veloce, niente processi, e
  funziona anche se un CLI non è nel PATH. Tutto in `lib/extensions/`, un file
  per CLI (come `lib/usage/`), `home` e `env` passati come parametri.
- Dove si guarda:
  - **Claude**: `~/.claude/plugins/installed_plugins.json` (percorso di ogni
    plugin), manifest `.claude-plugin/plugin.json`, `skills/*/SKILL.md` e
    `commands/*.md` del plugin; attivo/disattivato da `enabledPlugins` in
    `~/.claude/settings.json`. Skill e comandi dell'utente in
    `~/.claude/skills` e `~/.claude/commands`.
  - **Codex**: `[plugins."nome@marketplace"]` in `~/.codex/config.toml`
    (`enabled`) e i plugin in `~/.codex/plugins/cache/<mkt>/<nome>/<versione>`
    (la versione modificata più di recente). Skill in `~/.codex/skills` e
    `~/.agents/skills`.
  - **opencode**: file in `~/.config/opencode/plugin(s)/` (descrizione dal
    primo commento) e la chiave `plugin` di `opencode.json(c)` (pacchetti npm).
    Skill in `~/.config/opencode/skill(s)`, `~/.claude/skills`,
    `~/.agents/skills`.
- La finestra mostra da quale cartella viene ogni gruppo di skill: se due
  cartelle hanno la stessa skill si vedono entrambe, non si indovina quale
  vince.
- Descrizione: `description` del frontmatter, altrimenti la prima riga di
  testo. Tagliata a 400 caratteri; si leggono solo i primi 16 KB di ogni file.
  Tutto arriva nella pagina con `textContent`.
- Il pulsante sta accanto a `#usagebar`, non dentro: `createUsageBar` svuota
  il suo contenitore.

## Fatto

- `lib/extensions/` (`frontmatter`, `common`, `claude`, `codex`, `opencode`,
  `index`): `listExtensions({ home, env })` → un elenco per CLI; un CLI che
  fallisce ha `ok: false` e non svuota gli altri. Versione `unknown` di
  Claude nascosta; plugin senza manifest prendono la descrizione dal
  `package.json`; plugin elencati ma assenti dal disco segnati.
- IPC `list-extensions` (`main.js`, `preload.js`).
- `renderer/extensions-view.js` (UMD, filtro puro + disegno con
  `createElement`/`textContent`) e `renderer/extensions-panel.js` (apertura,
  schede, filtro). Il disco si rilegge a ogni apertura.
- Pulsante «🧩 PLUGIN E SKILL» a destra della barra dell'uso (`.bottombar`);
  la finestra si chiude con Chiudi, Esc o clic fuori.
- Test in `tests/extensions.test.js` (home finta + vista su DOM finto).
  Provato nell'app con i plugin veri: 8/7/1 plugin, filtro e schede ok.

## Da fare / idee emerse

- Antigravity non è incluso: da capire dove tiene le sue estensioni.
- Skill di progetto (`<cwd>/.claude/skills`, `.agents/skills`) per la scheda
  in primo piano.
