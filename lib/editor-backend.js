'use strict';
/* Dove stanno i file di una scheda editor (docs/plans/94). Il renderer
 * manda come `root` una stringa (cartella di questo computer, come sempre)
 * o `{ env, dir }` (cartella su un server SSH). Qui si valida e si sceglie
 * il backend: lib/editor-fs.js o lib/editor-remote-fs.js, con quello che
 * serve ai moduli git (radice risolta, resolve, run, walkFiles). */
const { createEditorFs } = require('./editor-fs');
const { createEditorRemoteFs } = require('./editor-remote-fs');
const { parseEnvKey, validateRemoteDir } = require('./remote-env');

const MAX_CACHED = 64;

/**
 * @typedef {{ remote: boolean, envKey: string|null, files: object,
 *   realRoot: () => Promise<string>, resolve: (rel: string) => string|Promise<string>,
 *   run?: Function, walkFiles?: Function }} EditorBackend
 */

/**
 * @param {{ channels: {get: (envKey: string) => {request: Function}}, platform?: string }} o
 *   `channels` di lib/remote-channel.js (createRemoteChannels)
 */
function createEditorBackends({ channels, platform = process.platform }) {
  // Un editor-remote-fs per cartella: la radice risolta sul server si chiede una volta
  const remote = new Map();

  function local(dir) {
    const files = createEditorFs({ root: dir, platform });
    return { remote: false, envKey: null, files, realRoot: async () => files.realRoot, resolve: files.resolveInside };
  }

  function remoteFor(envKey, rawDir) {
    const env = parseEnvKey(envKey);
    if (!env) throw new Error('Ambiente non valido: ' + envKey);
    if (env.kind === 'local') return local(rawDir);
    if (env.kind !== 'ssh') throw new Error('L\'editor apre cartelle solo su questo computer o su un server SSH.');
    const d = validateRemoteDir(rawDir);
    if (!d.ok) throw new Error(d.error);
    const key = `${envKey}\n${d.dir}`;
    let files = remote.get(key);
    if (!files) {
      if (remote.size >= MAX_CACHED) remote.delete(remote.keys().next().value);
      // Il canale si chiede a ogni richiesta: chiuso per inattività, il prossimo lo riapre
      const channel = { request: (...a) => channels.get(envKey).request(...a) };
      files = createEditorRemoteFs({ channel, dir: d.dir });
      remote.set(key, files);
    }
    return { remote: true, envKey, files, realRoot: files.realRoot, resolve: files.resolveInside, run: files.run, walkFiles: files.walkFiles };
  }

  /**
   * @param {unknown} root stringa o `{ env, dir }`
   * @returns {EditorBackend} lancia se `root` non è valida
   */
  function backendFor(root) {
    if (typeof root === 'string') return local(root);
    if (root && typeof root === 'object' && typeof root.env === 'string') return remoteFor(root.env, root.dir);
    throw new Error('cartella della sessione mancante');
  }

  /** Per editor-git, editor-index, editor-definition: stessa radice, git dove stanno i file. */
  async function gitOptions(root) {
    const b = backendFor(root);
    const realRoot = await b.realRoot();
    return { root: realRoot, realRoot, resolve: b.resolve, run: b.run, walkFiles: b.walkFiles };
  }

  return { backendFor, gitOptions };
}

module.exports = { createEditorBackends };
