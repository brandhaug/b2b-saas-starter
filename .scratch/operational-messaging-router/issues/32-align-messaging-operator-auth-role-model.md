# Align the Messaging Operator Auth Role Model

Type: task
Status: resolved
Blocked by:

## Question

Implement one canonical, exhaustive Operations role registry for the five independently assignable Messaging Operator Roles: **Messaging Reader** (`messaging:read`), **Messaging Controller** (`messaging:control`), **Messaging Finance** (`messaging:finance`), **Messaging Reconciler** (`messaging:reconcile`), and **Messaging Incident Responder** (`messaging:incident`). Make the Operations capability permission map, Better Auth custom access control and role map, Operator invitation and role-management contracts, and both Operations App role selectors consume or exhaustively validate that registry so adding a role cannot leave another map stale. Grant exactly one Messaging Operator Permission per role, preserve explicit multi-role composition, grant and backfill no messaging role by default, retain `merchant-reader` as the Better Auth default, and prove fail-closed authorization, invitation, enrollment, management, impersonation denial, runtime role-map parity, and package/full-monorepo typechecking with focused tests.

## Comments

### Resolution — 2026-07-29

Implemented one typed Operations role registry and one typed Operator Permission
resource/action registry in commits `ea2e278` and `45f1777`.

- Added the five independently assignable Messaging Operator Roles with their exact
  one-permission grants and derived the role names, permission checks, schemas,
  display options, and Better Auth role map from the registries.
- Kept `merchant-reader` as the only Better Auth default; no migration or backfill
  grants a messaging role. Unknown stored roles are discarded and grant no
  authority.
- Preserved explicit multi-role invitation, enrollment, and management behavior and
  proved that messaging-only operators cannot impersonate a Merchant Member.
- Replaced both route-local role lists with one registry-backed Operations component,
  so invitation and management selectors cannot omit a newly registered role.

Verification passed for the focused Capabilities seams, all Auth tests (`2` files / `13`
tests), all Operations App tests (`10` files / `48` tests), affected package
typechecking, targeted linting and formatting, and all `25` monorepo typecheck/build
tasks from a clean detached checkout. Standards and Spec re-review found no remaining
findings. The required clean full-suite run reached `21` successful monorepo tasks
before an unrelated existing Merchant test failed at
`mobile-new-appointment-sheet.browser.test.tsx:652` because its queried element was
absent; Auth and Operations remained green.
