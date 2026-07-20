# Operations Vertical Slice

Status: ready-for-agent

## Problem Statement

The platform needs a safe way for trusted staff to investigate Merchant problems and reproduce a Merchant Member's experience. The current authenticated application is intentionally Merchant-scoped, so its roles and memberships cannot grant platform-wide support authority. The remaining historical admin code and documentation do not provide a coherent security boundary, a complete operator lifecycle, durable impersonation evidence, or a safe path into the Merchant App.

Reusing Merchant membership as staff authority would allow tenant data to influence platform administration. Reusing a single Better Auth realm would also risk cookie, secret, origin, and session confusion between ordinary Merchant Members and System Operators. Exposing Better Auth's stock administration endpoints would grant broader user and session powers than the first Operations release requires. Implementing the legacy admin surface wholesale would further import obsolete business scope—including customer, billing, loan, wage, import, and destructive workflows—before the core support path is proven safe.

System Operators therefore cannot currently discover a Merchant, inspect the minimum useful Member facts, enter a controlled impersonated Merchant Session, or review a durable global record of that activity. Merchants also lack clear in-product disclosure while an operator is acting, and target Members are not notified when impersonation begins or ends.

## Solution

Create a separate staff-only Operations App and Operations Auth realm for one narrow Operations Vertical Slice: provision and authenticate System Operators, discover Merchants and Merchant Members, safely impersonate an eligible Merchant Member for at most one hour, and review the resulting global impersonation audit history.

Operations Auth will use Better Auth's admin access-control model with explicit custom resources and permissions. Better Auth will remain the source of truth for operator identity, multiple assigned roles, TOTP and backup-code enrollment, authoritative sessions, and the `impersonatedBy` provenance on the resulting Merchant Session. The product will not create parallel operator-role or permission tables and will not expose Better Auth's stock user/session administration endpoints.

An Effect capability will own product-specific impersonation policy. It will require `merchant:impersonate`, a reason, a fresh TOTP challenge, eligible and enabled operator and target identities, and available operator/target concurrency slots. It will create a single-use 60-second Impersonation Handoff Ticket whose plaintext travels only in a top-level POST from the Operations App to the Merchant App. The Merchant App will atomically consume the ticket and create a reduced-authority, host-only Impersonated Merchant Session without replacing any existing normal Merchant Session.

The feature will retain only the new business records that Better Auth does not represent: the Impersonation Record state machine, the global audit facts, and durable notification/outbox state. Every protected impersonated request will re-evaluate current authority and security state. The Merchant App will show a persistent banner with the target, Merchant, operator disclosure, countdown, and stop action. Start and termination events will notify the target Member without exposing the internal reason or operator identity.

## User Stories

