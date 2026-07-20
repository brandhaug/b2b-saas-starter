# Tickets: Operations Vertical Slice

Status: ready-for-agent

These tickets build the staff-only Operations App defined in the [source specification](PRD.md), from isolated System Operator authentication through safe Merchant Member impersonation and release certification.

Work the **frontier**: any ticket whose blockers are all done. Tickets are ordered with blockers before the work they unlock. After the auth foundation lands, Bootstrap and Recovery, Invitation and Enrollment, Operator Management, Merchant Discovery, Audit Review, and Authentication Abuse Protection can proceed concurrently. Reduced Authority and Lifecycle Presentation can also proceed concurrently after activation.

## Prove the Isolated Better Auth Handoff

**What to build:** Give maintainers an executable integration spike that proves a browser can move from an isolated Operations Auth realm into a separately isolated Impersonated Merchant Session without sharing credentials or exposing Better Auth's stock administration surface.

**Blocked by:** None — can start immediately.

- [x] Operations and Merchant authentication use distinct secrets, base URLs, trusted origins, and host-only cookie names in the exercised environment.
- [x] A cryptographically random handoff credential is submitted to the Merchant boundary by top-level POST and never appears in the URL.
- [x] Successful atomic exchange creates a Merchant Session carrying the real operator through Better Auth's `impersonatedBy` provenance.
- [x] The exchange rejects expired, replayed, mismatched, malformed, and partially processed handoffs.
- [x] A browser with a normal Merchant Session is rejected without modifying that session.
- [x] Manual stop clears only the impersonation session and returns to the Operations boundary.
- [x] Activation fails closed when any required validation or persistence step fails.
- [x] The integration test exercises real Better Auth and D1 behavior rather than mocking the authentication boundary.
- [x] Findings that alter an accepted security decision are recorded before implementation proceeds.

## Establish Operations Auth and Contract Seams

**What to build:** Let a locally seeded System Operator complete mandatory TOTP sign-in and reach a protected Operations shell through a dedicated auth realm whose stable contracts allow independent workstreams to proceed safely.

**Blocked by:** Prove the Isolated Better Auth Handoff.

- [x] The Operations App runs as a separate Cloudflare Worker with its own origin, secret, base URL, trusted origins, cookie prefix, and configuration validation.
- [x] Better Auth custom access control defines Merchant Reader, Merchant Impersonator, Impersonation Auditor, and Operator Manager as composable roles with only their accepted permissions.
- [x] Public signup, raw impersonate-user, stock user administration, stock session administration, and wildcard authority are unavailable.
- [x] System Operator, Merchant Member, and Customer Account identities are treated as disjoint classes at the auth boundary.
- [x] A deterministic local-only operator can complete password and TOTP sign-in and reach the protected shell.
- [x] Local deterministic credentials are rejected outside local development.
- [x] Operator Sessions are authoritative in D1, limited to one per operator, expire after eight absolute hours or 30 idle minutes, and do not slide beyond the absolute limit.
- [x] A new Operator Session revokes the previous one.
- [x] Protected requests observe current enabled state, TOTP enrollment, and roles without a permissive cookie cache.
- [x] Transport-neutral Effect contracts and test fixtures establish stable seams for provisioning, discovery, audit, rate limiting, and impersonation work.
- [x] Contract and browser tests prove auth-realm isolation, mandatory TOTP, session limits, and denial of stock Better Auth admin endpoints.

## Bootstrap and Recover System Operators

**What to build:** Let a platform maintainer establish the first production System Operator and recover a named operator who has lost every second factor without creating a hidden web bypass.

**Blocked by:** Establish Operations Auth and Contract Seams.

