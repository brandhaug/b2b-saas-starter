# Webhook Publisher

## Purpose & Scope

Workspace-scoped fan-out of domain events onto the outbound webhook queue, plus the pre-addressed single send the operator surface uses. Producers call `publish({ eventType, payload })`; the operator mutations call `enqueue(...)`; delivery (HMAC signing, retries, attempt history) is owned by the queue consumer in `apps/background`. This capability only decides _which_ endpoints receive a fan-out message and enqueues one message per endpoint.

## Public surface

- `WebhookQueueMessage` — `{ endpointId, workspaceId, eventType, deliveryId?, traceparent?, payload }`, exported as both the `effect/Schema` struct and its `Type`. This package owns the wire shape; the queue consumer in `apps/background` imports it from here instead of maintaining a parallel type. `workspaceId` is stamped from the producing request's `WorkspaceContext` and re-verified by `WebhookEndpoints.getDispatchTarget` before the signing secrets are released. `deliveryId` is present only when the row already exists (a replay or test send created it as `pending`) — the consumer resolves that row instead of deriving `whd_<message id>`.
- `traceparent` is the producing request's W3C trace context, read from `currentTraceparent` (`@b2b-saas-starter/logger`). A queue is the one hop HTTP headers cannot cross, so it rides on the message body; the consumer decodes it as its span's parent and the whole API → queue → delivery chain stays one trace (ADR 0050). It is optional: outside a span — direct calls, tests — it is simply absent and the consumer starts its own trace.
- `WebhookPublisher.publish({ eventType, payload })` — for the current `WorkspaceContext`, selects enabled endpoints whose `events` array contains `eventType` and enqueues one `WebhookQueueMessage` per endpoint in a single `sendBatch` call to the `WEBHOOK_QUEUE` binding (no send when zero endpoints subscribe). Fails with `CapabilityUnavailable` (503) — via the shared `orUnavailable` helper — if D1 or the queue send fails.
- `WebhookPublisher.enqueue(input)` — one pre-addressed message (replay, test send): no subscription filter, no workspace resolution, the caller hands over endpoint id, workspace id, event type, delivery id, and payload. The Live layer adds the trace context and `queue.send`s; the Seed layer is a no-op.
- `WebhookQueueBinding` — structural `{ send, sendBatch }` subset of Cloudflare's `Queue` so this package doesn't depend on `@cloudflare/workers-types`. Threaded in via `LiveWebhookPublisher(queue?)` / `LiveCapabilitiesOptions.webhookQueue` / `StarterEnv.WEBHOOK_QUEUE`.
- `publishWebhookEventWith(publisher, { eventType, payload })` — the best-effort composition the mutating capabilities use: a failed publish annotates the wide event (`webhookPublish: 'failed'`) but never fails the mutation. Taking the publisher as an argument keeps `WebhookPublisher` out of most capability interfaces; fan-out is implementation detail below the seam. (The webhook endpoint capability deliberately takes the publisher for its _replay/test-send_ enqueue, where a failure should be visible to the operator.)

## Provider-light behavior

When no queue binding is configured (`WEBHOOK_QUEUE` absent), the Live layer **no-ops** instead of failing — matching cross-cutting rule 3 in the root CLAUDE.md. The Seed layer is also a no-op.

## Anti-patterns

- Don't POST to endpoint URLs from this capability. Signing and HTTP delivery belong to the background worker's queue consumer.
- Don't bypass the `events` subscription filter — endpoints only receive event types they subscribed to.
- Don't redeclare the message shape in a consumer — import `WebhookQueueMessage` from this package.
- Don't read `traceparent` from a header or build it by hand. `currentTraceparent` is the one encoder; a header on the producing request is the wrong source, because the span this message should continue is the one open right now.
