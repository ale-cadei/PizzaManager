const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const I = require('../renderer/file-icons');

const ICON_DIR = path.join(__dirname, '..', 'renderer', 'file-icons');
const file = (name) => I.iconOf({ name, kind: 'file' });

ok('iconOf: le cartelle hanno la cartella, aperta o chiusa', () => {
  assert.strictEqual(I.iconOf({ name: 'src', kind: 'dir', expanded: false }), 'folder');
  assert.strictEqual(I.iconOf({ name: 'src', kind: 'dir', expanded: true }), 'folder-open');
  // Anche se il nome sembra un file
  assert.strictEqual(I.iconOf({ name: 'pkg.json', kind: 'dir' }), 'folder');
});

ok('iconOf: i file per estensione, senza badare alle maiuscole', () => {
  assert.strictEqual(file('main.js'), 'javascript');
  assert.strictEqual(file('App.TSX'), 'react_ts');
  assert.strictEqual(file('styles.css'), 'css');
  assert.strictEqual(file('foto.JPEG'), 'image');
  assert.strictEqual(file('script.py'), 'python');
  assert.strictEqual(file('archivio.tar.gz'), 'zip');
});

ok('iconOf: l estensione composta vince su quella semplice', () => {
  assert.strictEqual(file('types.d.ts'), 'typescript-def');
  assert.strictEqual(file('bundle.js.map'), 'javascript-map');
  assert.strictEqual(file('x.ts'), 'typescript');
});

ok('iconOf: i nomi noti vincono sull estensione', () => {
  assert.strictEqual(file('package.json'), 'npm');
  assert.strictEqual(file('README.md'), 'readme');
  assert.strictEqual(file('Dockerfile'), 'docker');
  assert.strictEqual(file('.gitignore'), 'git');
  assert.strictEqual(file('tsconfig.json'), 'tsconfig');
  assert.strictEqual(file('LICENSE'), 'license');
  assert.strictEqual(file('.env.local'), 'tune');
  assert.strictEqual(file('vite.config.ts'), 'vite');
  assert.strictEqual(file('.eslintrc.json'), 'eslint');
});

ok('iconOf: senza estensione nota il file generico', () => {
  assert.strictEqual(file('senza-estensione'), 'file');
  assert.strictEqual(file('strano.qwerty'), 'file');
  assert.strictEqual(file('.qualcosa'), 'file');
  assert.strictEqual(file('finisce.'), 'file');
});

ok('iconUrl: percorso relativo alla pagina, nella cartella delle icone', () => {
  assert.strictEqual(I.iconUrl({ name: 'a.js', kind: 'file' }), 'file-icons/javascript.svg');
});

ok('ogni icona che la mappa nomina c e sul disco, e nessuna di troppo', () => {
  const onDisk = fs.readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
  assert.deepStrictEqual(onDisk, [...I.ALL_ICONS].sort());
});

// Le SVG arrivano da un pacchetto esterno: dentro un <img> uno script non
// parte comunque, ma non ce lo portiamo dietro
ok('le SVG sono solo disegno: niente script, handler o risorse esterne', () => {
  for (const f of fs.readdirSync(ICON_DIR).filter((n) => n.endsWith('.svg'))) {
    const src = fs.readFileSync(path.join(ICON_DIR, f), 'utf8');
    assert.doesNotMatch(src, /<script|\son\w+=|href="(?!#)|<foreignObject/i, f);
  }
});