- [x] Bootstrap targets an existing verified dedicated email and rejects identities belonging to a Merchant Member or Customer Account.
- [x] Bootstrap is idempotent, assigns explicit Better Auth roles, creates no Merchant membership, and never grants wildcard or stock admin permissions.
- [x] Remote production execution requires an explicit production target and confirmation of the intended email.
- [x] Re-running bootstrap cannot duplicate identities, broaden permissions implicitly, or change Merchant membership.
- [x] Emergency recovery requires an explicit target environment and exact operator email.
- [x] Recovery revokes the current Operator Session and every derived impersonation before changing second-factor state.
- [x] Recovery disables the old factor, forces TOTP and backup-code re-enrollment, and does not permit password-only Operations access.
- [x] Bootstrap and recovery each emit durable global audit evidence with actor, target, result, environment, and timestamp, without logging credentials.
- [x] Integration tests cover local use, explicit production targeting, identity collision, idempotency, revocation, failure rollback, and forced re-enrollment.

## Invite and Enroll System Operators

**What to build:** Let an Operator Manager invite a new dedicated staff identity and let the recipient complete a restricted security enrollment before receiving any Operations authority.

**Blocked by:** Establish Operations Auth and Contract Seams.

- [x] An Operator Manager can invite a new dedicated email and assign one or more accepted roles.
- [x] Invitations reject existing Merchant Member, Customer Account, and conflicting System Operator identities.
- [x] Invitations are single-use, revocable, and expire after 24 hours.
- [x] Acceptance creates a 30-minute enrollment-only session with no operational permissions.
- [x] Enrollment permits only password setup, email verification, TOTP enrollment, backup-code confirmation, and sign-out.
- [x] The operator cannot reach Operations data until email, TOTP, and backup-code requirements are complete.
- [x] If enrollment expires after password setup, normal sign-in resumes incomplete enrollment without requiring another invitation.
- [x] Password-only access and every supported second-factor downgrade path are rejected.
- [x] Invitation creation, revocation, acceptance, expiry, enrollment success, and enrollment failure create appropriate audit evidence.
- [x] Browser and integration tests cover happy path, replay, revocation, expiry, interrupted enrollment, and attempted permission escape.

## Manage Operator Roles and Sessions

**What to build:** Let an Operator Manager administer other System Operators while preserving least privilege, an available management path, and immediate control over active Operator Sessions.

**Blocked by:** Establish Operations Auth and Contract Seams.

- [x] Operator Managers can list operators and inspect enabled state, enrollment state, assigned roles, active-session state, and relevant timestamps without seeing credentials.
- [x] Operator Managers can assign and remove multiple predefined Better Auth roles from another operator.
- [x] Operators cannot change their own roles or enabled state.
- [x] Removing, disabling, or deleting the last enabled Operator Manager is rejected atomically.
- [x] Role changes are effective on the affected operator's next protected request.
- [x] Disabling an operator atomically revokes the active Operator Session.
- [x] Re-enabling an operator does not restore a revoked session or bypass TOTP.
- [x] Management actions and rejected attempts are durably audited with real actor, target, result, and timestamp.
- [x] UI and integration tests cover composed roles, immediate removal, self-change denial, last-manager protection, disablement, and stale-page submissions.

## Discover Merchants and Merchant Members

**What to build:** Let a Merchant Reader find a support target and inspect the minimum useful Merchant and Member facts without receiving mutation authority or sensitive credential material.

**Blocked by:** Establish Operations Auth and Contract Seams.

- [x] Merchant search accepts id, name, or slug and returns tenant-scoped identity and status results.
- [x] Merchant Member search accepts id, name, or email and identifies the associated Merchant and membership.
- [x] Merchant detail shows identity, status, public page, readiness, and Members.
- [x] Member detail shows name, email, verification and enabled state, membership, active-session count, last sign-in, and impersonation eligibility.
- [x] Only `merchant:read` grants discovery and detail access; UI visibility alone never grants it.
- [x] Read contracts exclude passwords, bearer tokens, secret values, full session tokens, unrelated Customer Details, and credential material.
- [x] Financial facts may be inspected only through the accepted read contract and never imply monetary mutation authority.
- [x] Disabled Members, unsupported identity classes, and mismatched Merchant membership are visibly ineligible for impersonation.
- [x] Search inputs are bounded and protected against cross-Merchant or sensitive-data leakage.
- [x] Capability, HTTP, and browser tests cover permissions, exact-match identifiers, partial search, empty results, disabled targets, sensitive exclusions, and stale eligibility.

