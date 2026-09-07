# Shared skills

Workflow skills live in `.agents/skills`; `.claude/skills` links to that directory.
Codex and OpenCode discover `.agents/skills`; Claude Code discovers `.claude/skills`.
Load the skills needed for the task. Personal skills with matching names can take
precedence in Claude Code; check the resolved path when using a personal install.

`implement` is maintained here. The other skills are upstream snapshots with
supporting files and licenses. [sources.json](../../.agents/skills/sources.json)
records each source directory and exact commit. Impeccable's launcher may download
its versioned executable on first use; that cache is not part of this repository.

## Updates

Ask an agent: "Update the vendored skills from their recorded upstream sources and
open a PR. Preserve our implement workflow."

For each update, compare the recorded commit with the proposed upstream commit,
review instruction and executable changes, and replace the complete skill folder
including deleted files. Preserve upstream licenses, notices, and the additional
licenses recorded for Impeccable. Record the new commit in `sources.json`.

Check references, executable permissions, Claude links, and compatibility with
`implement`, then run `pnpm run check`. Keep repo-specific workflow preferences in
`implement` so upstream snapshots remain replaceable. Update through reviewed PRs;
there is no automatic updater.

Discovery: [Claude Code](https://code.claude.com/docs/en/skills),
[OpenCode](https://opencode.ai/docs/skills/).
