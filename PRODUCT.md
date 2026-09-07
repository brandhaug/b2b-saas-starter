# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Senior TypeScript engineers and small teams evaluating a foundation for their next B2B SaaS. They arrive skeptical — usually at night, mid-evaluation, comparing starters — and they distrust marketing pages. They want to inspect the actual architecture, run it locally in minutes, and judge the code, not the copy. Secondary: developers already using the starter, returning for docs, changelog, and decision rationale.

## Product Purpose

The B2B SaaS Starter is a repository product: a Cloudflare-first foundation (TanStack Start, Effect v4, Drizzle D1, Better Auth, REST + MCP, Queues, Email) proven by a working Reference Application. The Showcase Site explains why the starter is a strong foundation; the Reference Application proves those claims with real, seeded, working features. Success = a visitor forks the repo and has it running locally without configuring a single external provider.

## Positioning

The Starter combines a Cloudflare-first deployment model with one shared application layer in `packages/capabilities`. The web app, REST API, MCP server, and background workers use that layer. Engineers can inspect the same behavior through the Reference Application and its external interfaces, then adapt it for their own product. Optional providers stay inactive until configured, so evaluating the repository does not require external service accounts.

## Operating Context

The Showcase Site supports evaluation through public pages, docs, blog, changelog, and a seeded Reference Application. Returning developers use the repository's setup guides and architecture decisions to run, extend, and deploy the Starter.

Local development uses Vite+ and pnpm, with the web app at `http://localhost:3071`. Migrating and seeding local D1 enables credential sign-in and persisted workspace behavior without a Cloudflare account. Without that database, the development app uses the in-memory Seed adapter. [docs/setup.md](docs/setup.md) owns the commands and prerequisites.

In the Reference Application, Members work within a Workspace. Owners and admins manage membership, Invitations, API Tokens, Webhook Endpoints, and workspace settings according to their permissions. Account settings and System Admin tools have separate scopes. The seeded owner and member accounts let evaluators inspect these permission differences.

## Capabilities and Constraints

- Workspace capabilities include membership and Invitations, API Tokens, outbound webhooks, Audit Events, Notifications, billing, and Workspace Export. Authentication includes local sign-in paths and optional external providers. See [ARCHITECTURE.md](ARCHITECTURE.md) for the implementation and security boundaries.
- Cloudflare Workers, D1, Queues, and Email underpin the deployment model. Optional provider configuration controls activation; unconfigured integrations must remain visibly inactive.
- The project has no production users. Refactors may rename concepts and replace stored shapes without compatibility layers. New architecture needs a concrete Starter use case.
- The Seed and Live adapters must represent the same demo identity. `packages/capabilities/src/seed-fixture.ts` owns `usr_demo` and the `starter-lab` Workspace; `scripts/seed.ts` adds the password.
- [CONTEXT.md](CONTEXT.md) owns domain terminology. Use Starter, Reference Application, Showcase Site, Workspace, and Member consistently. Workspace roles are owner, admin, and member; System Admin is a separate global permission.
- Public Knowledge Content lives in versioned MDX. Workspace state comes through D1-backed capabilities.

## Evidence on Hand

- [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/adr](docs/adr) document the system and its decisions.
- [packages/capabilities/src/seed-fixture.ts](packages/capabilities/src/seed-fixture.ts) supplies deterministic workspace evidence; [scripts/seed.ts](scripts/seed.ts) makes the authenticated local paths accessible.
- [apps/web/content/docs](apps/web/content/docs) and [apps/web/content/blog](apps/web/content/blog) contain the public explanations and runnable examples.
- [apps/web/e2e](apps/web/e2e) contains browser tests for the Reference Application. Test files describe intended coverage; passing claims require an observed run.
- There are no production users to substantiate customer adoption claims. Do not invent customers, testimonials, usage metrics, or performance results. Provider-light billing examples must be identified as examples.

## Product Principles

1. Support evaluation with inspectable code, runnable commands, and working Reference Application behavior.
2. Keep business behavior consistent across the web app, REST, MCP, and background work through shared capabilities.
3. Make local evaluation possible without optional provider credentials, and report provider activation honestly.
4. Keep the included workflows useful as patterns for a B2B SaaS built from this repository.

## Brand Personality

Calm, inspectable, opinionated. The voice of a senior engineer walking you through a system they're proud of — precise, honest, allergic to hype. Emotional goal: trust through proof. Everything shown on the public site should be real: real module states from the Seed Workspace, real commands, real file paths. Never sell a fictional SaaS.

## Anti-references

- Generic AI-generated SaaS landing pages: gradient heroes, glassmorphism, glowing accents, identical icon-card grids, fake metrics, testimonial walls.
- Fictional-product marketing — the showcase describes the Starter itself, never an invented company.
- Consumer-product warmth (illustration-heavy, playful mascots). This is a tool for serious operators.
- Editorial-magazine affectation (drop caps, serif body text) — the brand is an engineering document, not a magazine. The landing hero's Newsreader is the one display-serif moment; every other surface runs Geist.

## Design Principles

1. **Show, don't sell.** Every claim on the public site is backed by something real on screen: live seed data, runnable commands, actual topology.
2. **Practice what you preach.** The showcase is rendered by the same stack it advertises; the page itself is the demo.
3. **One system end-to-end.** shadcn/ui primitives, Geist + Geist Mono, semantic tokens. The marketing surface may commit harder to the brand color than the workspace, but it is the same design system.
4. **Provider-light honesty.** Optional modules are presented as env-gated and inactive-by-default — never faked as "live".
5. **Restraint with one bold move per surface.** Quiet chrome, then a single committed moment (a drenched band, a schematic) that carries the identity.

## Accessibility & Inclusion

- The Starter ships English and Norwegian Bokmål. Public URLs carry the locale; app and auth paths remain unprefixed. App and email language follows the account preference, while guests use a language cookie or browser preference. [docs/i18n.md](docs/i18n.md) owns translation and formatting rules.
- WCAG 2.1 AA: body text ≥ 4.5:1, large text ≥ 3:1, visible focus rings, full keyboard paths.
- `prefers-reduced-motion` honored on every animation (entrances, schematic pulses).
- One scheme (Catppuccin Mocha) on every surface, public and authenticated, so contrast is verified against a single set of values.
- Semantic landmarks, skip link, and accessible names throughout the public site.
