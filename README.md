[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/brandhaug-b2b-saas-starter-badge.png)](https://mseep.ai/app/brandhaug-b2b-saas-starter)

# B2B SaaS Starter

Cloudflare-first B2B SaaS monorepo. TanStack Start, Effect v4, Drizzle on D1, Better Auth, Alchemy v2, REST + MCP, React Email, Storybook, Vitest, Playwright, oxlint, oxfmt, Turbo, Bun.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## About

A starter repository for shipping a B2B SaaS on Cloudflare's platform without making the early architectural decisions yourself. The public homepage showcases the repo and its architecture. The authenticated reference application demonstrates workspaces, starter modules, adoption readiness, integrations, API tokens, webhooks, reports, notifications, audit events, and a Better Auth admin dashboard — proving the foundation works end-to-end before you fork.

## Features

- **TanStack Start** web app (SSR + server functions) on a Cloudflare Worker, plus a separate Worker for public REST and MCP.
- **Effect v4** application layer in [`packages/capabilities`](./packages/capabilities) shared across web, API, MCP, background, and tests.
- **Drizzle ORM** over a single shared Cloudflare **D1** database, with Better Auth tables included.
- **Better Auth** with email/password, username, GitHub OAuth scaffolding, and the admin plugin.
- **Alchemy v2** IaC in [`alchemy.run.ts`](./alchemy.run.ts) — provisions D1, Queues + DLQ, Email Service, RateLimit bindings, and the three Workers.
- **Background worker** with cron-based catalog refresh and queue-backed outbound webhook delivery (with DLQ).
- **React Email** templates wired to Cloudflare's `SendEmail` binding.
- **Wide-event observability** via Effect's `Logger`, with `x-trace-id` propagation across services.
- **Storybook** for UI states, **Vitest** for unit/integration, **Playwright** for E2E.
- **oxlint** (type-aware) + **oxfmt** for fast linting/formatting; **Turbo** orchestrates the workspaces.
- **MDX-first** public knowledge content with generated search, sitemap, and LLM-docs artifacts.
- **Seed workspace** with deterministic data for the reference app, tests, and screenshots.

## Quick Start

Requires [Bun](https://bun.sh) >= 1.3.3.

```bash
bun install
bun run dev
```

Open <http://localhost:3071>.

Cloudflare account, D1, and secrets setup for `bun run deploy` is described in [ARCHITECTURE.md](./ARCHITECTURE.md) (Deployment & Infrastructure, Secret matrix).

## Repository Layout

```
apps/
  web/          TanStack Start worker — showcase site, reference app, auth, admin
  api/          Cloudflare Worker — public REST + MCP capability interfaces
  background/   Cloudflare Worker — catalog refresh cron + webhook queue consumer
packages/
  capabilities/ Effect application layer (workspaces, starter modules, audit, ...)
  db/           Drizzle schema for the shared D1 database
  auth/         Better Auth factory
  email/        React Email templates + SendEmail binding
  api/          Shared API contracts
  ai/           Effect AI starter assistant
  logger/       Wide-event Effect logger
  env/          Module-aware env validation
  config/       Shared TS/tooling configs
alchemy.run.ts  Cloudflare IaC entry
docs/adr/       Architectural decision records
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the component diagram, data stores, deployment story, security model, and explicit non-goals.

## Useful Commands

```bash
bun run dev              # turbo dev across all workspaces
bun run dev:web          # web app only
bun run build            # turbo build
bun run typecheck        # type-check all workspaces
bun run lint             # oxlint --type-aware
bun run format           # oxfmt --write
bun run test             # vitest across workspaces
bun run test:e2e         # Playwright (web)
bun run check            # typecheck + lint + format:check + test
bun run check:fix        # lint --fix + format

bun run db:generate      # Drizzle migrations
bun run db:migrate:local
bun run db:migrate:remote
bun run db:seed

bun run catalog:refresh  # refresh starter module catalog
bun run deploy           # alchemy.run.ts
bun run destroy          # alchemy.run.ts --destroy
```

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system diagram, components, deployment, security
- [CONTEXT.md](./CONTEXT.md) — domain glossary and language rules
- [DESIGN.md](./DESIGN.md) — visual design tokens and component direction
- [SECURITY.md](./SECURITY.md) — reporting vulnerabilities
- [CONTRIBUTING.md](./CONTRIBUTING.md) — local setup, dev loop, PR conventions
- [AGENTS.md](./AGENTS.md) — context for coding agents working in this repo
- [docs/adr](./docs/adr) — architectural decision records

## Acknowledgments

- **Hexwardens** — Effect v4, Alchemy v2, pre-commit hooks, AGENTS.md intent nodes, architecture discipline, Vitest, Playwright, D1 patterns.
- **Contributor** — design language, public pages, docs/search pattern, React Email, OAuth, REST/MCP, settings, catalog updater, admin-style B2B surfaces.

## License

MIT — see [LICENSE](./LICENSE).
