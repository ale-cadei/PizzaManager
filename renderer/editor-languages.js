/* Linguaggio di un file della scheda editor (docs/plans/74). Monaco da sé
 * guarda solo estensioni e pochi nomi suoi: `.env`, `.gitignore`, `Makefile`,
 * `.toml`, `.bashrc`… uscivano in testo semplice. Qui il nome del file sceglie
 * il linguaggio (stesso schema di file-icons.js), e per quelli che Monaco non
 * ha ci sono le grammatiche Monarch. Un file sconosciuto resta a Monaco.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorLanguages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // Nome intero del file (minuscolo) → linguaggio. Vince sull'estensione.
  const NAMES = {
    '.env': 'dotenv',
    '.envrc': 'shell', '.bashrc': 'shell', '.bash_profile': 'shell', '.bash_aliases': 'shell',
    '.bash_logout': 'shell', '.zshrc': 'shell', '.zshenv': 'shell', '.zprofile': 'shell', '.zlogin': 'shell',
    '.profile': 'shell', '.kshrc': 'shell', '.xprofile': 'shell', '.tmux.conf': 'shell', 'tmux.conf': 'shell',
    pkgbuild: 'shell', apkbuild: 'shell',
    '.npmrc': 'ini', '.yarnrc': 'ini', '.gitmodules': 'ini', '.gitconfig': 'ini', '.pypirc': 'ini',
    '.flake8': 'ini', '.pylintrc': 'ini', pylintrc: 'ini', '.coveragerc': 'ini', 'setup.cfg': 'ini', 'tox.ini': 'ini',
    '.prettierrc': 'json', '.babelrc': 'json', '.eslintrc': 'json', '.jshintrc': 'json', '.swcrc': 'json',
    '.watchmanconfig': 'json', 'composer.lock': 'json', 'flake.lock': 'json',
    'cargo.lock': 'toml', 'poetry.lock': 'toml', 'uv.lock': 'toml', pipfile: 'toml',
    makefile: 'makefile', gnumakefile: 'makefile',
    dockerfile: 'dockerfile', containerfile: 'dockerfile',
    gemfile: 'ruby', rakefile: 'ruby', podfile: 'ruby', vagrantfile: 'ruby', brewfile: 'ruby', guardfile: 'ruby',
    codeowners: 'ignore',
  };

  // Inizio del nome (minuscolo) → linguaggio: varianti con un suffisso
  const PREFIXES = [['.env.', 'dotenv'], ['dockerfile.', 'dockerfile'], ['containerfile.', 'dockerfile']];

  // Ultima estensione (minuscola) → linguaggio
  const EXTENSIONS = {
    env: 'dotenv', toml: 'toml', mk: 'makefile', dockerfile: 'dockerfile',
    zsh: 'shell', ksh: 'shell',
    cfg: 'ini', conf: 'ini', cnf: 'ini', service: 'ini', socket: 'ini', timer: 'ini', desktop: 'ini',
    jsonc: 'json', json5: 'json', 'code-workspace': 'json', webmanifest: 'json', ipynb: 'json',
  };

  /**
   * @param {string} rel percorso relativo, con `/` o `\`
   * @returns {string|undefined} id del linguaggio, o undefined: decide Monaco
   */
  function languageFor(rel) {
    if (typeof rel !== 'string') return undefined;
    const name = rel.split(/[\\/]/).pop().toLowerCase();
    if (!name) return undefined;
    if (NAMES[name]) return NAMES[name];
    const prefix = PREFIXES.find(([p]) => name.startsWith(p));
    if (prefix) return prefix[1];
    // .gitignore, .dockerignore, .prettierignore… hanno tutti lo stesso formato
    if (/^\.[\w-]*ignore$/.test(name)) return 'ignore';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? EXTENSIONS[name.slice(dot + 1)] : undefined;
  }

  // Commenti con #, parentesi e virgolette che si chiudono da sole
  const hashConfiguration = (pairs) => ({
    comments: { lineComment: '#' },
    brackets: pairs.filter(([o]) => o !== '"' && o !== "'"),
    autoClosingPairs: pairs.map(([open, close]) => ({ open, close })),
    surroundingPairs: pairs.map(([open, close]) => ({ open, close })),
  });
  const QUOTES = [['"', '"'], ["'", "'"]];
  const BRACKETS = [['{', '}'], ['[', ']'], ['(', ')']];

  /* Grammatiche Monarch. Solo token che il tema vs-dark ereditato colora già
     (comment, key, string, variable, keyword, number, metatag, type, regexp,
     delimiter): `operator`, per dire, lì non ha colore. Ogni stato finisce con una regola che prende
     un carattere qualsiasi, così il tokenizzatore non si pianta mai. */
  const LANGUAGES = [
    {
      id: 'dotenv',
      monarch: {
        tokenizer: {
          root: [
            [/^\s*#.*$/, 'comment'],
            [/^(\s*)(export)(\s+)([A-Za-z_][\w.-]*)(\s*)(=)/, ['', 'keyword', '', 'key', '', 'delimiter']],
            [/^(\s*)([A-Za-z_][\w.-]*)(\s*)(=)/, ['', 'key', '', 'delimiter']],
            [/\$\{[^}]*\}|\$\w+/, 'variable'],
            [/"/, 'string', '@dstring'],
            [/'[^']*'/, 'string'],
            [/\s+#.*$/, 'comment'],
            [/[^\s#"'$]+/, 'string'],
            [/\s+/, ''],
            [/./, 'string'],
          ],
          dstring: [
            [/\$\{[^}]*\}|\$\w+/, 'variable'],
            [/\\./, 'string.escape'],
            [/[^"\\$]+/, 'string'],
            [/"/, 'string', '@pop'],
            [/./, 'string'],
          ],
        },
      },
      configuration: hashConfiguration([...BRACKETS.slice(0, 1), ...QUOTES]),
    },
    {
      id: 'ignore',
      monarch: {
        tokenizer: {
          root: [
            [/^\s*#.*$/, 'comment'],
            [/^!/, 'keyword'], // negazione
            [/\\./, 'string.escape'],
            [/\*\*|[*?]/, 'keyword'],
            [/\[[^\]]*\]/, 'regexp'],
            [/\//, 'delimiter'],
            [/[^\\*?[/!#\s]+/, ''],
            [/\s+/, ''],
            [/./, ''],
          ],
        },
      },
      configuration: hashConfiguration([['[', ']']]),
    },
    {
      id: 'toml',
      monarch: {
        tokenizer: {
          root: [
            [/#.*$/, 'comment'],
            [/^\s*\[\[[^\]]*\]\]/, 'metatag'],
            [/^\s*\[[^\]]*\]/, 'metatag'],
            [/^(\s*)([A-Za-z0-9_.-]+|"[^"]*"|'[^']*')(\s*)(=)/, ['', 'key', '', 'delimiter']],
            [/"""/, 'string', '@mlstring'],
            [/'''/, 'string', '@mlliteral'],
            [/"/, 'string', '@string'],
            [/'[^']*'/, 'string'],
            [/\b(?:true|false)\b/, 'keyword'],
            [/[A-Za-z0-9_-]+(?=\s*=)/, 'key'],
            [/\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:\d{2})?/, 'number'],
            [/[+-]?(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|inf\b|nan\b)/, 'number'],
            [/[{}[\],=]/, 'delimiter'],
            [/[A-Za-z_][\w-]*/, ''],
            [/\s+/, ''],
            [/./, ''],
          ],
          string: [
            [/\\./, 'string.escape'],
            [/[^"\\]+/, 'string'],
            [/"/, 'string', '@pop'],
          ],
          mlstring: [
            [/"""/, 'string', '@pop'],
            [/\\./, 'string.escape'],
            [/[^"\\]+/, 'string'],
            [/./, 'string'],
          ],
          mlliteral: [
            [/'''/, 'string', '@pop'],
            [/[^']+/, 'string'],
            [/./, 'string'],
          ],
        },
      },
      configuration: hashConfiguration([...BRACKETS.slice(0, 2), ...QUOTES]),
    },
    {
      id: 'makefile',
      monarch: {
        tokenizer: {
          root: [
            [/#.*$/, 'comment'],
            [/^(\s*)(-?include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|unexport|override|vpath)\b/,
              ['', 'keyword']],
            [/^(\s*)([A-Za-z_][\w.-]*)(\s*)(::=|:=|\?=|\+=|!=|=)/, ['', 'key', '', 'delimiter']],
            [/^(\.[A-Z_]+)(\s*)(:)/, ['keyword', '', 'delimiter']],
            [/^([^:#=\s][^:#=]*?)(\s*)(::?)(?!=)/, ['type', '', 'delimiter']],
            [/\$[({][^)}]*[)}]/, 'variable'],
            [/\$[@<^+?*%|$]|\$\w/, 'variable'],
            [/"[^"]*"|'[^']*'/, 'string'],
            [/[^$#"'\s]+/, ''],
            [/\s+/, ''],
            [/./, ''],
          ],
        },
      },
      configuration: hashConfiguration([...BRACKETS, ...QUOTES]),
    },
  ];

  const registered = new WeakSet();

  /** Registra le grammatiche in Monaco, una volta per istanza. */
  function registerLanguages(monaco) {
    if (registered.has(monaco)) return;
    registered.add(monaco);
    for (const { id, monarch, configuration } of LANGUAGES) {
      monaco.languages.register({ id });
      monaco.languages.setMonarchTokensProvider(id, monarch);
      monaco.languages.setLanguageConfiguration(id, configuration);
    }
  }

  return { languageFor, LANGUAGES, registerLanguages };
});
