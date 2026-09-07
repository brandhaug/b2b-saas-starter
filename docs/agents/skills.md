# Shared skills

The repo owns `.agents/skills/implement`; `.claude/skills` links to the same
collection. Supporting skills are installed globally, outside this checkout.

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

Discovery: [Claude Code](https://code.claude.com/docs/en/skills),
[OpenCode](https://opencode.ai/docs/skills/).
