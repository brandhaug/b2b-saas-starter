# Contributing

Thanks for considering a contribution. This repository is a B2B SaaS starter — changes are evaluated against whether they make the starter more useful for adopters, not whether they would be useful in a downstream production app.

## Before You Start

- For non-trivial changes, open an issue first to discuss direction.
- Read [ARCHITECTURE.md](./ARCHITECTURE.md), [CONTEXT.md](./CONTEXT.md), and the relevant ADRs under [docs/adr](./docs/adr). New architectural decisions should be recorded as a new ADR.
- This starter is opinionated. Removing existing tools (Effect, Drizzle, Better Auth, TanStack, Alchemy, oxlint, oxfmt) is unlikely to land. Adding new tooling needs a strong motivation and usually a new ADR.

## Local Setup

```bash
bun install
cp .env.example .env
bun run dev
```

Web dev server runs at <http://localhost:3071>.

See [docs/setup.md](./docs/setup.md) for full Cloudflare account / D1 / secrets setup.

## Development Loop

```bash
bun run typecheck   # type-check all workspaces
bun run lint        # oxlint --type-aware
bun run format      # oxfmt --write
bun run test        # vitest across workspaces
bun run check       # typecheck + lint + format:check + test
```

`bun run check:fix` runs lint --fix and format across the repo. The pre-commit hook runs `lint-staged` (oxlint --fix + oxfmt --write on staged files only) automatically.

## Commit Style

- Conventional Commits are preferred (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- Keep commits scoped and reviewable.
- Reference the issue number in the body where relevant.

## Pull Requests

- Branch from `master`.
- Ensure `bun run check` and `bun run build` pass locally.
- Fill in the PR template.
- Add or update tests for behavioural changes. Storybook stories for UI changes.
- Update [CONTEXT.md](./CONTEXT.md) if you introduce new domain language; add an ADR if you make an architectural decision.
- Keep PRs focused — one logical change per PR.

## Reporting Bugs

Open a GitHub issue using the bug template. Include reproduction steps, expected vs. actual behaviour, and the commit SHA.

## Reporting Security Issues

See [SECURITY.md](./SECURITY.md). **Do not open a public issue.**
