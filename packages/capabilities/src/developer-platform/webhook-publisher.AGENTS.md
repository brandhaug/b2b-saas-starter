# Webhook Publisher

## Purpose & Scope

Workspace-scoped fan-out of domain events onto the outbound webhook queue. Producers call `publish({ eventType, payload })`; delivery (HMAC signing, retries, attempt history) is owned by the queue consumer in `apps/background/src/index.ts`. This capability only decides _which_ endpoints receive a message and enqueues one message per endpoint.

## Public surface

- `WebhookQueueMessage` — `{ endpointId, workspaceId, eventType, payload }`, exported as both the `effect/Schema` struct and its `Type`. This package owns the wire shape; the queue consumer in `apps/background` imports it from here instead of maintaining a parallel type. `workspaceId` is stamped from the producing request's `WorkspaceContext` and re-verified by `WebhookEndpoints.getDispatchTarget` before the signing secret is released.
- `WebhookPublisher.publish({ eventType, payload })` — for the current `WorkspaceContext`, selects enabled endpoints whose `events` array contains `eventType` and enqueues one `WebhookQueueMessage` per endpoint in a single `sendBatch` call to the `WEBHOOK_QUEUE` binding (no send when zero endpoints subscribe). Fails with `CapabilityUnavailable` (503) — via the shared `orUnavailable` helper — if D1 or the queue send fails.
- `WebhookQueueBinding` — structural `{ send, sendBatch }` subset of Cloudflare's `Queue` so this package doesn't depend on `@cloudflare/workers-types`. Threaded in via `LiveWebhookPublisher(queue?)` / `LiveCapabilitiesOptions.webhookQueue` / `StarterEnv.WEBHOOK_QUEUE`.

## Provider-light behavior

When no queue binding is configured (`WEBHOOK_QUEUE` absent), the Live layer **no-ops** instead of failing — matching cross-cutting rule 3 in the root CLAUDE.md. The Seed layer is also a no-op.

## Anti-patterns

- Don't POST to endpoint URLs from this capability. Signing and HTTP delivery belong to the background worker's queue consumer.
- Don't bypass the `events` subscription filter — endpoints only receive event types they subscribed to.
- Don't redeclare the message shape in a consumer — import `WebhookQueueMessage` from this package.
