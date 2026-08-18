# CLAUDE.md

Working rules for this repo. Orientation and traps live in
[AGENTS.md](./AGENTS.md); status and next steps in [PROGRESS.md](./PROGRESS.md);
capability specs in `openspec/specs/`.

## Commits

**Never add `Co-Authored-By: Claude` or any AI attribution trailer.** Commits are
authored by the person running the work. This applies to every commit, no
exceptions, including ones made entirely by an agent.

**Keep commits small.** One logical change per commit. A commit should be
revertable on its own without taking unrelated work with it.

- If the subject line needs "and", it is probably two commits.
- Separate refactors from behaviour changes. A rename mixed into a bug fix makes
  the fix impossible to review and impossible to revert cleanly.
- Separate mechanical sweeps (renames, formatting, generated files) from
  anything hand-written.
- Commit at each point where the tree is coherent and tests pass, not once at
  the end of a session.

**Conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
`chore:`, with a scope where it helps (`feat(workspaces):`).

**Write the why, not the what.** The diff already shows what changed. The
message is for whoever is bisecting this in six months and needs to know what
constraint you were working against. If a fix is non-obvious, say what the
failure looked like.

## Before committing

```bash
cd packages/web && npx tsc --noEmit -p tsconfig.json   # compare against 21, see AGENTS.md
cd packages/web && npx vitest run                      # 187 tests
```

Do not commit with new type errors or failing tests. If something is genuinely
pre-existing, say so in the message rather than leaving it ambiguous.

## Changing behaviour

If a change alters something described in `openspec/specs/`, update the spec in
the same commit — or use `/opsx:propose` to draft the change first. A spec that
disagrees with the code is worse than no spec.

## Code

- Comments explain reasoning and constraints. Never narrate what the line does.
- Match the surrounding style rather than importing your own.
- Security-relevant paths (`workspace-connections`) keep their membership checks
  at **both** bind time and run time. Do not "simplify" one away.
- Prefer `encryptSecret`/`decryptSecret` over `encrypt`/`decrypt` for anything a
  sandbox will receive.

## Verifying

Claims of "it works" need evidence from a real run, not reasoning. Two harnesses
exist and both hit real infrastructure — see AGENTS.md for how to run
`scripts/slice-zero.mjs` and `scripts/e2e-workspace.mjs`.