## Review Global Operations Audit Events

**What to build:** Let an Impersonation Auditor review durable platform-wide Operations evidence while preserving stable historical attribution and protecting sensitive reasons and references.

**Blocked by:** Establish Operations Auth and Contract Seams.

- [x] Global Operations audit records retain stable real-operator, target, Merchant, action, result, and timestamp facts applicable to the event.
- [x] Audit persistence does not cascade-delete historical evidence when live operators, Members, or Merchants are disabled or deleted.
- [x] Events are classified for the accepted two-year impersonation retention policy.
- [x] Only `impersonation-audit:read` grants the global review surface.
- [x] Auditors can filter and inspect existing authentication, bootstrap, recovery, invitation, and management evidence as those producers become available.
- [x] Internal reasons and support references are access-controlled and never emitted to ordinary logs or unauthorised responses.
- [x] Credential values, session tokens, handoff plaintext, TOTP secrets, and backup codes are never stored as audit details.
- [x] Audit writes survive retry without producing misleading duplicate business events.
- [x] Persistence and UI tests cover permission denial, filtering, stable attribution, referenced-identity deletion, redaction, and retention classification.

## Protect Operations Authentication from Abuse

**What to build:** Protect System Operator sign-in and TOTP verification with independently configurable limits and reviewable failure evidence, while establishing the reusable control used by later Operations surfaces.

**Blocked by:** Establish Operations Auth and Contract Seams.

- [x] Session/read traffic and authentication/TOTP attempts use separate configurable rate-limit categories.
- [x] Keys combine the appropriate operator or submitted identity, source characteristics, and operation without leaking raw secrets.
- [x] Limits do not let high-volume harmless reads consume or reset high-risk authentication controls.
- [x] Responses communicate retryability without revealing whether a protected identity exists.
- [x] Repeated security-relevant failures create bounded, deduplicated audit evidence.
- [x] Successful authentication does not erase evidence or create an unlimited bypass.
- [x] Local development has deterministic limits suitable for tests without disabling the policy.
- [x] Contract tests cover category isolation, composite-key behavior, expiry/recovery, concurrency, neutral errors, and failure auditing.

## Create an Accountable Pending Handoff

**What to build:** Let an eligible Merchant Impersonator request a narrowly scoped handoff from Member detail with current authority, explicit purpose, recent user presence, and unambiguous concurrency.

**Blocked by:** Discover Merchants and Merchant Members; Review Global Operations Audit Events.

- [x] Starting from eligible Member detail requires `merchant:impersonate`, a non-empty internal Impersonation Reason, and an optional external support reference.
- [x] The operator must complete a successful TOTP challenge no more than five minutes before the authoritative start decision.
- [x] Start rechecks the enabled operator, active Operator Session, TOTP enrollment, current role, enabled target, current membership, Merchant match, and eligible identity class.
- [x] At most one Pending Handoff or Active impersonation exists per operator and per target; overlap is rejected rather than replaced.
- [x] A successful start creates an explicit Pending Handoff Impersonation Record and a cryptographically random ticket expiring after 60 seconds.
- [x] Only a one-way ticket hash and bound lifecycle metadata persist; plaintext is excluded from URLs and ordinary logs.
- [x] Successful and rejected attempts are audited with operator, target, Merchant, reason, optional support reference, result, and timestamp.
- [x] Expired Pending Handoffs release both concurrency slots deterministically.
- [x] Capability, transaction, and browser tests cover reason validation, fresh TOTP, stale permissions, disabled targets, identity mismatch, both concurrency dimensions, ticket secrecy, and expiry.

## Activate and Notify Impersonation

