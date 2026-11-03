# 85 — `fix/worktree-agenti-nascosti`: i worktree dei sub-agenti non si elencano

Dipende da: 36 (sessione in un worktree).
Taglia: ~30min.

## Perché

Claude Code, quando lancia un sub-agente con `isolation: "worktree"`, crea un
worktree git in `<progetto>/.claude/worktrees/agent-<id>`. `listWorktrees`
elenca tutto ciò che dice `git worktree list`, quindi in FinanceManager la
barra mostrava sette worktree `agent-*` accanto a quelli dell'utente.

## Cosa fa

- `listWorktrees` salta i worktree il cui percorso finisce in
  `.claude/worktrees/<nome>` (anche con `\` su Windows).
- Restano visibili quelli in `<progetto>.worktrees/` **e** quelli creati a mano
  con `git worktree add` altrove: si filtra solo ciò che è di Claude Code.

## Come

- `isAgentWorktree(dir)` in `lib/worktree-path.js` (solo stringhe).
- Filtro in `listWorktrees` (`lib/worktree.js`) accanto a `prunable`/`bare`.
- Il grafo (`lib/git-graph-worktree.js`) non cambia: lì le punte dei branch
  servono comunque.

## Test

- `tests/worktree.test.js`: elenco con un worktree dell'app, uno di un agente
  (locked) e uno manuale altrove; caso Windows.
