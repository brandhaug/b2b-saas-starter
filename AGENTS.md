# B2B SaaS Starter

Cloudflare-first B2B SaaS starter. The public site showcases the repository itself; the authenticated app is a reference implementation for workspaces, members/RBAC, API/MCP, email, webhooks, notifications, audit, and admin.

[CONTEXT.md](./CONTEXT.md) holds the domain language, [ARCHITECTURE.md](./ARCHITECTURE.md) the system map and security model, [DESIGN.md](./DESIGN.md) the visual identity, [docs/adr](./docs/adr) the decisions.

## Project posture

Nothing here is in production use. Refactor freely, rename what reads wrong, and drop stored shapes rather than migrating them. No backwards compatibility, no deprecation path, no shims for old data.

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

Each capability under `packages/capabilities/src/<context>/` has a leaf node beside its source; the package node holds the map.

## Setup

Requires the [Vite+ CLI](https://viteplus.dev) (`vp`, >= 0.3.0), which provides the Node runtime and the pinned pnpm.

```bash
vp install
pnpm run dev        # web on http://localhost:3071
pnpm run check      # typecheck + lint + format:check + dead-code + test
```

- pnpm only; versions single-sourced in the `catalog` block of `pnpm-workspace.yaml`, referenced as `"catalog:"`. Toolchain versions (`vite`, `vitest`, `oxlint`, `oxfmt`) move with `vp upgrade`, never by hand.
- Task runner is Vite Task (`vp run`), formatting `vp fmt`, linting `vp lint`.
- The pre-commit hook only formats. Run `pnpm run check` before committing; PR Gate enforces the same bar. `pnpm run check:fix` applies lint and format fixes; re-run `check` after it.

## Cross-Cutting Rules

1. Effect v4 typed errors, services, schemas, and HTTP API contracts for application behavior.
2. Business use cases live in `packages/capabilities`. Route handlers and UI components do not duplicate behavior.
3. Provider-light local development: an optional provider whose env vars are unset stays inactive instead of failing the app.
4. Cloudflare-first primitives: Workers, D1, Queues, Email, Turnstile, Workers AI, Alchemy.
5. Borrow interaction patterns from other products, never their domain language.
6. No new architecture (games, PWA, realtime, Durable Objects) without a concrete starter use case.
7. Every declaration merge goes in a `.d.ts` file. `declare module 'x'` needs a top-level import; `declare global` and `declare namespace` need none. Enforced by `starter/no-interface-merge-outside-dts` and `starter/no-mismatched-augmentation-context`; examples in `apps/web/src/router-register.d.ts` and `apps/web/src/worker-env.d.ts`.
8. Seed (in-memory) and Live (D1) adapters stay equivalent for the demo identity. `packages/capabilities/src/seed-fixture.ts` is the one source for `usr_demo` / `starter-lab`; `scripts/seed.ts` adds only the password. Client-side navigation resolves membership against the fixture, so a user present in one layer only 404s on SPA navigation while full-page loads succeed.

## Commit & Release Conventions

- Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): subject`); PR Gate rejects non-conforming titles. Breaking changes use `!` or a `BREAKING CHANGE:` footer.
- release-please opens `chore(master): release ...` PRs from merged commits; merging one tags and publishes.
- `CLAUDE.md` is a symlink to this file.
