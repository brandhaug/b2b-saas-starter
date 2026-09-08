# Webhook publisher

Decides which endpoints receive a domain event and puts one queue message per endpoint on `WEBHOOK_QUEUE`. Signing, delivery and retries belong to the consumer in `apps/background`.

## Contracts

- `enqueue` is the pre-addressed single send for replay and test send: no subscription filter, no workspace resolution, every id from the caller. Seed no-ops.
- `WebhookQueueMessage` is owned here; the background consumer imports it rather than keeping a parallel shape. `workspaceId` is stamped from the producer's `WorkspaceContext` and re-verified by `getDispatchTarget` before secrets are released.
- Live fan-out reserves each delivery row before sending the queue batch. The consumer binds `deliveryId` to the endpoint/workspace and loads the persisted event payload before signing; queue body fields are routing hints only. Unknown delivery IDs are terminally ignored and never create replayable rows.
- `deliveryId` is required and minted before enqueueing. It stays stable across retries and dead-letter queue transfer. Replay and test send use their pre-created pending row ID.
- With no queue binding, best-effort `publish` stays inactive. Explicit `enqueue` refuses with `CapabilityUnavailable`; test/replay callers must never report a queued delivery when nothing was enqueued.

## Pitfalls

- `traceparent` rides the message body because a queue is the one hop HTTP headers cannot cross (ADR 0050). It comes from `currentTraceparent` and is absent outside a span, where the consumer starts its own trace.
- `publishWebhookEventWith` is the best-effort composition mutating capabilities use: a failed publish annotates the wide event (`webhookPublish: 'failed'`) and never fails the mutation. Passing the publisher as an argument keeps it out of those interfaces. `webhook-endpoints` does the opposite for replay and test send, where an operator must see the failure.

## Boundaries

- No `traceparent` read from a header or hand-built; the span to continue is the one open now.