**What to build:** Let the Merchant App atomically consume a pending handoff, create the reduced-scope Impersonated Merchant Session, and durably notify the target Member that staff access has started.

**Blocked by:** Invite and Enroll System Operators; Create an Accountable Pending Handoff.

- [x] The browser submits the plaintext handoff ticket by top-level POST and the ticket never appears in a URL.
- [x] Consumption atomically validates the hash, expiry, lifecycle, operator, Operator Session, permission, target, Merchant, membership, and concurrency bindings.
- [x] A normal Merchant Session in the browser causes neutral rejection and remains untouched.
- [x] Successful consumption creates a host-only Impersonated Merchant Session with `impersonatedBy` and moves the record from Pending Handoff to Active.
- [x] Ticket replay, expiry, mismatch, malformed input, and partial persistence cannot produce another Merchant Session.
- [x] The Active transition and start Notification Intent commit together.
- [x] The target notification contains Merchant, timestamp, optional support reference, and security contact, while excluding the operator identity and internal reason.
- [x] Delivery is asynchronous, retryable, and idempotent; provider failure does not roll back activation.
- [x] Production readiness fails closed without a working email adapter, while local development uses deterministic capture.
- [x] The integration seam proves activation, provenance, notification content, replay rejection, normal-session preservation, and failure rollback end to end.

## Enforce Reduced Impersonation Authority

**What to build:** Allow an active System Operator to reproduce ordinary Merchant work while ensuring every request remains bounded by current operator authority, target authority, and the explicit impersonation allowlist.

**Blocked by:** Manage Operator Roles and Sessions; Activate and Notify Impersonation.

- [x] Every protected impersonated request rechecks enabled operator, active Operator Session, TOTP enrollment, `merchant:impersonate`, enabled target, current same-Merchant membership, Active lifecycle, and unreleased security state.
- [x] Effective authority is the intersection of target Member authority and the explicit impersonation allowlist.
- [x] Identity and security changes, MFA changes, identity deletion, Merchant ownership changes, long-lived credential creation or rotation, monetary movement, payout or billing destination changes, destructive deletion, and bulk wipes are denied.
- [x] Financial state remains inspectable without exposing mutation commands.
- [x] Representative reversible service and schedule operations work when the target Member is authorized.
- [x] Every successful or failed mutation is attributed to the real operator, target, Merchant, and impersonation.
- [x] Designated sensitive reads create audit evidence; routine navigation and nonsensitive reads do not create per-request noise.
- [x] Denied actions return stable, nonleaking errors and cannot be invoked by bypassing the UI.
- [x] Capability and integration tests enumerate every denied category, representative allowed actions, target-authority reduction, and audit attribution.

## Show and End the Impersonation Lifecycle

**What to build:** Make active staff access unmistakable on every Merchant screen and let it end predictably through manual stop, absolute expiry, or lifecycle revocation without disturbing a normal Merchant Session.

**Blocked by:** Activate and Notify Impersonation.

- [x] Every impersonated Merchant screen shows a persistent non-dismissible banner identifying the target Member and Merchant and stating that an operator is acting.
- [x] The banner shows an authoritative countdown to the one-hour absolute expiry and offers a stop action.
- [x] Impersonation never slides or refreshes past one hour; continuation requires a new reason and fresh TOTP in a new lifecycle.
- [x] Manual stop atomically marks the record Stopped, revokes the Merchant Session, and clears only the impersonation cookie.
- [x] Absolute timeout atomically marks the record Expired and denies further Merchant requests.
- [x] Revocation marks the record Revoked with a stable termination cause.
- [x] Stopped, Expired, and Revoked transitions commit their corresponding Notification Intent atomically.
- [x] Terminal notifications contain Merchant, timestamp, optional support reference, and security contact but exclude operator identity and internal reason.
- [x] Stop, expiry, and revocation return the browser to target Member detail in Operations while leaving the independent Operator Session active unless it caused termination.
- [x] No flow restores, creates, merges, or overwrites a normal Merchant Session.
- [x] Browser tests cover every banner state, countdown, stop, automatic expiry, revocation, notification, cookie clearing, and return path.

