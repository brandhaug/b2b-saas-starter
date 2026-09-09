# Issue tracker

GitHub, using this checkout's `origin`. Read an issue and its comments with
`gh issue view <number> --comments`. Follow declared blockers before dispatching
implementation. Use the existing `ready-for-agent` label when available; omit it
if the repo has no such label.

After grilling, publish one current agreed specification using the
[feature template](../../.github/ISSUE_TEMPLATE/feature.md). Preserve acceptance
IDs when refining it; replace superseded wording rather than appending competing
specifications. Updating an existing issue requires authorization for that edit.

Use `to-tickets` for approved vertical slices. Carry the parent's AC IDs into
child GitHub issues, link blockers natively when available, and leave the parent
unchanged.
For wide refactors, use a bounded atomic change or integration branch; this repo
has no need for expand-contract compatibility scaffolding.

For repository naming and PR evidence mapping, follow the
[implementation traceability rule](../../.agents/skills/implement/SKILL.md).
