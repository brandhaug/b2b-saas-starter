# Contributing

Changes should improve the Starter for adopters. Discuss substantial changes in an issue before implementation. Read the relevant [architecture](ARCHITECTURE.md), [domain terms](CONTEXT.md), and [decisions](docs/adr/README.md).

## Development

Follow [local setup](docs/setup.md), then branch from `master`. Keep each PR to one logical change and test behavior changes.

Run `pnpm run check` before committing and after `pnpm run check:fix`. The pre-commit hook only formats staged files. Run `pnpm run validate` before PR handoff; [validation prerequisites](docs/setup.md#validation) include Chromium and local Worker process access.

Commits and PR titles must use Conventional Commits, such as `docs(adr): consolidate billing decisions`. Breaking changes use `!` or a `BREAKING CHANGE:` footer. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) from the final diff and observed validation; remove prompts and unused sections.

## Keep documentation current

Update the existing document when behavior changes. ADRs record the current decision and its rationale; revise the original ADR instead of creating a superseding record or appending a change log. Create a new ADR only for a distinct decision with a meaningful trade-off. Consolidate overlapping records, update references, and leave numbering gaps rather than renumbering unrelated decisions. Git history preserves removed wording.

Retain historical context only when it explains a current constraint, prevents a likely mistake, or provides dated verification evidence. Keep procedures in runbooks, terminology in [CONTEXT.md](CONTEXT.md), and cross-file implementation invariants in the relevant AGENTS.md.

## Reports

Use the GitHub bug template with reproduction steps, expected and actual behavior, and the affected commit. Report vulnerabilities privately through [SECURITY.md](SECURITY.md).
