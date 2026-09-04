# Webhook Endpoints

## Purpose & Scope

Workspace-scoped registry of outbound webhook destinations plus a delivery-success ratio computed from recent deliveries. Powers the Webhooks tab in the workspace shell. Endpoint creation, disabling, and secret rotation are wired here; `create` enforces the plan's endpoint ceiling (`assertWithinPlanLimitFor` from the billing capability — the rule and its counting query live there so callers cannot forget the gate) and fans out a best-effort `webhook_endpoint.created` event (projection only — never the signing secret) via [`webhook-publisher`](./webhook-publisher.AGENTS.md), which both Seed and Live layers are built with. The actual outbound dispatch lives in the background worker (enqueued via the same publisher).

## Module layout

The capability is split along its section seams — no barrel file; consumers import the specific module:

- `webhook-endpoints.ts` — shared contract: schemas (`WebhookEndpoint`, `CreateWebhookEndpointPayload`), input types, `WebhookEndpointsInterface` + service class, `ensureValidWebhookUrl`.
- `webhook-delivery-plan.ts` — pure delivery state machine + delivery types: `WebhookDelivery`, `WebhookDeliveryStatus`, `backoffSeconds`, `classifyResponseStatus`, `planDeliveryAttempt`, `DeliveryAttemptPlan`, `terminalDeliveryAuditEventType`, `WebhookDeliveryAttemptInput`. Dependency-free of storage.
- `webhook-endpoints.seed.ts` — `SeedWebhookEndpoints` + `SeedWebhookEndpointFixture`.
- `webhook-endpoints.live.ts` — `LiveWebhookEndpoints` (plus `toEndpointProjection`, reused by both the fan-out payload and the create return).

## Public surface

