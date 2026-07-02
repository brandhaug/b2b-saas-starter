# Product

## Register

product

> Default register. The public Showcase Site (`/`, docs, blog, pricing) is a **brand** surface and is treated as such per task.

## Users

Senior TypeScript engineers and small teams evaluating a foundation for their next B2B SaaS. They arrive skeptical — usually at night, mid-evaluation, comparing starters — and they distrust marketing pages. They want to inspect the actual architecture, run it locally in minutes, and judge the code, not the copy. Secondary: developers already using the starter, returning for docs, changelog, and decision rationale.

## Product Purpose

The B2B SaaS Starter is a repository product: a Cloudflare-first foundation (TanStack Start, Effect v4, Drizzle D1, Better Auth, REST + MCP, Queues, Email) proven by a working Reference Application. The Showcase Site explains why the starter is a strong foundation; the Reference Application proves those claims with real, seeded, working features. Success = a visitor forks the repo and has it running locally without configuring a single external provider.

## Brand Personality

Calm, inspectable, opinionated. The voice of a senior engineer walking you through a system they're proud of — precise, honest, allergic to hype. Emotional goal: trust through proof. Everything shown on the public site should be real: real module states from the Seed Workspace, real commands, real file paths. Never sell a fictional SaaS.

## Anti-references

- Generic AI-generated SaaS landing pages: gradient heroes, glassmorphism, glowing accents, identical icon-card grids, fake metrics, testimonial walls.
- Fictional-product marketing — the showcase describes the Starter itself, never an invented company.
- Consumer-product warmth (illustration-heavy, playful mascots). This is a tool for serious operators.
- Editorial-magazine affectation (display serifs, drop caps) — the brand is an engineering document, not a magazine.

## Design Principles

1. **Show, don't sell.** Every claim on the public site is backed by something real on screen: live seed data, runnable commands, actual topology.
2. **Practice what you preach.** The showcase is rendered by the same stack it advertises; the page itself is the demo.
3. **One system end-to-end.** shadcn/ui primitives, Geist + Geist Mono, semantic tokens. The marketing surface may commit harder to the brand color than the workspace, but it is the same design system.
4. **Provider-light honesty.** Optional modules are presented as env-gated and inactive-by-default — never faked as "live".
5. **Restraint with one bold move per surface.** Quiet chrome, then a single committed moment (a drenched band, a schematic) that carries the identity.

## Accessibility & Inclusion

- WCAG 2.1 AA: body text ≥ 4.5:1, large text ≥ 3:1, visible focus rings, full keyboard paths.
- `prefers-reduced-motion` honored on every animation (entrances, schematic pulses).
- `prefers-color-scheme` honored; light and dark ship the same content and hierarchy.
- Semantic landmarks, skip link, and accessible names throughout the public site.