1. As a System Operator, I want a dedicated Operations App, so that platform support activity is isolated from Merchant work.
2. As a Merchant Member, I want Merchant membership never to grant Operations authority, so that tenant-controlled data cannot create platform administrators.
3. As a System Operator, I want my operator identity to be separate from every Merchant Member and Customer Account identity, so that authority cannot cross identity classes accidentally.
4. As a security reviewer, I want Operations and Merchant authentication to use separate secrets, base URLs, trusted origins, and cookie namespaces, so that credentials cannot be replayed across applications.
5. As a System Operator, I want to sign in with a verified dedicated email and password, so that Operations access is attributable to one staff identity.
6. As a security reviewer, I want public and self-service operator registration disabled, so that untrusted users cannot enroll as staff.
7. As the first platform maintainer, I want an idempotent bootstrap command for one existing verified dedicated email, so that the first operator can be established safely.
8. As the first platform maintainer, I want production bootstrap to require explicit environment targeting, so that a local command cannot silently grant production authority.
9. As a security reviewer, I want bootstrap to reject an email already used by a Merchant Member or Customer Account, so that identity classes remain disjoint.
10. As an Operator Manager, I want to invite a new operator at a new dedicated email with assigned roles, so that the Operations team can grow without public signup.
11. As an Operator Manager, I want invitations to expire after 24 hours, be single-use, and be revocable, so that stale enrollment links do not remain valid.
12. As an invited operator, I want invitation acceptance to create a 30-minute enrollment-only session, so that I can configure security without receiving Operations permissions prematurely.
13. As an invited operator, I want the enrollment session limited to password setup, email verification, TOTP enrollment, backup-code confirmation, and sign-out, so that unfinished enrollment cannot access operational data.
14. As an invited operator whose enrollment session expired after password setup, I want sign-in to resume mandatory enrollment, so that I do not require a replacement invitation.
15. As a System Operator, I want TOTP enrollment to be mandatory before any Operations access, so that password compromise alone is insufficient.
16. As a System Operator, I want backup codes generated and explicitly confirmed during enrollment, so that I have a controlled recovery factor.
17. As a security reviewer, I want password-only access and 2FA downgrade paths rejected, so that every enabled operator remains protected by TOTP.
18. As a System Operator, I want one authoritative Operator Session at a time, so that forgotten sessions cannot accumulate.
19. As a System Operator, I want a new sign-in to revoke my previous Operator Session and any impersonation derived from it, so that session replacement has immediate effect.
20. As a security reviewer, I want an Operator Session to expire after eight absolute hours or 30 idle minutes, so that staff authority is time-bounded.
21. As a security reviewer, I want Operator Session and role state read authoritatively from D1 without a permissive cookie cache, so that revocation and permission changes take effect immediately.
22. As an Operator Manager, I want to assign multiple predefined Better Auth roles to an operator, so that least-privilege responsibilities can be composed.
23. As a Merchant Reader, I want only `merchant:read`, so that I can investigate Merchant identity and readiness without impersonating anyone.
24. As a Merchant Impersonator, I want `merchant:read` and `merchant:impersonate`, so that I can discover an eligible target before starting support access.
25. As an Impersonation Auditor, I want only `impersonation-audit:read`, so that review can remain independent from operational access.
26. As an Operator Manager, I want `operator:manage`, so that I can invite, enable, disable, and assign roles to other operators.
27. As a security reviewer, I want no Operations role to inherit Better Auth's stock user or session administration permissions, so that unrelated administration endpoints remain unavailable.
28. As a System Operator, I want attempts to call every stock Better Auth administration endpoint denied, so that the custom Operations surface is the only supported path.
29. As an Operator Manager, I want self-permission changes rejected, so that I cannot elevate or entrench my own account.
30. As an Operator Manager, I want removal, disablement, or deletion of the last enabled Operator Manager rejected, so that the platform cannot lose its managed administration path.
31. As an Operator Manager, I want disabling an operator to revoke the Operator Session and derived impersonation atomically, so that access stops immediately.
32. As a security reviewer, I want every role change evaluated on the next protected request, so that stale sessions cannot retain removed permissions.
33. As a platform maintainer, I want an emergency recovery command for a named operator who lost TOTP and backup codes, so that recovery does not require a hidden web bypass.
34. As a security reviewer, I want emergency recovery to require explicit production targeting, revoke sessions and impersonation, disable the old factor, force re-enrollment, and create a global audit event, so that recovery is controlled and visible.
35. As a local developer, I want a deterministic local-only operator with password, TOTP secret, and roles, so that I can exercise every Operations state without external providers.
36. As a security reviewer, I want local seed credentials structurally prevented from running in production, so that deterministic secrets cannot escape development.
37. As a Merchant Reader, I want to search Merchants by id, name, or slug, so that I can find the tenant associated with a support request.
38. As a Merchant Reader, I want to search Merchant Members by id, name, or email, so that I can find the exact support target.
39. As a Merchant Reader, I want Merchant detail to show identity, status, public page, readiness, and Members, so that I can understand the Merchant's operational context.
40. As a Merchant Reader, I want Member detail to show name, email, verification and enabled state, membership, active session count, and last sign-in, so that I can assess target eligibility.
41. As a Merchant Member, I want Operations read views to exclude passwords, bearer tokens, secrets, full session tokens, and unrelated Customer Details, so that investigation follows data minimization.
42. As a Merchant Reader, I want financial state visible only as inspectable facts permitted by the read contract, so that diagnosis does not grant monetary mutation authority.
43. As a System Operator without `merchant:read`, I want Merchant discovery and detail denied, so that UI visibility cannot substitute for permission checks.
44. As a Merchant Impersonator, I want only eligible enabled Merchant Members to be targetable, so that System Operators and Customer Accounts cannot be impersonated.
45. As a Merchant Impersonator, I want to provide a required internal Impersonation Reason and optional external support reference, so that every session has accountable purpose.
46. As a security reviewer, I want the internal reason access-controlled and excluded from URLs, ordinary logs, and target notifications, so that sensitive support context is not leaked.
47. As a Merchant Impersonator, I want to satisfy a fresh TOTP challenge no more than five minutes before starting impersonation, so that high-risk access requires recent user presence.
48. As a Merchant Impersonator, I want the start request rejected if I no longer have permission, my account is disabled, my TOTP is invalid, or the target is no longer eligible, so that stale page state cannot authorize access.
49. As a Merchant Impersonator, I want only one active impersonation at a time, so that my actions remain easy to attribute and control.
50. As a Merchant Member, I want only one operator impersonating me at a time, so that overlapping staff activity cannot create ambiguous changes.
51. As a Merchant Impersonator, I want overlap attempts rejected rather than replacing an active impersonation, so that an existing investigation is not silently disrupted.
52. As a security reviewer, I want a cryptographically random, single-use Impersonation Handoff Ticket that expires after 60 seconds, so that browser transfer is narrowly scoped.
53. As a security reviewer, I want only the ticket hash and lifecycle metadata persisted, so that a database read cannot recover a usable handoff credential.
54. As a security reviewer, I want the plaintext ticket sent by top-level POST and never placed in a URL, so that it does not leak through history, referrers, screenshots, or routine request logs.
55. As a Merchant Member, I want the Merchant App to reject handoff when my browser already has a normal Merchant Session, so that support access never overwrites or captures my personal session.
56. As a security reviewer, I want ticket consumption and Merchant Session creation to be atomic, so that partial activation cannot create an untracked session.
57. As a security reviewer, I want expired, replayed, mismatched, malformed, and partially processed tickets rejected, so that a handoff can produce at most one correct session.
58. As a Merchant Impersonator, I want a successful handoff to create a host-only Merchant Session carrying Better Auth's `impersonatedBy` provenance, so that downstream actions can identify the real operator.
59. As a security reviewer, I want an Impersonation Record to move explicitly through Pending Handoff, Active, Stopped, Expired, or Revoked, so that business lifecycle is not inferred from audit text or session presence.
60. As a security reviewer, I want every protected impersonated request to recheck the operator, permission, TOTP enrollment, target, membership, Merchant, and relevant security revocations, so that active access fails closed when facts change.
61. As a Merchant Impersonator, I want revocation of any required fact to terminate access immediately, so that the visible session cannot outlive its authority.
62. As a Merchant Member, I want impersonated authority reduced below my normal authority, so that support cannot perform high-risk actions merely because I can.
63. As a Merchant Member, I want impersonation to deny identity and security changes, MFA changes, identity deletion, Merchant ownership changes, long-lived credential creation or rotation, monetary movement, payout or billing destination changes, destructive deletion, and bulk wipes, so that support access cannot take irreversible control.
64. As a Merchant Impersonator, I want reversible operational actions such as service or schedule edits available when the target could perform them, so that I can reproduce and resolve ordinary support problems.
65. As a security reviewer, I want every successful or failed mutation during impersonation attributed to the real operator, target Member, Merchant, and impersonation, so that the audit record never misidentifies the actor.
66. As a Merchant Member, I want a persistent non-dismissible banner on every impersonated Merchant screen, so that staff activity is never visually confused with an ordinary Member Session.
67. As a Merchant Impersonator, I want the banner to show the target Member, Merchant, that an operator is acting, the remaining time, and a stop action, so that scope and termination are always available.
68. As a Merchant Impersonator, I want an impersonation to end after one absolute hour without sliding or refresh, so that support access cannot become indefinite.
69. As a Merchant Impersonator, I want continuation beyond one hour to require a new reason and fresh TOTP challenge, so that extended access is a new accountable decision.
70. As a Merchant Impersonator, I want manual stop, expiry, and revocation to clear only the impersonation cookie and return me to the target Member detail in Operations, so that my separate Operator Session remains usable.
71. As a Merchant Member, I want the platform to notify me when impersonation starts and when it is stopped, expires, or is revoked, so that staff access is transparent.
72. As a Merchant Member, I want the notification to include the Merchant, timestamp, optional support reference, and security contact but not the internal reason or operator identity, so that it is useful without exposing staff-only context.
73. As a platform operator, I want the lifecycle transition and notification intent committed together, so that notification delivery can be retried without losing the underlying fact.
74. As a platform operator, I want email delivery to be asynchronous and retryable without blocking the impersonation transition, so that provider failure does not corrupt session state.
75. As a security reviewer, I want production Operations to fail closed when email is not configured, so that required transparency cannot be silently disabled.
76. As a local developer, I want a deterministic email capture adapter, so that notification content and lifecycle can be verified without a provider.
77. As an Impersonation Auditor, I want a global history of start attempts, handoffs, activation, termination, rejection, sensitive reads, and every attempted mutation, so that staff activity can be investigated end to end.
78. As an Impersonation Auditor, I want audit entries to include the real operator, target, Merchant, impersonation session, reason, support reference, action, result, and timestamp, so that evidence is complete.
79. As a Merchant Member, I want routine navigation and nonsensitive reads excluded from per-request audit noise, so that meaningful events remain reviewable.
80. As an Impersonation Auditor, I want sensitive reads—including Customer Details, financial facts, credential metadata, and other designated sensitive records—audited, so that access to high-impact information is visible.
81. As a compliance reviewer, I want impersonation audit evidence retained for two years and to survive operator, Member, or Merchant deactivation or deletion, so that historical accountability is durable.
82. As a privacy reviewer, I want stable identifiers retained without retaining reusable credentials or leaking reasons and support references into logs, so that durability does not create unnecessary exposure.
83. As a security reviewer, I want dedicated rate-limit categories for sessions, authentication and TOTP, search, invitation and permission management, impersonation starts, and handoff exchange, so that one control cannot mask attacks on another surface.
84. As a security reviewer, I want rate limits to use appropriate composite identities and to audit repeated failures, so that distributed and targeted abuse can be detected.
85. As a maintainer, I want the legacy global auth factory, obsolete admin remnants, and stale public administration documentation removed at cutover, so that the repository has one supported Operations model.
86. As a maintainer, I want the existing Merchant Auth contract to remain narrow and unchanged, so that adding Operations does not broaden tenant authentication.
87. As a maintainer, I want optional Cloudflare Access documented as deferred rather than assumed, so that application-layer controls are complete on their own.
88. As a maintainer, I want the first implementation step to prove cross-application auth and handoff behavior in a focused integration spike, so that uncertain Better Auth mechanics are resolved before the UI is expanded.
89. As a release owner, I want the complete authentication, authorization, handoff, lifecycle, audit, notification, and browser matrix to block release, so that the feature cannot ship on partial security evidence.

