# 30 — Skill e plugin del progetto aperto, nella finestra "Plugin e skill"

Branch: `feat/plugin-skill-progetto` · Dipende da: 29 · Taglia: ~½ h

## Obiettivo

La finestra del piano 29 mostra solo ciò che sta nella home. Si aggiungono
skill, comandi e plugin **del progetto della sessione in primo piano**, in
cima a ogni scheda e segnati come "del progetto".

## Scelte

- Il progetto è la radice del repository della cartella della sessione in
  primo piano (`findProjectRoot`, lo stesso dei gruppi della sidebar). Senza
  sessione, o se la radice è la home, si vedono solo le globali: le cartelle
  della home sono già quelle globali, si vedrebbero due volte.
- Dove si guarda nel progetto:
  - **Claude**: `.claude/skills`, `.claude/commands`; lo stato dei plugin
    tiene conto di `.claude/settings.json` e `.claude/settings.local.json`
    del progetto, che vincono su quelle dell'utente come in Claude.
  - **Codex**: `.agents/skills`.
  - **opencode**: `.opencode/skill(s)`, `.claude/skills`, `.agents/skills`;
    plugin in `.opencode/plugin(s)/` e chiave `plugin` di `opencode.json(c)`
    alla radice o in `.opencode/`.
- Solo la radice del repository, non le cartelle intermedie fra la cwd e la
  radice.

## Fatto

- `listExtensions({ cwd })` → `project` (con `~`) e cartelle con
  `project: true` prima delle globali; `projectOf` in `lib/extensions/index.js`.
- IPC `list-extensions` riceve `{ cwd }`; il renderer passa la cartella della
  scheda attiva.
- La finestra scrive sotto il titolo di quale progetto si vedono le skill;
  le sezioni del progetto hanno titolo "… del progetto" e colore d'accento.
- Test in `tests/extensions.test.js`. Provato nell'app con una sessione in un
  repository con `.claude/skills`.

## Da fare / idee emerse

- Cartelle `.agents/skills` intermedie fra cwd e radice (Codex le legge).
