# B2B SaaS Starter

Cloudflare-first B2B SaaS starter. Public site showcases the repo; app demonstrates workspaces.

[CONTEXT.md](./CONTEXT.md) holds the domain language, [ARCHITECTURE.md](./ARCHITECTURE.md) the system map and security model, [DESIGN.md](./DESIGN.md) the visual identity, [docs/adr](./docs/adr) the decisions.

## Project posture

No production users. Refactor freely, rename, and drop stored shapes. No backwards compatibility, deprecation paths, or old-data shims.

For issue/spec implementation, follow the [implement skill](.agents/skills/implement/SKILL.md). For ticket context, read [issue-tracker.md](docs/agents/issue-tracker.md).

## Intent Node Index

| Area              | Intent Node                                                          |
| ----------------- | -------------------------------------------------------------------- |
| Web app           | [apps/web/AGENTS.md](apps/web/AGENTS.md)                             |
| API worker        | [apps/api/AGENTS.md](apps/api/AGENTS.md)                             |
| Background worker | [apps/background/AGENTS.md](apps/background/AGENTS.md)               |
| HTTP contract     | [packages/api/AGENTS.md](packages/api/AGENTS.md)                     |
| Capabilities      | [packages/capabilities/AGENTS.md](packages/capabilities/AGENTS.md)   |
| Database          | [packages/db/AGENTS.md](packages/db/AGENTS.md)                       |
| Authentication    | [packages/auth/AGENTS.md](packages/auth/AGENTS.md)                   |
| Authorization     | [packages/authz/AGENTS.md](packages/authz/AGENTS.md)                 |
| Email             | [packages/email/AGENTS.md](packages/email/AGENTS.md)                 |
| Environment       | [packages/env/AGENTS.md](packages/env/AGENTS.md)                     |
| Observability     | [packages/logger/AGENTS.md](packages/logger/AGENTS.md)               |
| Typed SDK         | [packages/sdk/AGENTS.md](packages/sdk/AGENTS.md)                     |
| Lint rules        | [packages/oxlint-plugin/AGENTS.md](packages/oxlint-plugin/AGENTS.md) |

## Setup

Use [Vite+](https://viteplus.dev) for pinned Node and pnpm. Install with `vp install`; use `vp run`, `vp fmt`, and `vp lint`. Toolchain versions live in the workspace catalog and move through `vp upgrade`.

Run `pnpm run check` before committing and after `check:fix`; the pre-commit hook only formats. Run `pnpm run validate` before PR handoff; see [prerequisites](docs/setup.md#validation). For Codex, Claude Code, or OpenCode skills, follow [shared skills setup](docs/agents/skills.md).

## Rules

1. Effect v4 typed errors, services, schemas, and HTTP API contracts for application behavior.
2. Business use cases live in `packages/capabilities`. Route handlers and UI components do not duplicate behavior.
3. Provider-light local development: an optional provider whose env vars are unset stays inactive instead of failing the app.
4. Cloudflare-first primitives: Workers, D1, Queues, Email, Turnstile, Workers AI, Alchemy.
5. Borrow interaction patterns from other products, never their domain language.
6. No new architecture (games, PWA, realtime, Durable Objects) without a starter use case.
7. Declaration merges belong in `.d.ts`; module declarations need a top-level import.
8. Seed and Live adapters stay equivalent for the demo identity. `packages/capabilities/src/seed-fixture.ts` owns `usr_demo` / `starter-lab`; `scripts/seed.ts` adds only the password. SPA membership uses the fixture; identity drift can break navigation while full-page loads succeed.

## Agent execution

Read only the intent nodes and skill branches needed for the task. Save verbose command output to a log and inspect summaries and failures.

## Commit & Release Conventions

- Create/update PR bodies from [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md), the final diff, and observed validation. Remove prompts and unused optional sections; pass the completed body via `--body-file`.
- Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): subject`); PR Gate rejects non-conforming titles. Breaking changes use `!` or a `BREAKING CHANGE:` footer.
