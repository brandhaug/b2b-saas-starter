# Architectural decision records

Each record is a short, statement-style decision: a title plus prose describing what the starter does and why. Records are updated in place when reality moves — current state is folded into the prose rather than appended as status logs. New decisions get the next number; see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Platform and infrastructure

- [0001 — Cloudflare-first starter](./0001-cloudflare-first-starter.md)
- [0004 — Shared D1 database](./0004-shared-d1-database.md)
- [0009 — No Durable Objects without a coordination need](./0009-no-durable-objects-without-coordination-need.md)
- [0010 — Bun-only package management](./0010-bun-only-package-management.md)
- [0018 — Scripts over CLI](./0018-scripts-over-cli.md)
- [0019 — CI with manual Alchemy deploy](./0019-ci-with-manual-alchemy-deploy.md)
- [0049 — Persisted local D1 in dev and e2e](./0049-persisted-local-d1-in-dev-and-e2e.md)

## Application architecture

- [0002 — Effect v4 application backbone](./0002-effect-v4-application-backbone.md)
- [0003 — Split web and API workers](./0003-split-web-and-api-workers.md)
- [0037 — Shared capabilities package](./0037-shared-capabilities-package.md)
- [0038 — Effect errors over better-result](./0038-effect-errors-over-better-result.md)
- [0039 — Effect HTTP API over Hono](./0039-effect-http-api-over-hono.md)
- [0040 — Client server-state: loaders and server functions](./0040-effect-atom-for-server-state.md)
- [0044 — Per-capability Effect services with Seed and Live adapters](./0044-per-capability-effect-services-with-seed-and-live-adapters.md)
- [0048 — Defer API versioning](./0048-defer-api-versioning.md)

## Product surfaces

- [0016 — Homepage as architecture showcase](./0016-homepage-as-architecture-showcase.md)
- [0023 — Public pricing with env-gated billing](./0023-public-pricing-with-env-gated-billing.md)
- [0024 — Better Auth admin dashboard](./0024-better-auth-admin-dashboard.md)
- [0025 — Persisted audit events](./0025-persisted-audit-events.md)
- [0026 — Workspace API tokens](./0026-workspace-api-tokens.md)
- [0027 — Public content search first](./0027-public-content-search-first.md)
- [0032 — Workspace outbound webhooks](./0032-workspace-outbound-webhooks.md)
- [0043 — Starter-specific charts](./0043-starter-specific-charts.md)

## Background work and delivery

- [0005 — Background catalog refresh](./0005-background-catalog-refresh.md)
- [0033 — Cloudflare Queues for webhook delivery](./0033-cloudflare-queues-for-webhook-delivery.md)

## Observability, security, and configuration

- [0007 — Wide event observability](./0007-wide-event-observability.md)
- [0030 — Sensitive surface rate limiting](./0030-sensitive-surface-rate-limiting.md)
- [0031 — Env-gated Turnstile](./0031-env-gated-turnstile.md)
- [0035 — Shared module-aware env validation](./0035-shared-module-aware-env-validation.md)

## Optional providers

- [0008 — Effect AI starter assistant](./0008-effect-ai-starter-assistant.md)
- [0014 — Cloudflare Email Service](./0014-cloudflare-email-service.md)

## UI and frontend

- [0011 — Storybook for UI states](./0011-storybook-for-ui-states.md)
- [0022 — shadcn and TweakCN theming](./0022-shadcn-tweakcn-theming.md)
- [0041 — TanStack Form for mutation forms](./0041-tanstack-form-for-mutation-forms.md)
- [0042 — TanStack Table for dense lists](./0042-tanstack-table-for-dense-lists.md)
- [0045 — Build-time syntax highlighting with Shiki](./0045-build-time-syntax-highlighting-with-shiki.md)

## Content and documentation

- [0006 — Intent node documentation](./0006-intent-node-documentation.md)
- [0013 — MDX and API reference docs](./0013-mdx-and-api-reference-docs.md)
- [0015 — Starter-focused legal pages](./0015-starter-focused-legal-pages.md)
- [0020 — Generated LLM docs artifacts](./0020-generated-llms-docs-artifacts.md)
- [0036 — Markdown-first architecture diagrams](./0036-markdown-first-architecture-diagrams.md)
- [0046 — Public content authored fresh, not ported](./0046-public-content-authored-fresh-not-ported.md)
- [0047 — MDX frontmatter as content source of truth](./0047-mdx-frontmatter-as-content-source-of-truth.md)

## Testing and local development

- [0012 — Focused Playwright coverage](./0012-focused-playwright-coverage.md)
- [0017 — Deterministic seed workspace](./0017-deterministic-seed-workspace.md)

## Deferred by default

- [0021 — No initial PWA](./0021-no-initial-pwa.md)
- [0028 — No initial file storage](./0028-no-initial-file-storage.md)
- [0029 — No initial i18n](./0029-no-initial-i18n.md)
- [0034 — No initial realtime transport](./0034-no-initial-realtime-transport.md)
