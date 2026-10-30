# 74 — `feat/evidezia-sintassi`: evidenziazione anche per i file di config

Dipende da: 60 (sessione editor, Monaco). Taglia: ~mezza giornata.

## Perché

La scheda editor lascia scegliere il linguaggio a Monaco, che guarda solo
estensioni e pochi nomi suoi. `.env`, `.gitignore`, `Makefile`, `.toml`,
`.bashrc`, `Dockerfile.dev`, `.prettierrc`, `.npmrc`… escono in testo semplice,
tutto grigio. Sono proprio i file che si toccano spesso a mano.

## Cosa fa

- Un file con nome o estensione nota apre col suo linguaggio:
  - linguaggi di Monaco presi per nome: `.bashrc`/`.zshrc`/`.profile`/`*.zsh`
    → shell; `.npmrc`, `.gitmodules`, `*.cfg`, `*.conf`, `*.service`,
    `*.desktop` → ini; `.prettierrc`, `.babelrc`, `.eslintrc`, `*.jsonc`,
    `tsconfig.*.json` → json; `Dockerfile.*`, `*.Dockerfile` → dockerfile;
    `Gemfile.lock`/`Rakefile`… → come Monaco.
  - linguaggi nuovi (grammatiche Monarch scritte qui, Monaco non li ha):
    **dotenv** (`.env`, `.env.*`, `*.env`), **ignore** (`.gitignore`,
    `.dockerignore`, `.npmignore`, `.prettierignore`, `.eslintignore`…),
    **toml** (`*.toml`, `Cargo.lock`, `poetry.lock`), **makefile**
    (`Makefile`, `GNUmakefile`, `*.mk`).
- Gli altri file: decide Monaco come prima.
- Rinomina: il model nuovo prende il linguaggio del nome nuovo (c'era già).

## Come

- **`renderer/editor-languages.js`** (UMD puro, testabile da Node):
  `languageFor(rel)` → id o `undefined`, per nome intero (minuscolo), inizio
  del nome, estensione — stesso schema di `file-icons.js`. `LANGUAGES`:
  le grammatiche nuove (id, nomi, `tokenizer` Monarch, commenti/parentesi).
  `registerLanguages(monaco)` le registra una volta.
- **`renderer/editor-monaco.js`**: `load()` chiama `registerLanguages`;
  `make()` passa `languageFor(rel)` a `createModel`.
- Token Monarch solo fra quelli che il tema `vs-dark` ereditato colora
  (`comment`, `key`, `string`, `variable`, `keyword`, `number`, `metatag`,
  `type`, `regexp`, `delimiter`): `operator` lì non ha colore.

## Test

- `tests/editor-languages.test.js`: nomi, prefissi, estensioni, maiuscole,
  percorsi con cartelle (anche `\` di Windows), sconosciuti → `undefined`;
  ogni grammatica ha `root` e i suoi stati citati esistono; un tokenizzatore
  minimo (le regole regex della grammatica sulla riga) riconosce commenti e
  chiavi; `registerLanguages` registra una volta sola.
- `tests/editor-monaco.test.js`: `open` passa il linguaggio a `createModel`.

## Smoke

App vera sotto xvfb, `HOME` e `TMUX_TMPDIR` isolati, guidata via CDP: scheda
editor su una cartella di prova, aperti `.env`, `.gitignore`, `Makefile`,
`pyproject.toml`, `.bashrc`, `Dockerfile.dev`, `notes.txt`. Ognuno ha il
linguaggio atteso (`getLanguageId()`) e più classi `mtk*` nelle righe; il
`.txt` resta `plaintext`. Prima, a parte: le quattro grammatiche
tokenizzate dal Monarch vero di Electron (anche stringhe toml su più righe).

## Fuori

- Scegliere il linguaggio a mano (menu nella barra).
- Grammatiche per nginx, Caddyfile, systemd specifiche (vanno su ini).
