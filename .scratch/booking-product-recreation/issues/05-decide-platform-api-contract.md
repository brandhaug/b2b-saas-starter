# Decide Platform API Contract

Type: grilling
Status: done
Blocked by: 01, 02

## Question

Which Platform API contract groups, endpoints, payloads, authentication expectations, rate-limit buckets, and typed errors are required for merchant integrations in the first Booking Vertical Slice, and which customer booking operations must remain exclusive to the Booking App?

Use the Legacy Source API inventory and the target domain model to decide the first external integration surface before implementation tickets are written. The Platform API may expose merchant-owned catalog data, appointment records, API tokens, and webhook configuration, but it must not create Booking Sessions, search customer-facing availability, run checkout, or confirm Appointments.

## Decision

- Platform API v1 is a read-and-notify back-office integration surface for booking-domain data. Integrations may read merchant, service, provider, and appointment records and receive appointment lifecycle webhooks.
- First-slice mutations are limited to developer configuration: API-token and webhook-endpoint lifecycle operations. Merchant catalog, Schedule Rules, Appointments, and Public Page Status are not mutable through Platform API v1.
- Customer operations remain exclusive to the Booking App. Platform API v1 cannot create or mutate Booking Sessions, search Availability, run checkout, or confirm Appointments.
- Every API Token belongs to exactly one Merchant. Bearer-token verification establishes the Merchant context, so merchant-scoped routes do not repeat a merchant ID or slug.
- The Merchant App bootstraps the first API Token. An appropriately scoped token may manage later tokens; multi-merchant partner credentials are deferred, so an integration serving several Merchants holds one token per Merchant.
- The first-slice business-data groups are Merchant (`GET /v1/merchant`), Services (`GET /v1/services`, `GET /v1/services/:serviceId`), Providers (`GET /v1/providers`, `GET /v1/providers/:providerId`), and Appointments (`GET /v1/appointments`, `GET /v1/appointments/:appointmentId`). API Tokens and Webhook Endpoints are separate developer-configuration groups.
- Platform API v1 has no standalone Customers, Schedule Rules, Availability, Public Booking Pages, Brands, or Shops group. Appointment responses may contain the Customer Details needed by integrations, `GET /v1/merchant` may summarize Public Page Status, and future multi-location resources are deferred.
- Every successful response uses a top-level `data` envelope. Collection responses also include `page.nextCursor`; collection requests accept `cursor` and `limit`, default `limit` to 50, and cap it at 100.
- Platform API v1 does not return collection total counts. Cursor pagination avoids offset drift and keeps the query contract scalable as Appointment history grows.
- Resource IDs are immutable, opaque strings with diagnostic prefixes: `mer_`, `svc_`, `prv_`, `apt_`, `tok_`, `wh_`, `evt_`, and `dlv_`. Clients may store and compare IDs but must not parse their suffixes or assume sort order.
- Human-facing slugs remain mutable attributes rather than identifiers. Platform API v1 does not accept client-selected resource IDs; the backing ID-generation mechanism is not part of the contract.
- All timestamps are RFC 3339 strings normalized to UTC. Appointments expose `startsAt` and `endsAt` plus an IANA `timeZone` snapshot; they do not expose the Legacy Source's ambiguous `dateTime` shape.
- Lifecycle audit fields use `createdAt` and `updatedAt`, with absent optional timestamps represented as `null`. Service durations are positive integer minutes.
- Money is encoded as `{ amountMinor, currency }`, where `amountMinor` is a non-negative integer in the currency's minor unit and `currency` is an uppercase ISO 4217 code. Platform API v1 never returns floating-point amounts or formatted money strings.
- A Service price has `amountMinor > 0` in the first slice. The reusable Money shape remains non-negative, but zero-priced Services and a **No Payment Required** Checkout Path are deferred.
- Services expose their current `price`, while Appointment service lines preserve price snapshots. A single Appointment cannot mix currencies.
- `GET /v1/merchant` returns `id`, `publicName`, `slug`, `timeZone`, `currency`, `publicPage: { status, bookingUrl }`, `createdAt`, and `updatedAt`. `publicPage.status` is `published` or `unpublished`, and `bookingUrl` is `null` while Unpublished.
- The Merchant response omits legal details, owner identity, billing state, Booking Readiness diagnostics, and internal settings.
- Service resources contain `id`, `name`, nullable display-text `description` and `category`, `status`, `durationMinutes`, `price`, `providerIds`, `createdAt`, and `updatedAt`.
- `Service.status` is `active` or `inactive`. Inactive Services remain readable for historical references but cannot enter new Booking Sessions. Categories are not separate first-slice resources, and `providerIds` declares Provider eligibility.
- Provider resources contain `id`, customer-facing `displayName`, `status`, `isDefault`, `serviceIds`, `createdAt`, and `updatedAt`.
- `Provider.status` is `active` or `inactive`. Inactive Providers remain readable for historical references but cannot receive new Appointments. `serviceIds` and Service `providerIds` project the same eligibility relationship.
- Provider resources omit email, phone, Merchant Member identity, Schedule Rules, compensation, and private employment data.
- `Appointment.status` is `scheduled`, `completed`, `cancelled`, or `no_show`. The first slice creates only `scheduled` Appointments, but the complete read/event vocabulary is fixed for merchant operations.
- Booking confirmation creates a scheduled Appointment. A future reschedule changes its times and emits an update rather than introducing a `rescheduled` status; Platform API v1 has no Appointment-status mutation endpoint.
- Appointment reads include unmasked `customer: { name, email, phone }` for authorized integrations. `name` and `email` are required, `phone` is nullable, and no durable `customerId` is exposed.
- Appointment reads exclude marketing consent, saved payment details, account identity, and inferred Customer Directory data. Raw Customer Details must never appear in logs, cursor values, error payloads, or Webhook Events.
- Appointment resources contain `id`, `status`, `startsAt`, `endsAt`, `timeZone`, `providerPreference`, a Provider snapshot, ordered Service snapshots, Customer Details, `checkoutPath`, `total`, `createdAt`, and `updatedAt`.
- Provider and Service details are snapshots from the accepted Booking Quote, not live catalog joins. Each Appointment has exactly one `primary` Service selection and zero or more `additional` selections; an any-provider booking has a concrete assigned Provider while preserving `providerPreference: any`.
- Appointment resources exclude payment status, processor IDs, Confirmation Access Tokens, customer notes, internal metadata, and the token-implied Merchant ID.
- `GET /v1/appointments` accepts repeatable `status`, `providerId`, inclusive `startsAtFrom`, exclusive `startsAtBefore`, inclusive `updatedAtFrom`, `cursor`, and `limit` query parameters. Timestamp filters use RFC 3339.
- Appointment collections are ordered by `(updatedAt ASC, id ASC)` for deterministic initial imports and missed-webhook reconciliation. Cursors are opaque and bound to the original filters; changing filters while reusing a cursor produces `InvalidCursor`.
- Appointment lists have no Customer name, email, or phone filters because query strings commonly enter infrastructure logs.
- `GET /v1/services` accepts repeatable `status`, `providerId`, inclusive `updatedAtFrom`, `cursor`, and `limit`. `GET /v1/providers` accepts repeatable `status`, `serviceId`, inclusive `updatedAtFrom`, `cursor`, and `limit`.
- Service and Provider collections include active and inactive records by default and order by `(updatedAt ASC, id ASC)`. Their cursors are opaque and filter-bound, and Platform API v1 provides no free-text catalog search.
- Platform API v1 defines exactly six API-token scopes: `merchant:read`, `services:read`, `providers:read`, `appointments:read`, `api_tokens:manage`, and `webhooks:manage`. Each endpoint requires one explicit scope; there is no generic `read`, `write`, `admin`, wildcard, or customer-booking scope.
- Token creation may grant only scopes held by the calling token. The Merchant App may bootstrap the first token with all six scopes, preventing API-based delegation from escalating privilege.
- API Token lifecycle endpoints are `GET /v1/api-tokens`, `POST /v1/api-tokens`, and idempotent `DELETE /v1/api-tokens/:tokenId` returning `204`. The list is paginated, includes every Token status by default, accepts repeatable `status=active|expired|revoked`, and orders by `(createdAt DESC, id DESC)`.
- `API Token.status` is `active`, `expired`, or `revoked`; explicit revocation takes precedence over expiration. Expiration is automatic and does not populate `revokedAt` or emit a revocation event.
- Token creation accepts `name`, non-empty `scopes`, and nullable `expiresAt`. Metadata contains `id`, `name`, `prefix`, `scopes`, `status`, `lastUsedAt`, `expiresAt`, `revokedAt`, and `createdAt`; the create response additionally returns plaintext `token` exactly once, while storage retains only its hash.
- Platform API v1 has no token update, hard-delete, get-one, or rotate operation. Rotation is create-then-revoke, and expired, revoked, and unknown credentials all receive the same `401` response.
- Webhook Endpoint lifecycle routes are `GET` and `POST /v1/webhook-endpoints`, `PATCH` and idempotent `DELETE /v1/webhook-endpoints/:endpointId`, `POST /v1/webhook-endpoints/:endpointId/rotate-secret`, and `GET /v1/webhook-endpoints/:endpointId/deliveries`.
- Webhook creation accepts `url`, optional `description`, and a non-empty event list; patch may change those fields. Creation and secret rotation return `signingSecret` exactly once, while normal reads never expose it.
- All Webhook Endpoint routes require `webhooks:manage` and are scoped to the token's Merchant. Disabled endpoints cannot be re-enabled; test delivery, replay, and get-one operations are deferred.
- Webhook subscriptions use the closed event vocabulary `appointment.created`, `appointment.updated`, `appointment.completed`, `appointment.cancelled`, and `appointment.no_show`. There are no wildcards or Service, Provider, Customer, payment, or Booking Session events in v1.
- `appointment.created` follows committed confirmation of a new scheduled Appointment. `appointment.updated` is for non-status changes; status transitions emit only their specific event. The first vertical slice emits only `appointment.created`.
- Webhook events are thin, PII-free notifications containing `id`, `type`, numeric `schemaVersion`, `occurredAt`, `merchantId`, and `data: { appointmentId, status, updatedAt }`. Receivers fetch the authoritative Appointment when they need its snapshot or Customer Details.
- Retries preserve the same `evt_` event ID. Each delivery attempt has a separate `dlv_` ID, allowing a shared endpoint URL to distinguish Merchant installations without putting Customer data into queues or delivery logs.
- Webhook delivery requests carry `Webhook-Event`, `Webhook-Event-Id`, `Webhook-Delivery-Id`, `Webhook-Timestamp`, and `Webhook-Signature` headers. The signature value is `t=<unix-seconds>,v1=<hex>` where the digest is HMAC-SHA256 over `<timestamp>.<raw-body>` using the Endpoint's signing secret.
- Receivers verify raw bytes with a constant-time comparison, reject timestamps outside a five-minute window, and deduplicate by Webhook Event ID. Retries retain the event ID and body but receive a new delivery ID, timestamp, and signature.
- Webhook Endpoint URLs must use HTTPS and pass the SSRF guard both at configuration time and immediately before dispatch.
- Webhook Delivery Attempt statuses are `delivered`, `failed_retryable`, `failed_permanent`, and `dead_lettered`. A `2xx` response is delivered; network failures, a ten-second timeout, `408`, `429`, and `5xx` are retryable; unfollowed redirects and all other `4xx` responses are permanent.
- Delivery makes one initial attempt plus six retries after 30, 60, 90, 120, 150, and 180 seconds. Every attempt persists its own ID, attempt number, nullable response status, attempted time, and nullable next-attempt time; exhausting retries records `dead_lettered`.
- Platform API v1 neither automatically disables failing endpoints nor provides manual replay.
- Webhook Endpoint resources contain `id`, `url`, nullable `description`, `status`, non-empty `eventTypes`, `createdAt`, `updatedAt`, and nullable `disabledAt`. `status` is `active` or `disabled`; resources omit signing secrets, aggregate success rates, response bodies, and inferred health labels.
- Endpoint patch accepts at least one of `url`, nullable `description`, or non-empty `eventTypes`. Create returns the resource plus one-time `signingSecret`; rotation returns only the new one-time secret.
- Endpoint lists include active and disabled records by default, accept repeatable `status`, and order by `(updatedAt ASC, id ASC)`.
- Webhook Delivery Attempt resources contain `id`, `eventId`, `eventType`, `status`, `attemptNumber`, nullable `responseStatus`, nullable `failureCode`, `durationMs`, `attemptedAt`, and nullable `nextAttemptAt`.
- Delivery `failureCode` is `network_error`, `timeout`, `http_status`, `invalid_destination`, `retries_exhausted`, or `null`. History accepts repeatable `status`, `eventId`, inclusive `attemptedAtFrom`, `cursor`, and `limit`, ordered by `(attemptedAt DESC, id DESC)`.
- Delivery history omits request and response bodies, signing material, Customer Details, and free-form internal exceptions.
- Platform API v1 accepts credentials only as `Authorization: Bearer <token>`. It accepts neither query/body/cookie tokens nor Better Auth browser sessions, enables no CORS, and derives Merchant context only from the verified token.
- Missing, malformed, unknown, expired, and revoked credentials receive the same `401` with `WWW-Authenticate: Bearer`. A valid token lacking the route scope receives `403 insufficient_scope` naming the required scope but not the token's full scope set.
- All authenticated responses use `Cache-Control: private, no-store`.
- Rate limiting uses three security/backpressure buckets rather than commercial quotas: `data_read` at 60 requests/minute per verified token, `developer_config` at 20 requests/minute per verified token, and `auth_failure` at 30 failed authentications/minute per source IP.
- A denied request returns `429 rate_limited`, identifies the bucket, and sends `Retry-After: 60`. Platform API v1 does not promise remaining-count headers because the Cloudflare binding guarantees only allow/deny; local development keeps the per-isolate fallback.
- Every error uses `{ error: { code, message, traceId, details } }`. `code` is stable and machine-readable, `message` is safe display text, `traceId` is always present, and `details` is nullable and typed per error.
- Validation details may name field paths and rule codes but never echo values. Errors omit stack traces, SQL, secrets, Customer Details, and internal exception text; nonexistent and cross-Merchant resource lookups use the same `404` shape.
- The closed error-code vocabulary is: `invalid_request` (400), `invalid_cursor` (400), `invalid_webhook_url` (400), `unauthorized` (401), `insufficient_scope` (403), `scope_escalation_denied` (403), `resource_not_found` (404), `webhook_endpoint_disabled` (409), `rate_limited` (429), `internal_error` (500), and `capability_unavailable` (503).
- Invalid event types and scope names are `invalid_request` field violations. Effect contracts model codes as tagged errors, and every endpoint declares only the subset it can raise.
- All reads return `200`; API Token and Webhook Endpoint creation return `201`; Webhook Endpoint patch and signing-secret rotation return `200`; Token revocation and Endpoint disabling return `204`, including repeated calls against an already terminal resource.
- Platform API v1 returns no `202` because it exposes no asynchronous mutation. Every non-empty success body uses the `data` envelope, patch returns the complete updated Endpoint, and secret rotation returns only `data.signingSecret`.
- Platform API v1 omits idempotency keys, ETags, and conditional updates. `DELETE` is naturally idempotent, `PATCH` is last-write-wins, and every successful `POST` creates a new resource; clients must not automatically retry an ambiguous create response.
- Replaying token creation would require retaining the one-time plaintext credential in an encrypted idempotency-response store. Until real traffic justifies that key-management surface, operators recover from a lost response by inspecting metadata, revoking the orphan, and creating a replacement.
- Appointment commit and transactional-outbox insertion are atomic. Webhook delivery is at least once and may be delayed, duplicated, or arrive out of order; no ordering is guaranteed across Endpoints or Appointments.
- Receivers deduplicate by Webhook Event ID and may fetch the authoritative Appointment after any event. Queue-publication failure cannot silently discard a committed event: background processing retries unpublished outbox records.
- Implementing the Booking Platform API replaces the generic Starter API rather than preserving it for compatibility. Workspace, catalog, assistant, MCP, invitation, report, module, and other Starter-oriented routes leave the public contract.
- `GET /health`, `GET /openapi.json`, and `GET /reference` remain unversioned and unauthenticated. The generated OpenAPI document and Scalar reference describe only the `/v1` Booking Product contract.
- Mutation requests require `Content-Type: application/json`, are capped at 16 KiB, reject unknown properties, and trim surrounding whitespace from names and descriptions.
- API Token creation requires a trimmed 1–100-character `name`, 1–6 unique known `scopes`, and `expiresAt` of `null` or a future RFC 3339 timestamp.
- Webhook configuration requires an absolute HTTPS `url` of at most 2,048 characters with no credentials or fragment, nullable `description` of at most 500 characters with empty text normalized to `null`, and 1–5 unique known `eventTypes`, in addition to SSRF validation.
- Collection cursors are stateless, signed, PII-free tokens containing the endpoint, filter hash, sort position, schema version, and a 24-hour expiry. They bind to endpoint and filters but not `limit`.
- Tampered, expired, cross-endpoint, and filter-mismatched cursors return `invalid_cursor`. Cursors are traversal tokens rather than durable synchronization checkpoints; integrations recover with `updatedAtFrom`.

The canonical domain terms are recorded in [`CONTEXT.md`](../../../CONTEXT.md). The hard-to-reverse read-and-notify boundary and thin-webhook trade-off are recorded in ADR [`0053-read-and-notify-merchant-platform-api.md`](../../../docs/adr/0053-read-and-notify-merchant-platform-api.md).
