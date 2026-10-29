'use strict';
/* Unire un branch qualsiasi nel corrente (docs/plans/54), dal selettore dei
 * branch della sessione git. «Unisci» dei worktree (lib/worktree.js) resta
 * a parte: lì si unisce il branch del worktree nella sua base e poi si butta.
 *
 * - Sempre argv. Il nome passa validateBranchName (niente `-` all'inizio) e
 *   deve esistere come ref del tipo dichiarato: un remoto omonimo di un
 *   locale si rifiuta, git unirebbe il locale.
 * - Prudente come lib/worktree.js: niente merge con file tracciati non
 *   committati o con un merge/rebase a metà; ai conflitti il merge resta a
 *   metà, da risolvere dal pannello dei conflitti (docs/plans/69) — fermo
 *   per altro motivo, invece, si annulla subito e la cartella torna com'era.
 * - `expect`: la punta del branch che la conferma ha mostrato. Se nel
 *   frattempo il branch si è spostato si rifiuta, si unirebbe altro.
 * - Hook come da terminale, con un tempo massimo (lib/git-commit.js).
 *
 * `run` ed `exists` sono iniettabili: i test provano argv e controlli senza git. */
const fs = require('fs');
const { runGit } = require('./git-run');
const { validateBranchName } = require('./git-branches');
const { openRepo, verify, parseNulList } = require('./git-changes');
const { busyWith } = require('./worktree');
const { writeError, BUSY, COMMIT_TIMEOUT_MS } = require('./git-commit');

const MERGE_TIMEOUT_MS = COMMIT_TIMEOUT_MS;
const KINDS = { local: 'refs/heads/', remote: 'refs/remotes/' };

function invalidRequest(name, kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return 'Tipo di branch sconosciuto.';
  if (typeof name !== 'string' || validateBranchName(name)) return `"${typeof name === 'string' ? name : ''}" non è un nome di branch valido.`;
  return null;
}

/* La punta del branch da unire, o il motivo per cui non si può */
async function resolveTip(run, root, name, kind) {
  const tip = await verify(run, root, `${KINDS[kind]}${name}^{commit}`);
  if (!tip) return { error: `Il branch ${name} non c'è più.` };
  if (kind === 'remote' && await verify(run, root, `refs/heads/${name}^{commit}`)) {
    return { error: `C'è anche un branch locale che si chiama ${name}: git unirebbe quello. Rinominalo, o unisci dal terminale.` };
  }
  return { tip };
}

/* I controlli prima di unire: il motivo per cui no, oppure dove e cosa si unisce */
async function mergeProblem(run, root, { name, kind, expect, exists, platform }) {
  const busy = await busyWith(run, root, exists, platform);
  if (busy) return BUSY[busy];
  const into = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root }).then((t) => t.trim() || null, () => null);
  if (!into) return 'La cartella è su un commit staccato: passa a un branch per unirci qualcosa.';
  if (kind === 'local' && name === into) return `La cartella è già su ${into}: scegli un altro branch da unire.`;
  const { tip, error } = await resolveTip(run, root, name, kind);
  if (error) return error;
  if (expect && expect !== tip) return `${name} è cambiato da quando l'hai guardato: riapri la conferma per vedere cosa porta adesso.`;
  const dirty = parseNulList(await run(['diff', '--name-only', '-z', 'HEAD'], { cwd: root }));
  if (dirty.length) return `Nella cartella ci sono modifiche non committate (${dirty.length} file): committale o mettile da parte prima di unire.`;
  const contained = await run(['merge-base', '--is-ancestor', tip, 'HEAD'], { cwd: root }).then(() => true, () => false);
  if (contained) return `${name} è già contenuto in ${into}: niente da unire.`;
  return { into, tip };
}

/* Un merge fermo sui conflitti resta a metà: si risolve dal pannello
   (docs/plans/69). Fermo per altro (un hook, il tempo) si annulla subito,
   come prima: non c'è niente da risolvere. */
async function undoMerge(run, root, name, into, error) {
  const merging = await run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).then(() => true, () => false);
  if (!merging) return { ok: false, error };
  const files = await run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: root }).then(parseNulList, () => []);
  if (files.length) {
    const list = files.map((f) => `  ${f}`).join('\n');
    return {
      ok: false, conflict: true, pending: true, root, files,
      error: `Conflitti fra ${name} e ${into}: il merge è a metà.\n\nFile in conflitto:\n${list}`,
    };
  }
  const aborted = await run(['merge', '--abort'], { cwd: root }).then(() => true, () => false);
  if (!aborted) {
    return { ok: false, conflict: true, files, error: `Il merge si è fermato e non si è potuto annullare: la cartella è a metà merge (git merge --abort).\n\n${error}` };
  }
  return { ok: false, error: `Il merge si è fermato ed è stato annullato, la cartella è com'era.\n\n${error}` };
}

/**
 * `git merge --no-edit <name>` nel branch corrente della cartella.
 * @param {{cwd: string, name: string, kind: 'local'|'remote', expect?: string|null,
 *   run?: Function, platform?: string, exists?: (p: string) => boolean}} o
 * @returns {Promise<{ok: true, branch: string, into: string, fastForward: boolean, commit: string}
 *   | {ok: false, reason?: 'not-a-repo', conflict?: boolean, pending?: boolean, root?: string, files?: string[], error?: string}>}
 */
async function mergeBranch(o = {}) {
  const { name, kind, expect = null, run = runGit, platform = process.platform, exists = fs.existsSync } = o;
  const invalid = invalidRequest(name, kind);
  if (invalid) return { ok: false, error: invalid };
  const repo = await openRepo({ cwd: o.cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const { root } = repo;
  let checked;
  try {
    checked = await mergeProblem(run, root, { name, kind, expect, exists, platform });
    if (typeof checked === 'string') return { ok: false, error: checked };
  } catch (e) {
    return { ok: false, error: writeError(e, 'Merge') };
  }
  const { into, tip } = checked;
  try {
    await run(['merge', '--no-edit', name], { cwd: root, timeout: MERGE_TIMEOUT_MS });
  } catch (e) {
    return undoMerge(run, root, name, into, writeError(e, 'Merge'));
  }
  try {
    const head = await verify(run, root, 'HEAD^{commit}');
    const commit = (await run(['rev-parse', '--short', 'HEAD'], { cwd: root })).trim();
    return { ok: true, branch: name, into, fastForward: head === tip, commit };
  } catch {
    // Il merge c'è stato: dirlo, anche se non si riesce a leggere com'è finito
    return { ok: true, branch: name, into, fastForward: false, commit: '' };
  }
}

module.exports = { mergeBranch, MERGE_TIMEOUT_MS };
