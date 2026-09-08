# B2B SaaS Starter

A Cloudflare-first repository for building a B2B SaaS with TanStack Start, Effect v4, Drizzle D1, Better Auth, and Alchemy.

The public site explains the repository. The Reference Application demonstrates workspaces, membership and permissions, billing, API tokens, webhooks, notifications, audit events, and account administration.

## Run locally

Install the [Vite+ CLI](https://viteplus.dev), which manages the pinned Node and pnpm toolchain:

```bash
vp install
cp .env.example .env
pnpm run dev
```

Open <http://localhost:3071>. Optional providers stay inactive until configured. For credential sign-in, [migrate and seed local D1](docs/setup.md#database), then restart the dev server.

## Architecture

Three Workers share the business-use-case layer in [packages/capabilities](packages/capabilities), with billing and email-delivery infrastructure in their dedicated packages:

- `apps/web`: public content, authenticated UI, server functions, and Better Auth.
- `apps/api`: REST and MCP interfaces over the same workspace operations.
- `apps/background`: webhook delivery, exports, billing synchronization, and notification email.
- `packages/billing`: Stripe lifecycle, checkout recovery, and resource entitlements.
- `packages/email-delivery`: transactional send claims and sanitized delivery evidence.

D1 stores application and authentication state. Cloudflare Queues carry background work; optional R2 stores workspace exports. Checked-in MDX supplies public docs and their navigation metadata. LLM summaries are checked-in public text files. Alchemy provisions deployment resources from [alchemy.run.ts](alchemy.run.ts).

See [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and the security model.

## Development

```bash
pnpm run check       # types, lint, formatting, dead code, and tests
pnpm run check:fix   # apply lint and formatting fixes; run check afterwards
pnpm run validate   # check, build, generated configs, local DB setup, and E2E
```

[Setup](docs/setup.md) covers prerequisites, local accounts, database commands, and validation. [Contributing](CONTRIBUTING.md) covers commits and PRs.

## Documentation

- [Deployment](docs/deploying.md): Cloudflare credentials, CI, previews, and verification.
- [Operations](docs/operations.md): monitoring, backups, and recovery before customer use.
- [Retention](docs/retention.md): approved record-expiry policy and operator workflow.
- [Workspace suspension](docs/workspace-suspension.md): administrative access controls and recovery rules.
- [CONTEXT.md](CONTEXT.md): domain glossary.
- [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md): audience and interface conventions.
- [ADRs](docs/adr/README.md): current architectural decisions and rationale.
- [AGENTS.md](AGENTS.md): instructions for coding agents.
- [SECURITY.md](SECURITY.md): private vulnerability reporting.

## License

[MIT](LICENSE).