## Implementation Decisions

- Implement the browser-facing Operations App with the repository's TanStack Start, TanStack Router, React, Vite, and Cloudflare conventions. Keep it deployed as the same dedicated sixth Worker and preserve its separate auth realm, origin, bindings, and deployment identity.
- Represent sign-in, TOTP, enrollment, discovery, Merchant and Member detail, operator management, audit review, and impersonation initiation as typed React routes. Route loaders and server functions adapt transport-neutral Effect capabilities and Better Auth; they do not duplicate authorization, lifecycle, rate-limit, audit, notification, or mutation rules.
- Preserve readiness, Better Auth callbacks, deterministic local email capture, and cross-origin handoff exchange as explicit non-page HTTP contracts. The Impersonation Handoff Ticket remains URL-free and is submitted only by top-level POST to the Merchant App.
- Keep the existing D1 schema and persisted operator, invitation, audit, handoff, impersonation, and notification facts compatible. The UI migration requires no destructive data migration.
- Add the Operations App as a sixth Cloudflare Worker with its own origin, Better Auth base URL, trusted origins, secret, host-only cookie prefix, and rate-limit configuration. It shares D1 and business capabilities with the other first-party applications but does not share browser credentials.
- Introduce a dedicated Operations Auth factory. Do not reuse the legacy global auth factory or the narrow Merchant Auth factory. Keep Merchant Auth behavior unchanged.
- Use Better Auth's admin access-control extension as the sole source of operator roles and permissions. Do not add System Operator, role, or permission tables parallel to Better Auth.
- Define four composable roles: Merchant Reader (`merchant:read`), Merchant Impersonator (`merchant:read` and `merchant:impersonate`), Impersonation Auditor (`impersonation-audit:read`), and Operator Manager (`operator:manage`). Do not grant wildcard, stock user-administration, or stock session-administration permissions.
- Expose only product-owned Operations contracts. Do not expose or internally call Better Auth's raw impersonate-user endpoint or other stock administration endpoints.
- Put impersonation policy behind a transport-neutral Effect capability. The capability owns eligibility, permission, fresh-TOTP, reason, concurrency, reduced-authority, transition, revocation, audit, and notification invariants; route handlers and UI do not duplicate them.
- Start implementation with a focused Better Auth integration spike. It must prove secret and cookie isolation, handoff issue and atomic consumption, replay and expiry rejection, creation of a Merchant Session with `impersonatedBy`, existing Merchant Session rejection, manual stop and return, and fail-closed activation. Expand the application only after this seam is demonstrated.
- Model System Operator, Merchant Member, and Customer Account as disjoint identity classes. Bootstrap, invitations, sign-in, and impersonation all reject cross-class identity reuse.
- Disable public operator signup. Bootstrap the first operator through an idempotent Bun command against an existing verified dedicated email. Require an explicit flag for remote production targeting, assign requested Better Auth roles, create no Merchant membership, and emit a global audit event.
- Provision later operators through Operator Invitations created by an Operator Manager. Invitations target a new dedicated email, carry assigned roles, expire after 24 hours, are single-use, and can be revoked.
- Invitation acceptance creates a permissionless enrollment session lasting 30 minutes. Enrollment permits only password setup, email verification, TOTP enrollment, backup-code confirmation, and sign-out. A subsequent sign-in resumes incomplete enrollment without requiring a new invitation.
- Require Better Auth TOTP and confirmed backup codes for every enabled System Operator. Permit no password-only operational session or web-based factor downgrade.
- Implement emergency factor recovery only as an explicitly production-targeted Bun command. It revokes the Operator Session and derived impersonation, disables the old second factor, forces re-enrollment, and creates a global audit event.
- Provide a deterministic local-only operator seed with password, TOTP secret, and roles, guarded so it cannot execute in production.
- Limit each System Operator to one active Operator Session. A new sign-in atomically revokes the previous session and derived impersonation. Use an eight-hour absolute lifetime and 30-minute idle timeout with no sliding extension beyond the absolute limit.
- Read current Operator Session, enabled state, TOTP enrollment, and Better Auth roles authoritatively from D1 for protected requests. Do not use a permissive cookie cache for Operations authorization.
- Apply role changes immediately. Prevent self-role changes and prevent disabling, deleting, or removing the management permission from the last enabled Operator Manager. Disabling an operator atomically revokes the Operator Session and derived impersonation.
- Limit the first read surface to Merchant search by id, name, or slug; Member search by id, name, or email; Merchant identity, status, public page, readiness, and Members; and Member identity, verification/enabled state, membership, active-session count, and last sign-in.
- Never return passwords, bearer tokens, secret values, full session tokens, unrelated Customer Details, or credential material through Operations read contracts. Normal Member-session revocation is not part of this slice.
- Allow only enabled Merchant Members to be impersonated. The current eligible membership may be owner-only if that is the only implemented Merchant role. Never impersonate a System Operator or Customer Account.
- Require a non-empty internal Impersonation Reason and allow an optional external support reference. Keep both access-controlled; exclude the reason from URLs, ordinary logs, and target notifications.
- Require a successful TOTP challenge within five minutes of each impersonation start. Re-check current operator permission, identity state, target eligibility, Merchant membership, and concurrency at the authoritative start boundary.
- Permit at most one Active or Pending Handoff impersonation per operator and per target. Reject overlap rather than replacing an existing lifecycle.
- Issue a cryptographically random single-use Impersonation Handoff Ticket with a 60-second lifetime. Persist only a one-way hash and lifecycle metadata. Submit plaintext through a browser top-level POST to the Merchant App; never place it in a URL.
- Have the Merchant App reject a handoff if the browser already carries a normal Merchant Session. Do not overwrite, preserve for restoration, or merge an existing normal session.
- Atomically consume the ticket, validate every bound fact, create a host-only Impersonated Merchant Session with Better Auth's `impersonatedBy` provenance, and activate the Impersonation Record. Expired, replayed, mismatched, malformed, or partial handoffs fail closed.
- Add an Impersonation Record because Better Auth sessions do not model the required product lifecycle. It links stable operator, Operator Session, target Member, Merchant, reason, optional support reference, ticket hash, resulting Merchant Session, timestamps, and termination cause, and moves through Pending Handoff, Active, Stopped, Expired, or Revoked.
- Enforce a one-hour absolute Impersonated Merchant Session lifetime with no sliding or refresh. Continuing requires a new lifecycle, reason, and fresh TOTP challenge.
- Re-authorize every protected impersonated request against current D1 facts: enabled operator, active Operator Session, TOTP enrollment, `merchant:impersonate`, enabled target, current target membership in the same Merchant, active Impersonation Record, and unreleased security state. Any failure immediately revokes the lifecycle and session.
- Apply reduced authority as an intersection of target Member authority and the impersonation allowlist. Deny identity and security changes, MFA changes, identity deletion, Merchant ownership changes, long-lived credential creation or rotation, monetary movement, payout or billing destination changes, destructive entity deletion, and bulk wipes. Allow financial inspection and reversible service or schedule operations when otherwise authorized.
- Show a persistent non-dismissible Merchant App banner on every impersonated screen. It identifies the target Member and Merchant, states that an operator is acting, displays the absolute countdown, and provides a stop action.
- Manual stop, expiry, or revocation clears the impersonation cookie and returns the browser to the target Member detail in Operations. The separately scoped Operator Session remains active unless its own state caused revocation. No normal Merchant Session is restored.
- Record an Impersonation Audit Trail for every start attempt, handoff, stop, expiry, revocation, rejection, successful or failed mutation, and designated sensitive read. Routine navigation and nonsensitive reads do not create per-request entries.
- Attribute audit entries to stable real-operator, target, Merchant, Operator Session/impersonation, reason, optional support reference, action, result, and timestamp facts. Retain the trail for two years and prevent deletion cascades from erasing it when live identities are disabled or deleted.
- Persist notification intent/outbox state with each start or terminal lifecycle transition. Deliver asynchronously with retry; delivery failure does not roll back or block the lifecycle transition.
- Notify the target Member at start and at stopped, expired, or revoked termination. Include the Merchant, timestamp, optional support reference, and security contact. Exclude the internal reason and operator identity.
- Require a working email adapter in production and fail Operations startup/readiness closed if it is missing. Use a deterministic capture adapter for local development and tests.
- Configure separate rate-limit categories for session and read traffic, authentication and TOTP, search, invitations and permissions, impersonation starts, and handoff exchange. Use suitable composite keys and audit repeated security-relevant failures.
- Keep Cloudflare Access outside the first slice. The Operations App must be secure without it; it can be added later as an independent defense-in-depth decision.
- At cutover, remove the obsolete global auth/admin implementation and stale public documentation that describes the superseded administration model. Keep the accepted Operations decisions and canonical terminology as the only supported model.

