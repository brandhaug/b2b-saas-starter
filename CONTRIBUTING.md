# Contributing

Changes should improve the Starter for adopters. Discuss substantial changes in an issue before implementation. Read the relevant [architecture](ARCHITECTURE.md), [domain terms](CONTEXT.md), and [decisions](docs/adr/README.md).

## Development

Follow [local setup](docs/setup.md), then branch from `master`. Keep each PR to one logical change and follow the [testing policy](AGENTS.md#testing).

Run `pnpm run check` before committing and after `pnpm run check:fix`. The pre-commit hook only formats staged files. Run `pnpm run validate` before PR handoff; [validation prerequisites](docs/setup.md#validation) include Chromium and local Worker process access.

Commits and PR titles must use Conventional Commits, such as `docs(adr): consolidate billing decisions`. Breaking changes use `!` or a `BREAKING CHANGE:` footer. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) from the final diff and observed validation; remove prompts and unused sections.

## Feature acceptance

For each changed behavior, identify its applicable web entry points, REST operations,
MCP tools and background jobs from the existing callers and contracts. Include
Seed/Live adapters and permission-denied states. Record applicability in the issue's
acceptance criteria, then map each criterion to commands, observed results and test
locations in the PR. Group paths that share evidence; explain exclusions and mark
unverified paths as gaps. Documentation-only changes can state why runtime paths
do not apply.

For state changes, verify the supported revoke, re-enable, cancel, reopen or retry
path and read back the resulting state. Include denial without the protected side
effect, and failure/retry behavior where the change affects it. Explain intentional
one-way operations; do not add an endpoint or reverse operation just to fill a row.
Browser-session-only operations stay browser-only, and MCP exposure stays opt-in.

Use the [operation catalog](apps/api/src/operations.ts) and its
[OpenAPI permission matrix](apps/api/src/permission-matrix.test.ts) for REST
completeness, and the existing MCP protocol tests for exposed tools. These checks
do not prove every transition works. Extend the owning capability's shared
Seed/Live contract for lifecycle invariants, and exercise each applicable entry
point's distinct wiring, authorization and visible outcome through existing
boundary or E2E tests. Shared contract evidence can cover shared behavior without
copying every assertion into every transport. Follow the [testing policy](AGENTS.md#testing)
and keep repeatable E2E evidence in the PR, not a second coverage catalog.

## Keep documentation current

Update the existing document when behavior changes. ADRs record the current decision and its rationale; revise the original ADR instead of creating a superseding record or appending a change log. Create a new ADR only for a distinct decision with a meaningful trade-off. Consolidate overlapping records, update references, and leave numbering gaps rather than renumbering unrelated decisions. Git history preserves removed wording.

Retain historical context only when it explains a current constraint, prevents a likely mistake, or provides dated verification evidence. Keep procedures in runbooks, terminology in [CONTEXT.md](CONTEXT.md), and cross-file implementation invariants in the relevant AGENTS.md.

## Reports

Use the GitHub bug template with reproduction steps, expected and actual behavior, and the affected commit. Report vulnerabilities privately through [SECURITY.md](SECURITY.md).
