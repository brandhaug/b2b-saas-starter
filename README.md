# B2B SaaS Starter

Cloudflare-first B2B SaaS monorepo. TanStack Start, Effect v4, Drizzle on D1, Better Auth, Alchemy v2, REST + MCP, React Email, Storybook, Vitest, Playwright, oxlint, oxfmt, Vite+, pnpm.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## About

A starter repository for shipping a B2B SaaS on Cloudflare's platform without making the early architectural decisions yourself. The public homepage showcases the repo and its architecture. The authenticated reference application demonstrates workspaces, members/RBAC, API tokens, webhooks, notifications, audit events, and a Better Auth admin dashboard — proving the foundation works end-to-end before you fork.

## Features

- **TanStack Start** web app (SSR + server functions) on a Cloudflare Worker, plus a separate Worker for public REST and MCP.
- **Effect v4** application layer in [`packages/capabilities`](./packages/capabilities) shared across web, API, MCP, background, and tests.
- **Drizzle ORM** over a single shared Cloudflare **D1** database, with Better Auth tables included.
- **Better Auth** with email/password, username, magic link, email one-time codes, passkeys, TOTP two-factor, workspace-scoped SSO, env-gated social sign-in, an OAuth 2.1 authorization server for interactive MCP clients, and the admin and organization plugins.
- **Alchemy v2** IaC in [`alchemy.run.ts`](./alchemy.run.ts) — provisions D1, Queues + DLQ, Email Service, RateLimit bindings, and the three Workers.
- **Background worker** with four queues — webhook delivery (with DLQ), workspace export builds, billing seat sync, and instant notification emails — plus a daily notification digest cron.
- **React Email** templates wired to Cloudflare's `SendEmail` binding.
- **Wide-event observability** via Effect's `Logger`, with `x-trace-id` propagation across services.
- **Storybook** for UI states, **Vitest** for unit/integration, **Playwright** for E2E.
- **oxlint** (type-aware) + **oxfmt** for fast linting/formatting; **Vite+** (`vp`) is the unified toolchain and orchestrates the workspaces with Vite Task.
- **MDX-first** public knowledge content with generated search, sitemap, and LLM-docs artifacts.
- **Seed workspace** with deterministic data for the reference app, tests, and screenshots.

## Quick Start

Requires the [Vite+ CLI](https://viteplus.dev) (`vp`, >= 0.3.0), which provides
the managed Node runtime (>= 24) and pnpm.

```bash
vp install
cp .env.example .env   # local defaults work out of the box; fill in optional providers as needed
pnpm run dev
```

Open <http://localhost:3071>.

Cloudflare account, D1, and secrets setup for `pnpm run deploy` is described in [docs/deploying.md](./docs/deploying.md). The full resource and security model lives in [ARCHITECTURE.md](./ARCHITECTURE.md) (Deployment & Infrastructure, Secret matrix).

## Repository Layout

```
apps/
  web/          TanStack Start worker — showcase site, reference app, auth, admin
  api/          Cloudflare Worker — public REST + MCP capability interfaces
  background/   Cloudflare Worker — webhook queue consumer
packages/
  capabilities/ Effect application layer (workspaces, webhooks, audit, ...)
  db/           Drizzle schema for the shared D1 database
  auth/         Better Auth factory
  authz/        Permission statements, static roles, and the requirePermission guard
  email/        React Email templates + SendEmail binding
  api/          Shared API contracts
  sdk/          Typed client derived from the shared REST contract
  ai/           Effect AI starter assistant
  logger/       Wide-event Effect logger
  rate-limit/   Rate-limit port with the in-memory fallback for local dev and tests
  failure/      One safe reader for an unknown thrown value
  env/          Schema-derived env validation
  config/       Shared TS/tooling configs
  oxlint-plugin/ Repo-local oxlint rules (starter/*)
alchemy.run.ts  Cloudflare IaC entry
docs/adr/       Architectural decision records
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the component diagram, data stores, deployment story, security model, and explicit non-goals.

## Useful Commands

```bash
pnpm run dev              # vite task: dev servers in web, api, and background
pnpm run dev:web          # web app only
pnpm run build            # vite task: build all workspaces
pnpm run typecheck        # type-check all workspaces
pnpm run lint             # vp lint --type-aware
pnpm run format           # vp fmt --write
pnpm run test             # vitest across workspaces
pnpm run test:e2e         # Playwright (web)
pnpm run check            # typecheck + lint + format:check + dead-code + test
pnpm run check:fix        # lint --fix + format

pnpm run db:generate      # Drizzle migrations
pnpm run db:migrate:local
pnpm run db:migrate:remote
pnpm run db:seed

pnpm run deploy           # alchemy deploy --stage prod --yes
pnpm run destroy          # alchemy destroy --stage prod
```

## Documentation

- [docs/deploying.md](./docs/deploying.md) — deploy to Cloudflare: token setup, GitHub Actions secrets, verification
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system diagram, components, deployment, security
- [CONTEXT.md](./CONTEXT.md) — domain glossary and language rules
- [DESIGN.md](./DESIGN.md) — visual design tokens and component direction
- [SECURITY.md](./SECURITY.md) — reporting vulnerabilities
- [CONTRIBUTING.md](./CONTRIBUTING.md) — local setup, dev loop, PR conventions
- [AGENTS.md](./AGENTS.md) — context for coding agents working in this repo
- [docs/adr](./docs/adr) — architectural decision records

## License

MIT — see [LICENSE](./LICENSE).
