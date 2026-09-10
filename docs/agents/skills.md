# Shared skills

The repo owns `.agents/skills/implement`. Codex and OpenCode read that directory;
Claude Code reads it through the `.claude/skills` symlink. `CLAUDE.md` links to
`AGENTS.md` for shared repo instructions. Supporting skills install globally.

## Setup

With Node 24 and Git installed, run:

```bash
pnpm run skills:setup
```

The installer fetches the exact commits in
[agent-skills.json](../../scripts/agent-skills.json), including references,
executable helpers, licenses, and notices. It installs into `~/.agents/skills`
for Codex and OpenCode and creates links in `~/.claude/skills` for Claude Code.
Existing personal installations are left alone; the command reports conflicts.
Start a new agent session after installation. This command is never run by
`pnpm install`.

Claude Code gives personal skills precedence over project skills with matching
names. If you have a global `implement`, remove that conflicting installation or
explicitly direct the agent to this repo's skill.

In any host, ask: "Use `.agents/skills/implement/SKILL.md` to implement an agreed GitHub issue."
The workflow uses the session's provider and available tools, selecting a
configured cheaper worker when possible. It falls back to the session model or
local execution when necessary.

## Updates

Ask an agent to update the pinned commits in `scripts/agent-skills.json`, review
upstream instruction and executable changes, and open a PR. Keep `implement`
repo-owned. After accepting a pin update, run:

```bash
pnpm run skills:setup --update
```

Updates replace only installations owned by this installer that have not been
edited locally. Resolve reported personal-installation conflicts manually.
Global updates affect every project that uses those skills.

Discovery: [Codex](https://learn.chatgpt.com/docs/build-skills),
[Claude Code](https://code.claude.com/docs/en/skills),
[OpenCode](https://opencode.ai/docs/skills/).

Worker context: [Codex spawn implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs),
[Claude Code subagents](https://code.claude.com/docs/en/sub-agents#how-forks-differ-from-other-subagents),
[OpenCode task parameters](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts).
Codex host tools differ; the workflow's `fork_turns` instruction applies when
the active spawn tool exposes that parameter.
