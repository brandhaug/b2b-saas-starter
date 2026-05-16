# B2B SaaS Starter

Cloudflare-first B2B SaaS starter. The public site showcases the repository itself; the authenticated app is a reference implementation for workspaces, starter modules, readiness, integrations, API/MCP, email, reports, webhooks, audit, and admin.

See [CONTEXT.md](./CONTEXT.md) for canonical domain language, [ARCHITECTURE.md](./ARCHITECTURE.md) for the system map and security model, and [DESIGN.md](./DESIGN.md) for the visual identity — design tokens, typography, and component contracts. Decisions live in [docs/adr](./docs/adr).

## Intent Node Index

| Area              | Intent Node                                                        |
| ----------------- | ------------------------------------------------------------------ |
| Web app           | [apps/web/AGENTS.md](apps/web/AGENTS.md)                           |
| API worker        | [apps/api/AGENTS.md](apps/api/AGENTS.md)                           |
| Background worker | [apps/background/AGENTS.md](apps/background/AGENTS.md)             |
| Database          | [packages/db/AGENTS.md](packages/db/AGENTS.md)                     |
| Capabilities      | [packages/capabilities/AGENTS.md](packages/capabilities/AGENTS.md) |

Capabilities are grouped into bounded-context folders under `packages/capabilities/src/`: `catalog/`, `developer-platform/`, `governance/`, `notifications/`. Each capability has a leaf intent node beside its source file — see the package node for the map and the "Where to put a new capability" rules.

## Setup

```bash
bun install
bun run dev
bun run build
bun run test
```

- Web dev server: `http://localhost:3071`
- API worker dev server: `bun --cwd apps/api dev`
- Background worker dev server: `bun --cwd apps/background dev`
- Package manager: Bun only
- Formatting: `oxfmt`
- Linting: `oxlint`

## Cross-Cutting Rules

1. Use Effect v4 typed errors, services, schemas, and HTTP API contracts for application behavior.
2. Use `packages/capabilities` for business use cases; route handlers and UI components should not duplicate behavior.
3. Keep local development provider-light. Optional modules must show disabled or needs-config states instead of failing the app.
4. Use Cloudflare-first primitives: Workers, D1, Queues, Email, Turnstile, Workers AI, and Alchemy.
5. Keep Contributor's visual patterns but do not import Contributor's developer-productivity domain language.
6. Keep Hexwardens' architecture discipline but do not copy game, PWA, realtime, or Durable Object requirements without a starter use case.
