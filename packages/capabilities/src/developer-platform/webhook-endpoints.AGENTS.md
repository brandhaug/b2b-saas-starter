# Webhook Endpoints

## Purpose & Scope

Workspace-scoped registry of outbound webhook destinations, a delivery-success ratio computed from recent deliveries, and the operator surface over both: update, delete, replay, test send, secret rotation with a grace window, and the delivery history. Powers the Webhooks tab in the workspace shell. `create` enforces the plan's endpoint ceiling (`assertWithinPlanLimitFor` from the billing capability — the rule and its counting query live there so callers cannot forget the gate) and fans out a best-effort `webhook_endpoint.created` event (projection only — never the signing secret) via [`webhook-publisher`](./webhook-publisher.AGENTS.md), which both Seed and Live layers are built with. The actual outbound dispatch lives in the background worker (enqueued via the same publisher).

## Module layout

The capability is split along its section seams — no barrel file; consumers import the specific module:

- `webhook-endpoints.ts` — shared contract: schemas (`WebhookEndpoint`, `CreateWebhookEndpointPayload`, `UpdateWebhookEndpointPayload`), input types, the typed errors (`InvalidWebhookUrl` lives beside `webhook-url.ts`; `WebhookEndpointNotFound` 404, `WebhookDeliveryNotFound` 404, `WebhookDispatchRejected` 409 live here), `WebhookEndpointsInterface` + service class, `ensureValidWebhookUrl`, `WEBHOOK_TEST_EVENT_TYPE`.
- `webhook-delivery-plan.ts` — pure delivery state machine: `WebhookDelivery` (wire DTO incl. evidence columns), `WebhookDeliveryStatus` (incl. `pending`), `isReplayableDeliveryStatus`, `planReplayedDelivery`, `backoffSeconds`, `classifyResponseStatus`, `planDeliveryAttempt`, `truncateResponseBody`, `planSecretRotation` + `activeSigningSecrets` (the rotation-grace rule), `deadLetterNotification`, `terminalDeliveryAuditEventType`, `WebhookDeliveryAttemptInput`, `SeedWebhookDeliveryFixture`, `deliverySuccessRate`. Dependency-free of storage.
- `webhook-endpoints.seed.ts` — `SeedWebhookEndpoints(endpoints, deliveries?)` + `SeedWebhookEndpointFixture`.
- `webhook-endpoints.live.ts` — `LiveWebhookEndpoints` (plus `toEndpointProjection`).

## Public surface

