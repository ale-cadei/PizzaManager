'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { worktreeProjectDir } = require('./worktree-path');

/**
 * Directory davvero usata dal pty.
 *
 * La scheda deve conoscerla: il titolo automatico riconosce la conversazione
 * confrontando le directory, quindi un `~/progetto` non espanso o una directory
 * inesistente gli farebbero cercare a vuoto. Tutto cio' che non e' una
 * directory esistente finisce nella home, che e' dove il pty parte davvero.
 */
function resolveWorkdir(cwd, options = {}) {
  return describeWorkdir(cwd, options).dir;
}

/**
 * Come resolveWorkdir, e in più dice se la sessione è stata spostata e da
 * dove, perché la scheda lo scriva: chi riprende una conversazione deve
 * sapere che non è più dove era.
 * - `moved: 'worktree'`: la cartella stava in `<progetto>.worktrees/` e non c'è
 *   più (un worktree unito o buttato): si parte nel progetto, dove il lavoro
 *   è stato unito o il branch c'è ancora (docs/plans/36, passo 7);
 * - `moved: 'missing'`: qualsiasi altra cartella sparita: si parte nella home.
 * @returns {{dir: string, moved: null|'worktree'|'missing', requested: string|null}}
 */
function describeWorkdir(cwd, { home = os.homedir(), isDir = defaultIsDir } = {}) {
  const raw = String(cwd || '').trim();
  if (!raw) return { dir: home, moved: null, requested: null };
  // `~\progetto` su Windows vale quanto `~/progetto`
  const expanded = raw === '~' || /^~[\\/]/.test(raw) ? path.join(home, raw.slice(1)) : raw;
  const abs = path.resolve(expanded);
  if (isDir(abs)) return { dir: abs, moved: null, requested: abs };
  const project = worktreeProjectDir(abs);
  if (project && isDir(project)) return { dir: project, moved: 'worktree', requested: abs };
  return { dir: home, moved: 'missing', requested: abs };
}

function defaultIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

module.exports = { resolveWorkdir, describeWorkdir };
