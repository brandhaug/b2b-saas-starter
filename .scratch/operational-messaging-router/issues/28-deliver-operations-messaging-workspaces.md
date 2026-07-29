# Deliver Operations Messaging Workspaces

Type: task
Status: resolved
Blocked by: 19, 25, 32

## Question

Implement the Operations App messaging health summary, masked cross-Merchant case queue and search, focused evidence journey, and separate Containment and Finance workspaces. Expose only purpose-built projections for intent and attempt identities, route progress, normalized evidence, reservations, charges, provider costs, reconciliation and complaints; never expose bodies, Confirmation URLs, raw callbacks, reusable references, credentials, or unmasked destinations. Enforce `messaging:read`, `messaging:reconcile`, `messaging:control`, `messaging:incident`, and `messaging:finance` independently, with authoritative permission rechecks, safe before/after previews, substantive reasons, confirmations, atomic audits, compensating ledger entries, two-person actions where required, impersonation denial, tenant-safe search, responsive behavior, keyboard accessibility, and browser tests.

## Comments

### Resolution — 2026-07-30

Delivered the purpose-built Operations Messaging workspaces and projections: health and masked case search, normalized case evidence with reconciliation/complaints and financial facts, independent Containment and Finance views, authoritative provider-query requests, scoped incident and recovery commands, credential-rotation evidence, exact current-state previews, and append-only compensating ledger corrections. Every privileged path rechecks its dedicated permission and requires the applicable reason and confirmation; existing governance retains two-person recovery and impersonation denial.

Verification passed for Capabilities typecheck and all 75 Capabilities test files (441 tests before the final focused additions), Operations typecheck/build, 20 mocked browser route tests plus the real hydrated browser runtime, strict changed-file lint/format checks, and two final Standards/Spec reviews with no remaining actionable findings.

Implementation commits: `061eeba`, `bee1970`, `786790a`, `5c0c5f7`.
