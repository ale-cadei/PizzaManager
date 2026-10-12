'use strict';
/* Push di un branch locale dal selettore della sessione git (docs/plans/47).
 * La PR non la apre l'app: la si apre a mano, o la apre l'agente.
 *
 * - Con l'upstream si pusha esattamente lì (`branch.<b>.remote` e `.merge`),
 *   qualunque sia `push.default`. Senza, si pubblica su `origin` (o
 *   sull'unico remoto) con `-u`, così il push dopo sa dove andare.
 * - Mai forzato, mai senza hook: se il remoto è più avanti git rifiuta e ci
 *   si ferma. Refspec sempre completo (`refs/heads/…`), senza `+`.
 * - Le credenziali sono quelle di git (ssh-agent, credential helper): l'app
 *   non chiede niente. Senza terminale git non può chiedere una password
 *   (GIT_TERMINAL_PROMPT=0 in lib/git-run.js): l'errore dice come fare.
 *
 * `run` è iniettabile: i test provano argv e controlli senza git. */
const { runGit } = require('./git-run');
const { validateBranchName } = require('./git-branches');
const { openRepo, verify } = require('./git-changes');
const { writeError } = require('./git-commit');

/* La rete e un hook pre-push possono metterci più di un hook di commit */
const PUSH_TIMEOUT_MS = 120 * 1000;
const HEADS = 'refs/heads/';
/* Con LC_ALL=C (lib/git-run.js) i messaggi sono sempre in inglese */
const REJECTED_RE = /\[rejected\]|non-fast-forward|fetch first/i;
const AUTH_RE = /could not read (username|password)|terminal prompts disabled|authentication failed|permission denied \(publickey|host key verification failed|could not read from remote repository/i;

async function configValue(run, root, key) {
  return run(['config', '--get', key], { cwd: root }).then((t) => t.trim() || null, () => null);
}

/* Un remoto che comincia con `-` git lo leggerebbe come un'opzione */
const badRemote = (remote) => !remote || remote.startsWith('-');

/* Dove va un branch senza upstream: origin, o l'unico remoto che c'è */
async function pickRemote(run, root, name) {
  const remotes = (await run(['remote'], { cwd: root })).split('\n').map((r) => r.trim()).filter(Boolean);
  if (!remotes.length) return { error: 'Il repository non ha remoti: aggiungine uno dal terminale (git remote add origin <url>).' };
  if (remotes.includes('origin')) return { remote: 'origin' };
  if (remotes.length === 1) return { remote: remotes[0] };
  return { error: `Ci sono più remoti (${remotes.join(', ')}) e nessuno si chiama origin: fai il primo push dal terminale (git push -u <remoto> ${name}).` };
}

/* Dove pushare il branch: remoto e ramo di arrivo, o il motivo per cui no */
async function pushTarget(run, root, name) {
  if (!await verify(run, root, `${HEADS}${name}^{commit}`)) return { error: `Il branch ${name} non c'è più.` };
  const remote = await configValue(run, root, `branch.${name}.remote`);
  const merge = await configValue(run, root, `branch.${name}.merge`);
  if (remote && merge) {
    if (remote === '.') return { error: `${name} segue un altro branch locale (${merge.replace(HEADS, '')}): non c'è un remoto su cui pusharlo.` };
    if (!merge.startsWith(HEADS) || validateBranchName(merge.slice(HEADS.length))) return { error: `L'upstream di ${name} (${merge}) non è un branch: fai il push dal terminale.` };
    if (badRemote(remote)) return { error: `"${remote}" non è un nome di remoto valido.` };
    return { remote, dest: merge, created: false };
  }
  // Mezza configurazione: pubblicare altrove sarebbe una sorpresa
  if (remote || merge) return { error: `L'upstream di ${name} è configurato a metà (branch.${name}.remote / .merge): sistemalo dal terminale.` };
  const picked = await pickRemote(run, root, name);
  if (picked.error) return picked;
  if (badRemote(picked.remote)) return { error: `"${picked.remote}" non è un nome di remoto valido.` };
  return { remote: picked.remote, dest: `${HEADS}${name}`, created: true };
}

/* L'errore di git, più cosa fare quando si sa */
function pushError(e) {
  if (e && e.killed) {
    return { ok: false, error: `Push: nessuna risposta dopo ${PUSH_TIMEOUT_MS / 1000} s, interrotto. Se git aspettava una password o la passphrase della chiave, fai un push dal terminale una volta.` };
  }
  // Le righe `hint:` di git suggeriscono comandi: il consiglio qui sotto le sostituisce
  const output = writeError(e, 'Push').split('\n').filter((l) => !l.startsWith('hint:')).join('\n').trim();
  if (REJECTED_RE.test(output)) {
    return { ok: false, rejected: true, error: `${output}\n\nIl remoto ha commit che questo branch non ha: fai pull o rebase dal terminale, poi riprova. Da qui non si forza.` };
  }
  if (AUTH_RE.test(output)) {
    return { ok: false, error: `${output}\n\nGit non è riuscito ad autenticarsi senza terminale: fai un push dal terminale una volta (o carica la chiave in ssh-agent), poi riprova da qui.` };
  }
  return { ok: false, error: output };
}

/**
 * Push di un branch locale, su upstream o pubblicandolo con `-u`.
 * @param {{cwd: string, name: string, run?: Function, platform?: string}} o
 * @returns {Promise<{ok: true, branch: string, remote: string, upstream: string, created: boolean}
 *   | {ok: false, reason?: 'not-a-repo', rejected?: boolean, error?: string}>}
 */
async function pushBranch(o = {}) {
  const { name, run = runGit, platform = process.platform } = o;
  if (typeof name !== 'string' || validateBranchName(name)) {
    return { ok: false, error: `"${typeof name === 'string' ? name : ''}" non è un nome di branch valido.` };
  }
  const repo = await openRepo({ cwd: o.cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const { root } = repo;
  let target;
  try {
    target = await pushTarget(run, root, name);
  } catch (e) {
    return { ok: false, error: writeError(e, 'Push') };
  }
  if (target.error) return { ok: false, error: target.error };
  const { remote, dest, created } = target;
  const args = ['push', ...(created ? ['-u'] : []), remote, `${HEADS}${name}:${dest}`];
  try {
    await run(args, { cwd: root, timeout: PUSH_TIMEOUT_MS });
  } catch (e) {
    return pushError(e);
  }
  return { ok: true, branch: name, remote, upstream: `${remote}/${dest.slice(HEADS.length)}`, created };
}

module.exports = { pushBranch, PUSH_TIMEOUT_MS };
