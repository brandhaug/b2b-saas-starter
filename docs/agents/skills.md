# Shared skills

The repo owns the skills in `.agents/skills`. Codex and OpenCode read that directory;
Claude Code reads it through the `.claude/skills` symlink. `CLAUDE.md` links to
`AGENTS.md` for shared repo instructions. External supporting skills install into `.agents/skill-dependencies` in this checkout.
This ignored directory stays outside the automatically discovered skill catalog.

## Repository skills

- [configure-cloudflare-monitoring](../../.agents/skills/configure-cloudflare-monitoring/SKILL.md)
  sets up or reconciles SQL alerts and a shared Worker dashboard for an account
  and stage. It discovers schemas, preserves existing monitor policies, checks
  repeatability and verifies no-data/recovery behavior. Use it for initial setup,
  configuration drift, new monitoring scenarios or a delivery drill.
- [implement](../../.agents/skills/implement/SKILL.md) takes an agreed issue through
  implementation, review, and a PR ready to merge.
- [investigate-cloudflare](../../.agents/skills/investigate-cloudflare/SKILL.md)
  investigates deployed failures and missing operational signals using existing
  Cloudflare access. It records bounded, sanitized evidence and checks recurrence
  against the deployed version. Use `$investigate-cloudflare` or name its file.
  For missing spans or instrumentation decisions, its
  [tracing reference](../../.agents/skills/investigate-cloudflare/references/tracing.md)
  checks deployed collection and selects native or sanitized Effect evidence.
  An investigation does not authorize alert changes, replay, or deployment.

## Setup

With Node 24 and Git installed, run:

```bash
pnpm run skills:setup
```

The installer fetches exact commits from
[agent-skills.json](../../scripts/agent-skills.json), including references,
executable helpers, licenses and notices. It records the source and content digest
in `.agents/skill-dependencies/skill-install-state.json`. The default repository
comes from the script location; `--repo PATH` selects an isolated target checkout.
It never writes to personal skill directories or creates Claude aliases, and
`pnpm install` does not run it.

Before invoking dependencies, check the ones needed for the task:

```bash
pnpm run skills:verify -- codebase-design impeccable
```

Omit names to check every declared dependency. Verification is offline and read-only.
It reports missing, unmanaged, locally modified and stale installations separately.
Install missing dependencies with `pnpm run skills:setup -- codebase-design impeccable`.
Setup preserves unmanaged and modified content. Move it aside or restore it deliberately
before retrying; the installer never silently overwrites it.

Setup holds an exclusive `.agents/skill-dependencies/.setup-lock` directory for the run.
A second setup fails without changing snapshots. If a killed process leaves the lock,
confirm no setup is running before removing that directory and retrying. Verification
does not acquire a lock or write files; avoid reading snapshots during setup.

Read `.agents/skill-dependencies/<name>/SKILL.md` explicitly and follow its relative
references. Use these paths in worker briefs too, so personal skills with the same name
cannot replace the pinned copy. Load only applicable guidance: `codebase-design` for
module interfaces, `effect-service-design` for service ownership and `impeccable` for UI.
The manifest declares availability, not instructions to load every skill.

Repository policy governs testing, validation, review and conventions. External skills
supply techniques; when their instructions conflict with repository policy, follow the
repository. Missing optional design guidance can fall back to repo conventions with the
omission disclosed. Required review dependencies must verify before the relevant review;
report review incomplete if installation or verification remains blocked. Do not silently
substitute a global version or waive the gate.

In any host, ask: "Use `.agents/skills/implement/SKILL.md` to implement an agreed GitHub issue."
The repo's implement skill owns validation order, review selection and monitoring.
It keeps implementation on the session model and uses cheaper workers only for the
roles it names. Reviewers receive fresh context and saved evidence; the parent owns
host PR watching. Local review is reported as non-independent when delegation is
unavailable. Personal entry skills should link here rather than copy this workflow.

## Updates

Ask an agent to update the pinned commits in `scripts/agent-skills.json`, review
upstream instruction and executable changes, and open a PR. Keep the repository skills above
repo-owned. After accepting a pin update, run:

```bash
pnpm run skills:setup --update
```

Updates replace only installations owned by this installer that have not been
edited locally. Resolve reported conflicts manually. A normal setup reports manifest changes as stale;
only `--update` refreshes an unchanged managed snapshot. Updates affect this checkout.

Existing global installations are left untouched. Run setup in each checkout to migrate,
then use the explicit paths above. Remove old personal copies only if you choose; they
may still serve other projects.

Discovery: [Codex](https://learn.chatgpt.com/docs/build-skills),
[Claude Code](https://code.claude.com/docs/en/skills),
[OpenCode](https://opencode.ai/docs/skills/).

Worker context: [Codex spawn implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs),
[Claude Code subagents](https://code.claude.com/docs/en/sub-agents#how-forks-differ-from-other-subagents),
[OpenCode task parameters](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts).
Codex host tools differ; the workflow's `fork_turns` instruction applies when
the active spawn tool exposes that parameter.
