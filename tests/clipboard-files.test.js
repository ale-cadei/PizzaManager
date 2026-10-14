const assert = require('node:assert');
const { test: ok } = require('node:test');
const { filesFromClipboard, fileUriToPath, formatsFor } = require('../lib/clipboard-files');

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