## Testing Decisions

- Add a fast architecture regression test that requires the Operations package to declare TanStack Start, TanStack Router, React, and Vite; use the Start Vite plugin and server entry; and generate the complete typed route tree.
- Drive browser-facing Operations journeys through the hydrated TanStack routes while retaining the existing D1, Better Auth, capability, handoff, notification, rate-limit, and security-matrix suites as authoritative invariant coverage.
- The highest primary seam is an integration test spanning Operations Auth, the impersonation capability, D1, the browser handoff request, Merchant Auth, and the resulting Merchant Session. It must prove the actual cross-application security contract rather than mocks of Better Auth internals.
- A good test asserts externally observable authorization, session, lifecycle, audit, notification, redirect, or UI behavior. It does not assert private Effect implementation, internal query shape, component structure, or incidental Better Auth internals.
- Make the focused Better Auth integration spike a release prerequisite. It covers separate secrets, origins, and cookie names; ticket issuance and atomic exchange; 60-second expiry; replay, mismatch, malformed, and partial-processing rejection; existing Merchant Session rejection; `impersonatedBy`; stop and return; and fail-closed activation.
- Add Operations Auth integration coverage for no public signup, invitation expiry/revocation/single use, enrollment-only permissions, enrollment resumption, mandatory TOTP and backup-code confirmation, password-only denial, recovery, one active session, eight-hour absolute expiry, 30-minute idle expiry, and immediate session replacement.
- Add authorization contract coverage for every custom role alone and in composition, absence of wildcard authority, immediate role changes, self-change denial, last-manager protection, disabled-operator revocation, identity-class disjointness, and denial of every stock Better Auth admin endpoint.
- Add capability-level state-machine and transaction tests for Pending Handoff, Active, Stopped, Expired, and Revoked transitions; operator and target concurrency; reason and fresh-TOTP requirements; atomic ticket consumption; absolute one-hour expiry; and revocation on each authoritative fact change.
- Add reduced-authority contract tests that enumerate every denied action category and representative allowed reversible operations. Prove that financial reads do not imply monetary mutation and that target authority cannot expand the impersonation allowlist.
- Add audit tests for all required start attempts, handoffs, lifecycle transitions, rejected actions, successful and failed mutations, and sensitive reads. Prove attribution to the real operator, survival after referenced identities are disabled or deleted, two-year retention classification, and exclusion of reasons and secrets from ordinary logs.
- Add notification/outbox tests proving atomic intent creation with lifecycle transitions, start and every terminal template, retry behavior, idempotent delivery, non-blocking provider failure, privacy of reason/operator identity, production fail-closed configuration, and deterministic local capture.
- Add browser end-to-end coverage for search-to-target flow, fresh TOTP start, top-level POST handoff, persistent banner on every Merchant screen, correct target and Merchant disclosure, countdown, reduced-authority errors, manual stop, automatic expiry, revocation, and return to Operations detail.
- Add browser coverage proving a pre-existing normal Merchant Session blocks handoff and remains untouched, while stop never attempts to restore or manufacture a normal Merchant Session.
- Add cookie and origin tests from the browser boundary proving host-only Operations and Merchant cookies are not sent to the other application and that untrusted origins cannot participate in authentication or handoff.
- Add rate-limit tests for each dedicated category, composite-key isolation, recovery after the configured window, and audit generation for repeated security-relevant failures.
- Add local-development tests proving deterministic operator and captured email behavior, plus production guards proving local seed material is rejected.
- Use the repository's existing Effect service and D1 integration-test patterns for capability and transaction behavior, and its existing browser test approach for user-visible lifecycle behavior. Extend existing seams rather than introducing a parallel testing framework.
- Treat the full matrix as release-blocking: auth realm separation; mandatory TOTP, enrollment, recovery, and single-session behavior; role and stock-endpoint denial; identity disjointness; ticket expiry/replay/mismatch/existing-session rejection; concurrency; reduced authority; immediate revocation; one-hour expiry; audit attribution and retention; durable notifications; persistent banner; stop; expiry; and return flows.