## Revoke Active Impersonation Immediately

**What to build:** Ensure that changing any security fact required by an Active impersonation terminates the session on its next protected request and leaves durable, correctly attributed evidence.

**Blocked by:** Manage Operator Roles and Sessions; Enforce Reduced Impersonation Authority; Show and End the Impersonation Lifecycle.

- [x] Removing `merchant:impersonate` revokes the affected Active impersonation immediately.
- [x] Disabling the operator atomically revokes the Operator Session and every derived impersonation.
- [x] Replacing the Operator Session revokes impersonation derived from the previous session.
- [x] Removing TOTP enrollment through the controlled recovery path revokes derived impersonation.
- [x] Disabling the target or removing/changing the target's Merchant membership revokes impersonation.
- [x] Relevant security-state revocation and explicit administrative revocation terminate access with stable causes.
- [x] Concurrent requests cannot use the session after the first authoritative revocation decision.
- [x] Revocation clears the impersonation cookie where possible, returns to Operations, and does not restore a normal Merchant Session.
- [x] Revocation audit and target notification are produced exactly once despite retries or concurrent requests.
- [x] Integration and browser tests exercise every revocation trigger, concurrency behavior, attribution, notification, and immediate denial.

## Complete Operations Security and Evidence Matrices

**What to build:** Give release owners one passing security and evidence matrix covering every Operations surface, lifecycle transition, browser boundary, rate-limit category, notification outcome, and retention obligation.

**Blocked by:** Review Global Operations Audit Events; Protect Operations Authentication from Abuse; Enforce Reduced Impersonation Authority; Show and End the Impersonation Lifecycle; Revoke Active Impersonation Immediately.

- [x] Global audit review includes start attempts, handoffs, activation, stop, expiry, revocation, rejection, sensitive reads, and every successful or failed mutation.
- [x] Impersonation evidence retains stable identifiers for two years and survives operator, Member, and Merchant disablement or deletion.
- [x] Internal reasons and support references remain permission-protected and excluded from ordinary logs, notification content where prohibited, and unauthorised views.
- [x] Dedicated rate-limit categories cover session/read, authentication/TOTP, search, invitation/permission management, impersonation start, and handoff exchange.
- [x] Every notification transition is atomic with its lifecycle fact, asynchronously retried, idempotent, and verifiable through deterministic local capture.
- [x] Cookie, secret, base-URL, and trusted-origin isolation is proven from the browser boundary.
- [x] The complete role matrix and every stock Better Auth admin endpoint denial are exercised.
- [x] Identity disjointness, invitation/enrollment, single Operator Session, absolute and idle limits, recovery, concurrency, reduced authority, and immediate revocation all have release-blocking coverage.
- [x] Browser coverage proves search-to-target, fresh TOTP, POST handoff, banner, allowed and denied actions, normal-session rejection, stop, expiry, revocation, and return.
- [x] Production configuration fails closed for missing secrets or email, while optional Cloudflare Access remains explicitly deferred.
- [x] The full matrix passes using the repository's established Effect, D1 integration, and browser-test seams without implementation-detail assertions.

## Cut Over to the Operations Model

**What to build:** Make the new Operations Vertical Slice the repository's only supported platform-administration model and leave the release verifiably runnable without broadening Merchant Auth.

**Blocked by:** Bootstrap and Recover System Operators; Complete Operations Security and Evidence Matrices.

