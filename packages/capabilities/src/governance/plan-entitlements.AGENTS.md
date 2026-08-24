# plan-entitlements

## Context choice

Placed under `governance`, not a new `billing` folder: the capability governs
what a workspace may do, it reads only workspace-owned tables, and it holds no
provider, invoice, or checkout concept that would make billing a context of its
own. If Stripe arrives (ADR 0023 stays env-gated), subscriptions earn their own
context beside this one.

## Purpose

The workspace's plan, expressed as concrete per-resource limits, plus the one
service that judges them. Billing itself stays env-gated future work (ADR 0023)
— this capability owns only what a plan entitles a workspace to, so enforcement
does not wait on a payment provider.

## Public surface

- `PLANS` / `PLAN_IDS` / `ENTITLEMENT_RESOURCES` — the entitlement table as
  data. Adding a plan or changing a limit edits the record; no adapter changes.
- `limitFor(planId, resource)` — pure lookup. An unknown plan id fails closed
  to starter limits (`seed-fixture.ts`'s demo workspace carries `'team'` for
  exactly this path).
- `PlanEntitlements` service:
  - `checkLimit(resource)` — resolves usage from `WorkspaceContext`, returns a
    `UsageSnapshot` `{ planId, resource, used, limit }`, and fails typed with
    `EntitlementExceeded` (402) when `used >= limit`. This is THE enforcement
    seam.
  - `usage` — every resource's snapshot without the refusal; the settings-page
    read. It succeeds at and over a limit.
- `SeedPlanEntitlements({ planId, apiTokens, webhookEndpoints, members })` —
  plain counts, because entitlements only read how many.
- `LivePlanEntitlements` — three `count()` queries against D1 (unrevoked API
  tokens, webhook endpoints, members), keyed by the context workspace.

## Enforcement at the mutation seams

`ApiTokenRegistry.create`, `WebhookEndpoints.create`, and
`WorkspaceInvitations.create` depend on this service and call `checkLimit`
before writing or auditing — in BOTH adapters, so Seed and Live refuse
identically (capabilities invariant 4). Their error channels therefore carry
`EntitlementExceeded`; callers get one class everywhere.

## Anti-patterns

- Don't add per-resource `if` branches in adapters. Limits are data in `PLANS`;
  the adapters only count and compare through `isAtLimit`.
- Don't widen the interface with per-resource methods. Two methods cover both
  enforcement (`checkLimit`) and display (`usage`).
- Don't grant headroom on an unknown plan id. The fallback is the most
  restrictive plan, deliberately.
- Members are counted, not invitations: the invitation seam checks `members`
  because accepting is what grows the workspace.
