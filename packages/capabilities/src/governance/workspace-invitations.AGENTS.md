# Workspace Invitations

## Purpose & Scope

The invitation half of workspace membership: invite an address, cancel a pending invitation, and accept one. Accepting is what turns an invited address into a member — [`workspace-membership`](workspace-membership.AGENTS.md) owns every other membership change.

Reads and writes split by direction, exactly as membership does:

- **Reads** (`list`, `find`) go straight through Drizzle.
- **Writes** (`create`, `cancel`, `accept`) go through Better Auth's `organization` plugin, so its state machine and its lifecycle hooks apply. This package never names the plugin — it calls `WorkspaceInvitationBinding`, and the app supplies the adapter (ADR 0051).

## Module layout

The capability is split along its section seams — no barrel file; consumers import the specific module:

- `workspace-invitations.ts` — shared contract: schemas (`Invitation`, `InvitationDetail`, `AcceptedInvitation`, `InvitationStatus`), input types, `WorkspaceInvitationsInterface` + service class, the `WorkspaceInvitationBinding` port, and the state-machine rules both adapters enforce (`requirePending`, `requireRecipient`, `requireUnexpired`).
- `workspace-invitations.seed.ts` — `SeedWorkspaceInvitations`, the fixture TTL, and its in-memory store helpers (`settle`, `findPending` — the `Ref` lookup, with the pending question delegated to the contract's `requirePending`).
- `workspace-invitations.live.ts` — `LiveWorkspaceInvitations`, the `callBinding` caller built from `makeBindingCaller`, and its query helpers (`toInvitation`, `pendingByEmail`).
- `workspace-invitations.contract.ts` — the shared **test** cases both adapters are run against (see capabilities invariant 4); not a source module.

## The accept path has no WorkspaceContext, and cannot have one

Every other workspace-scoped method reads the resolved workspace from `WorkspaceContext` (capabilities invariant 1). `accept` and `find` do not, and this is the load-bearing design decision of the capability.

`liveWorkspaceContext(slug, actor)` refuses an actor who is not a member of the workspace — deliberately, and non-disclosingly. The person accepting an invitation is never a member yet: membership is what accepting **creates**. An accept placed behind that layer could therefore never succeed.

So `accept` is keyed by **invitation id**, and resolves the workspace from the invitation row itself. That is the same shape `WorkspaceMembership.listWorkspacesForUser` takes for the same class of reason — an identity-keyed method that runs before any single workspace has been selected. In the web app it runs through `runCapabilities`, not `runWorkspaceCapabilities`.

This is not a hole in the authorization model. The invitation **is** the authorization: it names one address, and both adapters refuse a caller whose address does not match it.

## Public surface

- `Invitation` — `{ id, email, role, status, expiresAt }`. `status` is the plugin's own state machine (`pending | accepted | rejected | canceled` — note the plugin's single-`l` spelling). `expiresAt` is ISO on the wire; the column is an epoch integer.
- `InvitationDetail` — `Invitation` plus `workspaceSlug` / `workspaceName`. What `find` returns: the accept page holds only an id and cannot resolve a workspace by slug yet.
- `AcceptedInvitation` — `{ workspaceSlug, workspaceName, role }`. Enough to send the new member to their workspace.
- `WorkspaceInvitations.list` — every invitation of the current `WorkspaceContext`, settled ones included. A list that hid cancelled rows would make the cancel button look inert.
- `WorkspaceInvitations.create({ email, role })` — audits `workspace_invitation.sent`.
- `WorkspaceInvitations.cancel({ invitationId })` — audits `workspace_invitation.canceled`. Scoped to the workspace in context before the plugin is called, so one workspace cannot cancel another's invitation.
- `WorkspaceInvitations.find(invitationId)` — `Option<InvitationDetail>`. **No `WorkspaceContext`.** See above.
- `WorkspaceInvitations.accept({ invitationId, userId, email })` — adds the member and audits `workspace_invitation.accepted`. **No `WorkspaceContext`.** `email` is the accepting user's own address, checked against the invitation; `userId` is the audit actor.
- `WorkspaceInvitationBinding` — the write port: `create`, `cancel`, `accept`, all promise-returning. Supplied via `StarterEnv.invitationBinding` / `LiveCapabilitiesOptions.invitationBinding`.

`find` discloses the invited address to whoever holds the id. That is the capability being honest; deciding what to _show_ belongs to the caller. `invitationPreview` (`apps/web/src/lib/server/invitations.ts`) reveals the workspace only once the signed-in address matches, and collapses every other outcome into one opaque answer. It is an exported effect taking the viewer's address as an argument, so that rule is asserted directly against a seeded fixture rather than through a session.

## Errors

