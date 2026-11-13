const assert = require('node:assert');
const { test: ok } = require('node:test');
const { filesFromClipboard, fileUriToPath, formatsFor, clipboardPayload, clipboardSelection } = require('../lib/clipboard-files');

/* Gli appunti finti: un buffer per formato, vuoto per gli altri (come fa
   clipboard.readBuffer quando il formato non c'è). */
const board = (formats) => {
  const asked = [];
  const read = (format) => { asked.push(format); return Buffer.from(formats[format] || ''); };
  return { read, asked };
};

ok('fileUriToPath: solo file:// locali, con i %xx decodificati', () => {
  assert.strictEqual(fileUriToPath('file:///tmp/a%20b.txt', 'linux'), '/tmp/a b.txt');
  assert.strictEqual(fileUriToPath('file://localhost/tmp/x', 'linux'), '/tmp/x');
  assert.strictEqual(fileUriToPath('file:///tmp/%C3%A8.txt', 'linux'), '/tmp/è.txt');
  assert.strictEqual(fileUriToPath('http://example.com/a.txt', 'linux'), null);
  assert.strictEqual(fileUriToPath('file://server/share/a.txt', 'linux'), null);
  assert.strictEqual(fileUriToPath('file:///a%2Fb', 'linux'), null);
  assert.strictEqual(fileUriToPath('niente', 'linux'), null);
  assert.strictEqual(fileUriToPath('', 'linux'), null);
});

ok('appunti GNOME: «copy» o «cut» in testa, poi un URI per riga', () => {
  const { read, asked } = board({ 'x-special/gnome-copied-files': 'copy\nfile:///tmp/a.txt\nfile:///tmp/una%20cartella' });
  assert.deepStrictEqual(filesFromClipboard(read, 'linux'), ['/tmp/a.txt', '/tmp/una cartella']);
  assert.deepStrictEqual(asked, ['x-special/gnome-copied-files'], 'trovati i file, uri-list non si legge');
  // «Taglia» nel file manager: per noi è comunque una copia
  assert.deepStrictEqual(filesFromClipboard(board({ 'x-special/gnome-copied-files': 'cut\nfile:///tmp/a.txt\n' }).read, 'linux'), ['/tmp/a.txt']);
});

ok('appunti uri-list (KDE e altri): commenti, CRLF, righe non file scartate, doppioni tolti', () => {
  const list = '# copiati da Dolphin\r\nfile:///tmp/a.txt\r\nhttp://example.com/x\r\nfile:///tmp/a.txt\r\n\r\nfile:///tmp/b.txt\r\n';
  const { read, asked } = board({ 'text/uri-list': list });
  assert.deepStrictEqual(filesFromClipboard(read, 'linux'), ['/tmp/a.txt', '/tmp/b.txt']);
  assert.deepStrictEqual(asked, ['x-special/gnome-copied-files', 'text/uri-list']);
});

ok('appunti senza file: vuoti, solo testo, o un formato che non si legge', () => {
  assert.deepStrictEqual(filesFromClipboard(board({}).read, 'linux'), []);
  assert.deepStrictEqual(filesFromClipboard(board({ 'text/uri-list': 'https://example.com\n' }).read, 'linux'), []);
  assert.deepStrictEqual(filesFromClipboard(() => { throw new Error('formato sconosciuto'); }, 'linux'), []);
  assert.deepStrictEqual(formatsFor('linux'), ['x-special/gnome-copied-files', 'text/uri-list']);
  assert.deepStrictEqual(formatsFor('darwin'), ['x-special/gnome-copied-files', 'text/uri-list']);
});

/* Copia e taglia dall'albero dell'editor (docs/plans/95): gli appunti si
   scrivono come li scrive Nautilus, e si rileggono con il flag «taglia». */
const fromPayload = ({ format, buffer }) => board({ [format]: buffer }).read;

ok('clipboardPayload: GNOME su Linux e macOS, «copy»/«cut» e URI codificati', () => {
  const p = clipboardPayload(['/tmp/a b.txt', '/tmp/è'], 'cut', 'linux');
  assert.strictEqual(p.format, 'x-special/gnome-copied-files');
  assert.strictEqual(p.buffer.toString('utf8'), 'cut\nfile:///tmp/a%20b.txt\nfile:///tmp/%C3%A8');
  assert.strictEqual(clipboardPayload(['/tmp/a'], 'copy', 'darwin').buffer.toString('utf8'), 'copy\nfile:///tmp/a');
});

ok('clipboardPayload: FileNameW su Windows, UTF-16LE con lo zero in fondo', () => {
  const p = clipboardPayload(['C:\\prj\\a.txt'], 'copy', 'win32');
  assert.strictEqual(p.format, 'FileNameW');
  assert.strictEqual(p.buffer.toString('utf16le'), 'C:\\prj\\a.txt\0');
});

ok('clipboardPayload: niente percorsi relativi, modi sconosciuti o liste vuote', () => {
  assert.throws(() => clipboardPayload(['rel/a'], 'copy', 'linux'), /percorso/i);
  assert.throws(() => clipboardPayload(['/tmp/a'], 'move', 'linux'), /copy|cut/);
  assert.throws(() => clipboardPayload([], 'copy', 'linux'), /percorso/i);
  assert.throws(() => clipboardPayload(['/tmp/a', '/tmp/b'], 'copy', 'win32'), /un solo/);
});

ok('clipboardSelection: andata e ritorno, «cut» solo se gli appunti lo dicono', () => {
  for (const mode of ['copy', 'cut']) {
    const sel = clipboardSelection(fromPayload(clipboardPayload(['/tmp/a b.txt'], mode, 'linux')), 'linux');
    assert.deepStrictEqual(sel, { paths: ['/tmp/a b.txt'], cut: mode === 'cut' });
  }
  // uri-list e FileNameW non dicono se è un taglia: null, decide chi ha scritto
  assert.deepStrictEqual(clipboardSelection(board({ 'text/uri-list': 'file:///tmp/a\n' }).read, 'linux'), { paths: ['/tmp/a'], cut: null });
  const win = clipboardPayload(['C:\\prj\\a.txt'], 'cut', 'win32');
  assert.deepStrictEqual(clipboardSelection(fromPayload(win), 'win32'), { paths: ['C:\\prj\\a.txt'], cut: null });
  assert.deepStrictEqual(clipboardSelection(board({}).read, 'linux'), { paths: [], cut: null });
});