- [x] The superseded global auth factory and obsolete admin runtime remnants are removed without changing the narrow Merchant Auth contract.
- [x] Stale public documentation describing the superseded administration model is removed or rewritten to use canonical Operations terminology.
- [x] Runtime, environment, setup, architecture, domain, and operator documentation describe the sixth Worker and separate auth realm consistently.
- [x] Bootstrap, invitation, local seed, emergency recovery, target notification, audit review, and impersonation operating procedures are documented.
- [x] Cloudflare Access remains documented as deferred and is not required for application correctness or security tests.
- [x] No parallel System Operator, role, or permission tables exist; Better Auth custom access control remains authoritative.
- [x] No stock Better Auth admin or raw impersonation endpoint is exposed by the supported Operations surface.
- [x] Builds, migrations, unit and integration tests, browser tests, formatting, linting, and the complete release matrix pass from a clean setup.
- [x] The first production operator can be established before public Operations traffic is enabled.
- [x] The Operations Vertical Slice is demoable from operator sign-in through discovery, impersonation, visible disclosure, safe action, termination, target notification, and global audit review.

## Migrate the Operations App to TanStack Start

**What to build:** Replace the raw HTML Cloudflare Worker application boundary with a TanStack Start web application that gives System Operators the same completed Operations journeys through typed React routes while preserving the separate auth realm and every existing security, audit, notification, and impersonation invariant.

**Blocked by:** Cut Over to the Operations Model.

- [x] The Operations App uses the repository's established TanStack Start, TanStack Router, React, Vite, and Cloudflare deployment conventions for browser-facing product applications.
- [x] Development and production builds run through the TanStack Start/Vite pipeline while retaining the dedicated Operations Worker, origin, bindings, secrets, and deployment identity.
- [x] A typed route tree and application shell cover sign-in, TOTP, enrollment, Merchant discovery, Merchant detail, Member detail, operator management, global audit review, and impersonation initiation.
- [x] Existing server-rendered HTML strings are replaced by accessible React screens and components with loading, empty, validation, forbidden, expired, and unavailable states.
- [x] Better Auth remains a separate Operations Auth realm with its existing host-only cookie namespace, trusted origins, session policy, custom roles, TOTP requirements, endpoint allowlist, and stock-admin endpoint denial.
- [x] Existing Effect capabilities remain the sole owners of Operations authorization, discovery, audit, impersonation, lifecycle, and mutation policy; route loaders, server functions, and React components do not duplicate business rules.
- [x] Existing D1 schema and persisted operator, invitation, audit, handoff, impersonation, and notification facts remain compatible without destructive migration or data loss.
- [x] Auth callbacks, readiness, deterministic local email capture, and other non-page HTTP contracts are preserved as explicit server routes with their current status, privacy, and cache behavior.
- [x] The top-level POST Impersonation Handoff remains URL-free, single-use, cross-origin isolated, and compatible with the Merchant App's atomic exchange contract.
- [x] Dedicated rate limits and repeated-failure auditing still protect authentication, TOTP, reads, search, management, impersonation start, and handoff exchange at authoritative server boundaries.
- [x] Operator Session replacement, idle and absolute expiry, immediate role changes, disablement, emergency recovery, and derived impersonation revocation retain their existing behavior.
- [x] Merchant search, Member search, details, eligibility, reason capture, fresh TOTP, concurrency rejection, audit review, and permission denial are exercised through the hydrated TanStack UI.
- [ ] Browser tests drive the real TanStack routes and prove sign-in, enrollment, management, discovery, impersonation start, audit review, navigation, form errors, authorization failures, and session expiry without relying on raw HTML implementation details.
- [x] Existing capability, D1 integration, Better Auth, handoff, notification, rate-limit, and security-matrix tests continue to pass without weakening assertions.
- [x] A fast architecture regression test fails when a browser-facing Operations application lacks the required TanStack Start dependency, Vite integration, router, server entry, or generated route tree.
- [x] Operations intent, architecture, ADR, source specification, and operating documentation explicitly state that the Operations App is a TanStack Start application deployed as its own Cloudflare Worker.
- [ ] Obsolete raw Worker page rendering and response helpers are removed only after every route and test has moved to the TanStack boundary.
- [x] Formatting, linting, type checking, unit and integration tests, browser tests, production build, and the complete Operations security evidence matrix pass after migration.