## Out of Scope

- Full parity with the legacy administration application's Brand, Shop, Customer, import, billing, loan, wage, and broad destructive management surfaces.
- Direct Operations workflows for monetary movement, payouts, billing destination changes, credential rotation, Merchant ownership changes, destructive entity deletion, or bulk wipes.
- Impersonation of System Operators, Customer Accounts, or identities that are not enabled Merchant Members.
- Target-Member approval before impersonation. Transparency is provided through the persistent banner, lifecycle evidence, and start/termination notifications in this slice.
- Revoking ordinary Merchant Member sessions from the Operations App. A future workflow requires its own permission, reason, and audit contract.
- Cloudflare Access. It is deferred and must not be assumed by the application security model.
- A parallel operator, role, or permission schema. Better Auth custom access control remains authoritative for these facts.
- Direct use of Better Auth stock administration and raw impersonation endpoints.
- Restoring a normal Merchant Session after impersonation or allowing handoff to overwrite one.
- Sliding or refreshable impersonation beyond the one-hour absolute lifetime.
- Per-request audit of routine navigation and nonsensitive reads.
- Shipping the UI before the focused cross-application Better Auth handoff spike passes.

## Further Notes

- This specification is the synthesis of the completed Operations App grilling session and the accepted domain and architecture decisions. The testing seams were explicitly agreed during that session, so no additional interview was required before publication.
- The legacy admin source was used as an inventory of possible staff outcomes, not as an authorization or architecture template. The first release intentionally chooses the smallest support-complete slice instead of reproducing legacy breadth.
- Better Auth's admin plugin removes the need for new operator-role and permission tables. The Impersonation Record, audit trail, and notification outbox are separate because they encode product lifecycle, compliance, and delivery facts that Better Auth does not own.
- The accepted decision records cover separate auth realms, mandatory operator 2FA and recovery, impersonation audit, separate Worker topology, one-time handoff, first-slice scope, operator provisioning, Effect-wrapped impersonation, Better Auth custom roles, lifecycle state, target notification, two-year retention, required production email, dedicated rate limits, and retirement of obsolete public-site auth.
- Implementation should remain dependency-ordered: prove the Better Auth integration seam; establish the Operations realm and operator lifecycle; add least-privilege discovery; add handoff and lifecycle enforcement; add audit and notifications; then close the browser and release-blocking matrix.
