/* Icone dell'albero della scheda editor (docs/plans/70): cartella aperta o
 * chiusa, file per nome noto o per estensione. Le SVG sono di Material Icon
 * Theme (MIT, THIRD-PARTY-NOTICES.md) e stanno in renderer/file-icons/,
 * caricate con <img>: img-src 'self' della CSP le ammette già.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessFileIcons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const DIR = 'file-icons';
  const FALLBACK = 'file';

  // Nome intero del file (minuscolo) → icona. Vince sull'estensione.
  const NAMES = {
    'package.json': 'npm', 'package-lock.json': 'npm', '.npmrc': 'npm', '.npmignore': 'npm',
    'yarn.lock': 'yarn', '.yarnrc': 'yarn', 'pnpm-lock.yaml': 'pnpm', 'pnpm-workspace.yaml': 'pnpm',
    'bun.lock': 'bun', 'bun.lockb': 'bun', '.nvmrc': 'nodejs', '.node-version': 'nodejs',
    dockerfile: 'docker', '.dockerignore': 'docker', 'docker-compose.yml': 'docker',
    'docker-compose.yaml': 'docker', 'compose.yml': 'docker', 'compose.yaml': 'docker',
    makefile: 'makefile', gnumakefile: 'makefile', 'cmakelists.txt': 'cmake',
    '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', '.gitkeep': 'git',
    license: 'license', 'license.md': 'license', 'license.txt': 'license', copying: 'license',
    readme: 'readme', 'readme.md': 'readme', 'readme.txt': 'readme',
    'tsconfig.json': 'tsconfig', 'jsconfig.json': 'tsconfig',
    '.editorconfig': 'editorconfig', '.babelrc': 'babel',
    'cargo.toml': 'rust', 'go.mod': 'go-mod', 'go.sum': 'go-mod',
    gemfile: 'ruby', 'gemfile.lock': 'ruby', 'pom.xml': 'maven',
    'build.gradle': 'gradle', 'settings.gradle': 'gradle', 'nginx.conf': 'nginx',
    vagrantfile: 'vagrant', '.bashrc': 'console', '.zshrc': 'console', '.profile': 'console',
  };

  // Inizio del nome (minuscolo) → icona: file di config con varianti di estensione
  const PREFIXES = [
    ['.env', 'tune'], ['.prettierrc', 'prettier'], ['prettier.config.', 'prettier'],
    ['.eslintrc', 'eslint'], ['eslint.config.', 'eslint'], ['babel.config.', 'babel'],
    ['vite.config.', 'vite'], ['vitest.config.', 'vitest'], ['webpack.config.', 'webpack'],
    ['jest.config.', 'jest'], ['playwright.config.', 'playwright'], ['tailwind.config.', 'tailwindcss'],
    ['tsconfig.', 'tsconfig'],
  ];

  // Estensione (minuscola, anche composta come `d.ts`) → icona
  const EXTENSIONS = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', 'js.map': 'javascript-map',
    ts: 'typescript', mts: 'typescript', cts: 'typescript', 'd.ts': 'typescript-def',
    jsx: 'react', tsx: 'react_ts', vue: 'vue', svelte: 'svelte', astro: 'astro',
    json: 'json', jsonc: 'json', json5: 'json',
    md: 'markdown', markdown: 'markdown', mdx: 'mdx', tex: 'tex',
    html: 'html', htm: 'html', ejs: 'ejs', hbs: 'handlebars', pug: 'pug',
    css: 'css', scss: 'sass', sass: 'sass', less: 'less', styl: 'stylus',
    xml: 'xml', xsd: 'xml', xsl: 'xml', plist: 'xml', xaml: 'xaml', svg: 'svg',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
    ico: 'image', avif: 'image', tif: 'image', tiff: 'image', icns: 'image',
    py: 'python', pyw: 'python', pyi: 'python', ipynb: 'jupyter',
    rs: 'rust', go: 'go', java: 'java', jar: 'java', kt: 'kotlin', kts: 'kotlin',
    swift: 'swift', dart: 'dart', c: 'c', h: 'h',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
    m: 'objective-c', cs: 'csharp', fs: 'fsharp', fsx: 'fsharp',
    rb: 'ruby', php: 'php', lua: 'lua', pl: 'perl', pm: 'perl', r: 'r',
    scala: 'scala', hs: 'haskell', ex: 'elixir', exs: 'elixir', erl: 'erlang',
    clj: 'clojure', cljs: 'clojure', zig: 'zig', nim: 'nim', ml: 'ocaml', jl: 'julia',
    groovy: 'groovy', gradle: 'gradle', coffee: 'coffee', nix: 'nix', asm: 'assembly',
    sh: 'console', bash: 'console', zsh: 'console', fish: 'console', bat: 'console', cmd: 'console',
    ps1: 'powershell', psm1: 'powershell', psd1: 'powershell', vim: 'vim',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'settings', cfg: 'settings', conf: 'settings',
    properties: 'settings', env: 'tune',
    sql: 'database', db: 'database', sqlite: 'database', sqlite3: 'database',
    graphql: 'graphql', gql: 'graphql', proto: 'proto', tf: 'terraform', http: 'http',
    csv: 'table', tsv: 'table', xls: 'table', xlsx: 'table', ods: 'table',
    doc: 'word', docx: 'word', odt: 'word', ppt: 'powerpoint', pptx: 'powerpoint', pdf: 'pdf',
    zip: 'zip', tar: 'zip', gz: 'zip', tgz: 'zip', bz2: 'zip', xz: 'zip', '7z': 'zip', rar: 'zip',
    deb: 'zip', rpm: 'zip', dmg: 'zip',
    txt: 'document', log: 'log', lock: 'lock', diff: 'diff', patch: 'diff',
    key: 'key', pem: 'key', pub: 'key', crt: 'certificate', cer: 'certificate',
    ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio',
    mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', avi: 'video',
    exe: 'exe', dll: 'exe', msi: 'exe',
  };

  const ALL_ICONS = [...new Set(['folder', 'folder-open', FALLBACK,
    ...Object.values(NAMES), ...PREFIXES.map(([, icon]) => icon), ...Object.values(EXTENSIONS)])];

  /** Le estensioni del nome, dalla più lunga: `a.d.ts` → ['d.ts', 'ts']. */
  function extensionsOf(lower) {
    const parts = lower.split('.').slice(1); // il primo pezzo è il nome (o vuoto per i dotfile)
    return parts.map((_, i) => parts.slice(i).join('.')).filter(Boolean);
  }

  /**
   * @param {{ name: string, kind: 'dir'|'file', expanded?: boolean }} row
   * @returns {string} il nome dell'icona, senza `.svg`
   */
  function iconOf({ name, kind, expanded = false }) {
    if (kind === 'dir') return expanded ? 'folder-open' : 'folder';
    const lower = name.toLowerCase();
    if (NAMES[lower]) return NAMES[lower];
    const prefix = PREFIXES.find(([p]) => lower.startsWith(p));
    if (prefix) return prefix[1];
    const ext = extensionsOf(lower).find((e) => EXTENSIONS[e]);
    return ext ? EXTENSIONS[ext] : FALLBACK;
  }

  /** Percorso dell'SVG, relativo a renderer/index.html. */
  const iconUrl = (row) => `${DIR}/${iconOf(row)}.svg`;

  return { iconOf, iconUrl, ALL_ICONS };
});