- `WebhookEndpoint` — `{ id, url, enabled, events, successRate }`. `successRate` is a 0–100 integer over all known deliveries for the endpoint.
- `WebhookEndpoints.list` / `create({ url, events, description? })` — as before; `create` validates the URL (fails `InvalidWebhookUrl`, 400) and emits `webhook_endpoint.created` atomically with the insert.
- `WebhookEndpoints.disable({ endpointId })` — resolves `boolean`: `true` when an endpoint was disabled, `false` when nothing matched (mirrors `ApiTokenRegistry.revoke`). Re-enabling goes through `update`.
- `WebhookEndpoints.update({ endpointId, url?, events?, enabled? })` — writes only the provided fields; re-validates a provided URL; re-enabling a disabled endpoint is the one way back from `disable`. Fails `WebhookEndpointNotFound` (404) on no match, `InvalidWebhookUrl` on a rejected URL. Audits `webhook_endpoint.updated` with the changed fields only.
- `WebhookEndpoints.delete({ endpointId })` — removes the row; deliveries cascade with the FK. `true`/`false` like `disable`. Audits `webhook_endpoint.deleted` with the URL in metadata.
- `WebhookEndpoints.replayDelivery({ deliveryId })` — re-enqueues a failed delivery verbatim: a **new** `pending` row with `attempts: 0` and a `replayedFrom` link (see [ADR 0061](../../../../docs/adr/0061-webhook-operator-tooling-replay-and-rotation-grace.md)); the source row is never modified. Audits `webhook.delivery_replayed`. Fails `WebhookDeliveryNotFound` on a foreign/unknown id, `WebhookDispatchRejected` when the source is not a failure, records no payload, or its endpoint is disabled.
- `WebhookEndpoints.sendTestEvent({ endpointId })` — queues a synthetic `webhook.test_event` to one enabled endpoint, creating the same `pending` row a replay does. No audit event — the row is the record. Fails `WebhookEndpointNotFound` / `WebhookDispatchRejected` (disabled).
- `WebhookEndpoints.rotateSecret({ endpointId })` — resolves `Option<{ signingSecret }>` (`none` on no match, nothing minted). A rotation is a shift: the replaced secret moves into the grace columns and keeps signing for 24h (`planSecretRotation` / `activeSigningSecrets`); the audit metadata carries `previousSecretExpiresAt`.
- `WebhookEndpoints.listDeliveries({ endpointId })` — up to 20 rows, newest first, workspace-scoped by join (a foreign endpoint id yields an empty list). Rows carry the evidence columns: `payload`, `requestHeaders`, `responseBody` (truncated), `replayedFrom`.
- Both layers are built with `NotificationFeed` (cross-context import, explicit): a `dead_lettered` attempt records a broadcast workspace notification after the row + audit batch (`deadLetterNotification` owns the copy, so Seed and Live emit byte-identical messages).
- `WebhookEndpoints.getDispatchTarget(endpointId, workspaceId)` / `recordDeliveryAttempt(input)` / `recordTerminalDeliveryAttempt(input)` — background-worker surface, no `WorkspaceContext`; the workspace ID travels in the queue message and is verified by `(endpointId, workspaceId)` lookups. `getDispatchTarget` returns `signingSecrets: ReadonlyArray<string>` (plural — active secrets per the rotation rule). `recordDeliveryAttempt` **upserts** on the row id (one row per queue message; replays' pending rows are resolved, not forked) and records the evidence columns; the upsert's `set` clause carries attempt state only, so `payload`/`replayedFrom` are insert-only. Terminal statuses batch the audit insert with the row as before, and `dead_lettered` additionally records the notification.
- The **delivery state machine is owned here** (`webhook-delivery-plan.ts`), not by the worker: `backoffSeconds`, `classifyResponseStatus`, `planDeliveryAttempt(responseStatus, attempts, now)`, `planReplayedDelivery`, `planSecretRotation`, `activeSigningSecrets`, `truncateResponseBody`.
- **Seed mirrors Live's post-conditions.** Seed keeps mutable endpoint + delivery stores; fixtures may add signing secrets, owning workspaces (`SeedWebhookEndpointFixture`), and delivery history (`SeedWebhookDeliveryFixture`, second argument, re-exported type lives on the plan module to avoid an import cycle through the adapters). The mutation contract in `developer-platform.contract.ts` runs the same case list against both adapters (`index.test.ts` for Seed, `webhook-endpoints.live.test.ts` for Live), including update, delete, replay, and test-send cases.
- All methods fail with `CapabilityUnavailable` (503) when D1 or the queue is unreachable. An enqueue failure fails the replay/test visibly _after_ the row commits — the operator retries, and the pending row stands.

## Storage

- Tables: `webhookEndpoints` (config) and `webhookDeliveries` (per-message log).
- **The signing secret is deliberately stored in plaintext at rest in D1** (`signing_secret` column), alongside the rotation grace columns (`previous_signing_secret`, `previous_secret_expires_at` — both null until the first rotation; a second rotation overwrites them, so at most two secrets are ever active). Outbound dispatch signs each payload with HMAC-SHA256 using the plaintext secrets. The DTO never exposes them; only `rotateSecret`'s return value and `getDispatchTarget` (background-worker path) carry them.
- `webhookDeliveries` carries the evidence columns (`payload` JSON, `request_headers` JSON, `response_body` text truncated at 2048 chars with a marker, `replayed_from` plain reference) — added additively in migration `20260903104532_webhook_operator_tooling`.
- `successRate` is computed in a single grouped query (count + conditional sum, left-joined), not per-endpoint delivery scans; `update` reuses the same aggregate for its read-back projection.

## Status & follow-ups

- Paginated `listDeliveries` (the cap is a fixed 20 today) and a per-delivery attempt-timeline table if per-attempt evidence beyond the latest is ever needed.
- Surface `lastDeliveryAt` per endpoint in the list projection.
- Expired grace columns are filtered lazily by `activeSigningSecrets`; a sweep that clears them is cosmetic, not required.

## Anti-patterns

- Don't dispatch webhooks from a request path. Outbound delivery goes through the Cloudflare Queue (`WEBHOOK_QUEUE`) and is owned by the background worker.
- Don't expose webhook signing secrets through the `WebhookEndpoint` DTO. It intentionally omits the secret columns.
- Don't compute `successRate` in the route. It's part of the capability contract so the math stays consistent everywhere.
- Don't filter mutations on endpoint id alone. Every mutation's lookup/where clause must include `workspaceId` from `WorkspaceContext` — see the cross-workspace regression test in `src/index.test.ts`.
- Don't mutate a delivery row in place to "replay" it — replays are new `pending` rows linked through `replayedFrom` (ADR 0061).

## Paging (ADR 0057)
