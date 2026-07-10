# Decide Auth and Session Boundary

Type: grilling
Status: done
Blocked by: 02, 03

## Question

How should the first Booking Vertical Slice model merchant authentication, merchant roles, public customer identity, unauthenticated booking sessions, customer sign-in or OTP behavior, and API access?

Resolve what uses Better Auth immediately, what stays anonymous or token-based, and which source auth flows are explicitly deferred.

## Decision

- The first Booking Vertical Slice has one Merchant role: **Merchant Owner**. A Merchant has one Owner membership, and additional Merchant Members, invitations, and other Merchant roles are deferred.
- Merchant membership and Provider eligibility remain independent. A solopreneur may be both the Merchant Owner and default Provider, but a Provider does not gain Merchant App access merely by being bookable.
- Better Auth's global system-admin role remains separate from Merchant authorization.
- Merchant Owners authenticate through Better Auth with email and password only. Username login, GitHub or other OAuth providers, temporary passwords, and merchant passcode or PIN login are deferred.
- Better Auth owns credential validation and the Merchant App browser session; merchant credentials and sessions are not reimplemented in Booking Product capabilities.
- The first slice supports self-service Merchant Owner sign-up. Better Auth account creation establishes the authenticated person but does not create Booking Product records through an auth hook.
- A signed-in person with no Merchant membership enters resumable **Merchant Onboarding**. Completing onboarding atomically creates the Merchant, its Merchant Owner membership, and its default Provider; an incomplete or failed onboarding leaves a valid Better Auth user with no Merchant authorization.
- Email verification is required before Merchant Onboarding can create a Merchant. An unverified Better Auth user is restricted to verification, resending verification, and signing out.
- Production self-service sign-up is unavailable with an explicit needs-configuration state when auth email delivery is not configured. Local development and tests use a deterministic email-capture or logging adapter that exposes the verification link without an external provider.
- First-slice ownership is one-to-one: each Merchant has exactly one Merchant Owner, and each authenticated person may own at most one Merchant. The Merchant App derives its Merchant from that membership and carries no active-Merchant selector in the browser session.
- Multi-Merchant ownership, Merchant switching, and multiple Merchant Members are deferred. Future support requires an explicit request-scoped Merchant choice rather than weakening the first-slice membership lookup.
- The first slice includes Better Auth password recovery through a short-lived, single-use email reset link. A successful password reset revokes all of the user's existing Merchant App sessions but does not create or change Merchant membership.
- Temporary passwords, security questions, SMS or OTP recovery, and support-issued credentials are deferred.
- Merchant browser authentication uses Better Auth's opaque, D1-backed session with a seven-day rolling lifetime refreshed after one day of activity. Long-lived "remember me" sessions are deferred.
- The session cookie is host-only to `app.<domain>`, `HttpOnly`, `Secure` in production, and `SameSite=Lax`; it is never parent-domain scoped or exposed as a JavaScript-readable token.
- Better Auth session data proves the person, not Merchant authorization. Every protected Merchant App request resolves the current one-to-one Merchant Owner membership server-side rather than trusting cached Merchant identity or role claims in the cookie.
- Signing out revokes the current session; resetting the password revokes all sessions.
- Customer identity is deferred to another slice. First-slice customers book without an account, the Booking App does not initialize Better Auth, and captured name, email, and phone are unverified **Customer Details**, not login identifiers or credentials.
- Repeated email or phone values do not link bookings, reveal or prefill private data, or grant access. Email or SMS OTP, customer passwords, Google or Apple sign-in, saved customer profiles, and cross-Merchant customer identity are all explicitly deferred.
- A confirmed customer's first-slice access is limited to the separately issued Confirmation Access Token; it is not a customer session or account.
- Anonymous Booking Session authorization uses two independent opaque values: the Booking Session ID in the route as a locator and a 256-bit random **Booking Session Capability** in a session-specific browser cookie. A URL alone grants no private access.
- D1 stores only the capability hash. Private reads and mutations require the route ID, matching capability secret, matching Merchant slug, and an active unexpired Booking Session.
- Booking Session Capability cookies are host-only to `www.<domain>`, `HttpOnly`, `Secure` in production, and `SameSite=Lax`. The secret must never enter a URL, browser JavaScript, local storage, logs, analytics, or queue payloads.
- Each Booking Session gets its own cookie so concurrent booking attempts do not replace or authorize one another.
- A Booking Session expires after 30 minutes without activity and has a two-hour absolute lifetime. Its Time Slot Hold has an independent, shorter deadline that session activity cannot extend.
- Confirmation consumes the Booking Session and invalidates its capability for general reads and mutations. The terminal session retains the capability hash for 24 hours solely to recognize an identical confirmation retry, return the existing Appointment, and establish the same Confirmation access without creating a duplicate; any different operation receives `410`.
- Expired sessions cannot be resumed. Background cleanup removes abandoned Customer Details and terminal capability hashes within 24 hours, while confirmed Appointment history remains governed separately.
- Each Booking Session Capability cookie is scoped to its exact `/:merchantSlug/booking` path. Private mutations require a non-GET request, an `Origin` exactly matching `PUBLIC_SITE_ORIGIN`, `Sec-Fetch-Site: same-origin` when Fetch Metadata is present, and the endpoint's non-form content type.
- Missing or invalid origin evidence is rejected without revealing whether the Booking Session exists. No JavaScript-readable CSRF token is added; strict origin validation, path-scoped host-only cookies, and `SameSite=Lax` form the CSRF boundary.
- Confirmation Access Tokens are deterministic, revocable 256-bit HMAC-derived secrets computed from the Confirmation ID, stored token version, expiry, and signing-key ID. D1 stores that metadata but no plaintext token.
- Only `apps/booking` and `apps/background` receive the Confirmation signing keyring. This lets background retries derive the identical emailed link without storing the bearer secret in D1 or queue payloads; incrementing the stored version revokes the previous token.
- Confirmation tokens carry a non-secret signing-key ID. The Booking and Background Workers use one current signing key and may retain previous verification keys; new tokens use the current key, and an old key remains until its last possible token expires.
- Removing a previous key early is an emergency bulk revocation for tokens signed by that key. Per-Confirmation version increments remain the targeted revocation mechanism.
- The emailed link carries the token only on its first request. After validation, the Booking App sets a confirmation-specific, host-only `HttpOnly` cookie and redirects to a clean URL so the secret does not remain in browser history or downstream request URLs.
- A Confirmation Access Token remains valid until 30 days after the Appointment ends. Its exchanged cookie lasts 24 hours, is scoped to that exact confirmation path, and can be recreated by reopening the email link.
- Cancellation changes the Confirmation view but does not automatically revoke access. Confirmation access is read-only and limited to that Appointment's status, time, Provider and Service snapshots, checkout summary, Merchant contact or location information, and the customer's own captured details.
- Confirmation responses expose no other Appointments, Customer Directory data, Merchant internals, or mutation controls and use `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and no third-party analytics.
- Platform API authentication follows the completed API-contract decision: `Authorization: Bearer` API Tokens identify exactly one Merchant and grant only explicit v1 scopes. Better Auth sessions, Booking Session Capabilities, Confirmation Access Tokens, cookies, query tokens, and body tokens are never accepted by `apps/api`.
- Platform API v1 is server-to-server and enables no browser CORS. Multi-Merchant partner credentials remain deferred; an integration serving several Merchants holds one independently revocable token per Merchant.
- Sensitive Merchant actions require Better Auth password reauthentication within the preceding 15 minutes. The first-slice protected set is owner email or password changes, API Token creation, Webhook Endpoint signing-secret rotation, and revoking all Merchant sessions.
- Ordinary Merchant operations require only the normal session. API Token revocation and Webhook Endpoint disabling also remain available without fresh authentication because they reduce access rather than create it.
- Better Auth verifies the reentered password; Booking Product capabilities receive only fresh-session proof and never handle or retain the password.
- A System Admin may manage Better Auth users, ban an account, and revoke its browser sessions but receives no implicit access to the user's Merchant, Appointments, Customer Details, or integration secrets.
- Admin impersonation and "log in as owner" are deferred until support access has explicit purpose limits, visible impersonation state, expiry, and audit logging.
- Banning a Merchant Owner blocks Merchant App access but does not unpublish the Merchant or cancel Appointments. Merchant suspension is a separate future domain policy.
- Merchant ownership transfer, self-service Merchant deletion, and self-service Better Auth account deletion are deferred. Deleting the sole owner must not be allowed to orphan a live Merchant or its Appointments.
- Owners may change their verified email or password, sign out, and revoke sessions. Ownership transfer, Merchant closure, retention handling, and account deletion must be designed together in a later lifecycle and compliance slice.
- Cloudflare-backed per-IP rate limits protect sign-up, sign-in, password reset, verification resend, Booking Session creation, and failed capability checks. Credential and recovery flows also use a normalized-email-hash key without logging the email, and authorized booking mutations use per-session limits.
- Password-reset and verification-resend responses never reveal whether an account exists. Turnstile remains optional and configuration-gated for sign-up or suspicious public booking traffic and is never required for local development.
- Numeric rate thresholds remain deploy-time configuration rather than part of the domain model or public contract.
- Deferred Legacy Source auth behavior: additional Merchant roles and invitations, Provider login access, Merchant OAuth, customer accounts and OTP or social sign-in, audited support impersonation, embedded or mobile host authentication, passcode or PIN access, and temporary-password workflows.
- Intentionally rejected Legacy Source auth behavior: JWT or refresh tokens in `localStorage`, browser bearer tokens for the Merchant App, the customer/barber/shop/brand/admin/agent user-kind taxonomy, Better Auth or customer credentials on the Platform API, and any rule that treats Provider status as Merchant authorization.
- Durable security audit events cover owner-account creation, email verification, successful and failed sign-in, password or owner-email changes, completed password reset, session revocation, and System Admin ban or unban. API Token and Webhook secret lifecycle events remain governed by their existing audit decisions.
- Password-reset requests, verification resends, invalid Booking Session Capability attempts, Confirmation token failures, and ordinary Booking Session activity remain security telemetry rather than durable Merchant audit events.
- Neither audit nor telemetry may contain passwords, bearer secrets, raw capabilities, reset links, Confirmation tokens, raw Customer Details, or the submitted email from a failed account lookup.
- Merchant navigation without a session redirects to `/sign-in` with a validated return path, while unauthenticated server mutations return `401`. Authenticated unverified users enter email verification, and verified users without a Merchant enter Merchant Onboarding.
- Missing or invalid Booking Session IDs or capabilities return a generic `404`. A requester with a valid capability for an expired session receives `410` with a safe restart action; a consumed session accepts only the identical 24-hour confirmation replay and returns `410` for every other operation.
- Missing or invalid Confirmation IDs or tokens return a generic `404`. A requester presenting a valid but expired Confirmation token receives `410` explaining that access has expired.
- Platform API failures keep the API-contract decision's uniform `401`, scope-specific `403`, and cross-Merchant-safe `404` behavior.

The canonical language is recorded in [`CONTEXT.md`](../../../CONTEXT.md), and the hard-to-reverse boundary is recorded in ADR [`0054-booking-auth-and-session-boundaries.md`](../../../docs/adr/0054-booking-auth-and-session-boundaries.md).
