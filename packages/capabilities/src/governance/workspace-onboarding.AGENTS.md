# workspace-onboarding

## Purpose

The two facts the workspace onboarding checklist needs that no other
capability serves, plus its one mutation. The checklist itself is the
`workspaceProgress` projection in `../workspace-projections.ts`: every step
(invite a Member, create an API Token, add a Webhook Endpoint, enable
two-factor, choose a plan) is derived live from the membership, API-token,
webhook, and billing capabilities on each read. **No step is stored** — a
revoked token un-ticks its step. Only the dismissal is persisted.

## Surface

- `dismissedAt` → `string | null`. Reads `workspaces.onboardingDismissedAt`
  (ISO on the wire, epoch integer in the plugin-shaped table).
- `actorTwoFactorEnabled` → `boolean`. Reads `user.twoFactorEnabled` for the
  actor in `WorkspaceContext`; `false` with no actor. Account-level fact
  served here because the checklist is the only consumer — if a second one
  appears, move it to an account capability.
- `dismiss` → `boolean`. Sets the column and records
  `workspace.onboarding_dismissed` in one D1 batch (`audited-mutation.ts`).
  Idempotent: an already-dismissed workspace resolves `false` and writes
  nothing. Authorization (`onboarding:dismiss`, owner and admin) is the
  caller's job — `apps/web/src/lib/server/workspace-onboarding.ts`.

Storage: `workspaces.onboardingDismissedAt`, starter-owned. It has **no**
`additionalFields` entry on the organization plugin on purpose: nothing that
returns through a plugin endpoint needs it, and only this capability reads
or writes it.

Seed adapter: `SeedWorkspaceOnboarding({ twoFactorUserIds, dismissedAt })`,
a `Ref` per layer so a dismissal reads back. `layers.ts` passes
`seedTwoFactorUserIds` so the demo owner's step stays open.

## Anti-patterns

- Don't add a stored "step completed" flag. Compute from the owning
  capability; that is the point of the projection.
- Don't check the actor's role here. The guard does.
- Don't read `user.twoFactorEnabled` from the session in the web layer to
  skip this read — the projection must produce the same answer for every
  Capability Interface.