- `WebhookEndpoint` — `{ id, url, enabled, events, successRate }`. `events` is the subscribed event-type array; `successRate` is a 0–100 integer over all known deliveries for the endpoint.
- `WebhookEndpoints.list` — `readonly WebhookEndpoint[]` for the current `WorkspaceContext`.
- `WebhookEndpoints.create({ url, events, description? })` — validates the URL with `validateWebhookUrl` (fails with `InvalidWebhookUrl`, 400), mints a signing secret, inserts the endpoint, and emits `webhook_endpoint.created` atomically (single D1 batch with the audit insert). Seed and Live both validate — shape parity.
- `CreateWebhookEndpointPayload` — the wire payload schema for creation (`{ url, events (min 1), description? }`), defined here so the REST contract (`@b2b-saas-starter/api`) and the API worker import one source of truth.
- `validateWebhookUrl` / `InvalidWebhookUrl` — pure SSRF/shape guard in the sibling [`webhook-url.ts`](./webhook-url.ts): https only, no credentials, no `localhost`/single-label hostnames, no private/loopback/link-local IP literals. Shared with `apps/background`, which re-checks at dispatch time. DNS-rebinding protection is deliberately out of scope for the starter. Tests: `webhook-url.test.ts`.
- `WebhookEndpoints.disable({ endpointId })` — resolves `boolean`: `true` when an endpoint was disabled, `false` when nothing matched (mirrors `ApiTokenRegistry.revoke`).
- `WebhookEndpoints.rotateSecret({ endpointId })` — resolves `Option.Option<{ signingSecret }>`: `some` with the newly persisted secret, `none` when no endpoint matched in this workspace (no secret is minted or returned in that case — the replacement is minted inside the combinator's lazy `write`, which a zero-match mutation never calls).
- Both mutations are **scoped to the calling workspace** and run through the shared [`governance/audited-mutation`](../audited-mutation.ts) combinator (as do `ApiTokenRegistry.create`/`revoke` and the terminal delivery write): the endpoint is first looked up by `(id, workspaceId)`; on no match the update and the audit event are both skipped. The update + audit insert run as one D1 batch. This is check-then-act, not atomic — a concurrent delete between the lookup and the batch can leave a phantom audit row (the UPDATE no-ops while the audit insert commits); that race and the workspace-scoping guarantee live in one place, in the combinator's documentation.
- `WebhookEndpoints.getDispatchTarget(endpointId, workspaceId)` / `recordDeliveryAttempt(input)` / `recordTerminalDeliveryAttempt(input)` — background-worker surface for dispatch and attempt history. The queue consumer has no `WorkspaceContext`, so `getDispatchTarget` takes the workspace ID from the queue message (stamped by `webhook-publisher` from the producing request's context) and verifies it: the lookup filters on `(endpointId, workspaceId)` and resolves `null` on a mismatch, so a forged or misrouted message never yields another workspace's signing secret. `recordDeliveryAttempt` accepts an optional `id` (the worker mints it before dispatch so the signed payload's `deliveryId` matches the row), a required `workspaceId` (from the queue message), and a `WebhookDeliveryStatus` of `delivered` / `failed` (retryable) / `failed_permanent` / `dead_lettered` — see `apps/background/AGENTS.md` for the full vocabulary. Terminal statuses (`failed_permanent` / `dead_lettered`) always batch an audit insert with the attempt row (single D1 batch, same pattern as the mutations above): `webhook.delivery_failed` / `webhook.delivery_dead_lettered` per `terminalDeliveryAuditEventType`, `targetType: 'webhook_endpoint'`, `targetId` = endpoint id, `actorUserId: null`, metadata carrying `deliveryId`/`eventType`/`attempts`/`responseStatus`.
- The **delivery state machine is owned here**, not by the worker: `backoffSeconds`, `classifyResponseStatus`, and the pure `planDeliveryAttempt(responseStatus, attempts, now)` (→ `{ status, responseStatus, nextAttemptAt, outcome }`) are exported from this module; the worker passes the same `backoffSeconds(attempts)` to its queue retry that `planDeliveryAttempt` persists as `nextAttemptAt`. Never-dispatched (SSRF-rejected) and dead-lettered messages go through `recordTerminalDeliveryAttempt`, which mints the delivery id itself (no signed payload to keep in step with), timestamps the row, and batches the terminal audit event — callers hand over only what the queue message carries.
- **Seed mirrors Live's post-conditions.** Seed keeps mutable endpoint + delivery stores (fixtures may add `signingSecret?` / `workspaceId?` via `SeedWebhookEndpointFixture`; defaults are fixed fixture values scoped to `wrk_starter`): a created endpoint becomes dispatchable via `getDispatchTarget`, recorded attempts list through `listDeliveries`, terminal attempts record audit events through the shared fixture `AuditEventLog`, and the plan gate can trip. The mutation contract in `developer-platform.contract.ts` runs the same case list against both adapters (`index.test.ts` for Seed, `webhook-endpoints.live.test.ts` for Live).
- All methods fail with `CapabilityUnavailable` (503) when D1 is unreachable.

## Storage

- Tables: `webhookEndpoints` (config) and `webhookDeliveries` (per-attempt log).
- **The signing secret is deliberately stored in plaintext at rest in D1** (`signing_secret` column). Outbound dispatch in `apps/background` must sign each payload with HMAC-SHA256 using the plaintext secret, so a hash-at-rest scheme cannot work — a previous `signing_secret_hash` column was written but never read and has been removed. The DTO still never exposes the secret; only `rotateSecret`'s return value and `getDispatchTarget` (background-worker path) carry it.
- `successRate` is computed in a single grouped query (`count` + conditional `sum` per endpoint, left-joined from `webhookEndpoints`), not per-endpoint delivery scans.

## Status & follow-ups

- Add `updateEndpoint` and a paginated `listDeliveries(endpointId)` method for the per-endpoint history view.
- Surface `lastDeliveryAt` and `lastFailureReason` once the underlying tables track them.
- There is no endpoint-not-found typed error; `disable` returns `false` and `rotateSecret` returns `Option.none()` on a foreign or unknown endpoint. Add a typed error if routes need to 404.

## Anti-patterns

- Don't dispatch webhooks from a request path. Outbound delivery goes through the Cloudflare Queue (`WEBHOOK_QUEUE`) and is owned by the background worker.
- Don't expose webhook signing secrets through the `WebhookEndpoint` DTO. It intentionally omits the secret column.
- Don't compute `successRate` in the route. It's part of the capability contract so the math stays consistent everywhere.
- Don't filter mutations on endpoint id alone. Every mutation's lookup/where clause must include `workspaceId` from `WorkspaceContext` — see the cross-workspace regression test in `src/index.test.ts`.

## Paging (ADR 0057)

`listPage` serves the REST/MCP list surface: forward on `id ASC` — the wire shape carries no timestamp, so the id is the one stable order a page can resume — through the shared `internal/keyset-cursor.ts` recipe, `limit` clamped into `[1, 200]`. `list` (the grouped success-rate aggregate, unordered) stays the settings page's whole-collection read.