- `MembershipChangeRejected` (409) — the workspace refused: no such invitation, already settled, expired, addressed to somebody else, or an address that is already a member. The request was answerable and the answer is no.
- `CapabilityUnavailable` (503) — the store is unreachable, **or** no `invitationBinding` was configured (`reason: 'no_invitation_binding'`).

The Live adapter classifies a binding rejection by the thrown value's `statusCode`: 4xx becomes `MembershipChangeRejected`, everything else stays `CapabilityUnavailable`.

## The state-machine rules live here, not only in the plugin

`requirePending`, `requireRecipient` and `requireUnexpired` are checked by the Live adapter **before** it calls the binding, even though the plugin enforces both itself. Two reasons: the capability's answer then does not depend on which binding is wired, and the audit event needs the invitation row regardless. The recipient comparison lower-cases both sides because the plugin does — a mixed-case sign-up must not be refused its own invitation. The accept page's `invitationPreview` (`apps/web/src/lib/server/invitations.ts`) runs the same three over the row `find` returned, collapsing every refusal to one opaque "cannot be used", so the page never describes an invitation the accept would then reject.

## Storage

- Tables: `workspaceInvitations`, `workspaces`.
- Writes do not touch these tables directly — they go through the binding, and the adapter's plugin call does the write.
- `create` reads the new row back by `(workspaceId, email, status: 'pending')` rather than trusting the binding's return value, whose shape is exactly what this package refuses to name. The plugin allows only one pending invitation per address per workspace, which is what makes that lookup unambiguous.

## Seed / Live parity

`workspace-invitations.contract.ts` holds the cases both adapters must satisfy (capabilities invariant 4); `index.test.ts` runs them against Seed with no D1 and `workspace-invitations.live.test.ts` runs the same list against Live on a real one.

Two things the harnesses own, because no case can produce them through the interface:

- **An expired invitation.** Planted out of band, at `CONTRACT_EXPIRED_AT`. That constant is `1969-12-31` and the date is not a typo: `@effect/vitest`'s `it.effect` supplies a `TestClock` starting at epoch 0, so "now" inside every case is 1970-01-01 and a realistic-looking past date like 2020 is fifty years in that clock's _future_. `CONTRACT_UNEXPIRED_AT` is the counterpart.
- **Its own address.** The expired fixture is addressed to `expired@…`, not to the accepter, because both adapters refuse a second pending invitation to an address that already has one — sharing would block every other case, and the expiry case would then pass for the wrong reason.

`SeedWorkspaceInvitations` takes the **same `SeedRoster`** as `SeedWorkspaceMembership` (`layers.ts` builds one and hands it to both). Accepting adds a member, so two independent `Ref`s would let the seed adapters disagree about who is in the workspace — and a local demo would let someone accept an invitation without ever joining. Live needs no equivalent seam: the plugin owns both writes and both adapters read the same tables.

## Audit is not atomic

Invitation writes and their audit rows can diverge, for the reason recorded on [`workspace-membership`](workspace-membership.AGENTS.md): D1 rejects an explicit `BEGIN`, and a plugin write cannot join a `batch()`. Accepted and recorded, not an oversight to "fix" by dropping back to direct Drizzle writes.

## Status & follow-ups

- **`apps/api` creates no invitations, by decision.** Every invitation endpoint the plugin exposes is `requireHeaders: true`, and `createInvitation` additionally requires the caller to be a member holding `invitation:create`. The API worker authenticates with a bearer token and has no session. Issue #64 settled this: the worker does not get a session, and its `invitations.send` endpoint was removed rather than left emailing a link no recipient could accept. `apps/web` is the only supplier of an invitation adapter. Nothing in this capability changes — the port is still open to a second app if the session question is ever reopened.
- `Member` still carries no `pending` flag. The invitation list is a separate read, which suits the settings page; a combined "people" view would want them merged.
- Rejecting an invitation is not exposed. The plugin has `rejectInvitation`; no starter surface asks for it yet, and the accept page's "Not now" simply navigates away.

## Anti-patterns

- Don't put `accept` or `find` behind `WorkspaceContext`. Read the second section again — the accept would become unreachable.
- Don't add a permission guard to the accept path. The invitation is the authorization; a `requirePermission` there would ask whether a non-member may act inside a workspace, and the answer is always no.
- Don't write to `workspaceInvitations` from here. The plugin owns those rows; a direct insert skips its validation and its hooks.
- Don't import `@b2b-saas-starter/auth` to reach the plugin. `auth` and `capabilities` are siblings; the binding exists so neither depends on the other.
- Don't put the invitation id in a URL and treat it as secret. It is a lookup key, not a bearer token — the address check is what protects the workspace.
