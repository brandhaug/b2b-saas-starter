# Webhook Publisher

## Purpose & Scope

Decides which endpoints receive a domain event and puts one queue message per endpoint on `WEBHOOK_QUEUE`. Signing, delivery and retries belong to the consumer in `apps/background`.

## Entry Points & Contracts

- `publish` selects the workspace's enabled endpoints whose `events` array contains the `eventType` and sends them in one `sendBatch`; zero subscribers means no send.
- `enqueue` is the pre-addressed single send for replay and test send: no subscription filter, no workspace resolution, every id from the caller. Seed no-ops.
- `WebhookQueueMessage` is owned here; the background consumer imports it rather than keeping a parallel shape. `workspaceId` is stamped from the producer's `WorkspaceContext` and re-verified by `getDispatchTarget` before secrets are released.
- `deliveryId` is present only when the row exists already (replay or test send made it `pending`); otherwise the consumer derives `whd_<message id>`.
- `WebhookQueueBinding` is structural `{ send, sendBatch }`, so this package never depends on `@cloudflare/workers-types`.
- With no queue binding, Live no-ops rather than failing (CLAUDE.md rule 3).

## Patterns & Pitfalls

- `traceparent` rides the message body because a queue is the one hop HTTP headers cannot cross (ADR 0050). It comes from `currentTraceparent` and is absent outside a span, where the consumer starts its own trace.
- `publishWebhookEventWith` is the best-effort composition mutating capabilities use: a failed publish annotates the wide event (`webhookPublish: 'failed'`) and never fails the mutation. Passing the publisher as an argument keeps it out of those interfaces. `webhook-endpoints` does the opposite for replay and test send, where an operator must see the failure.

## Anti-patterns

- No POSTing endpoint URLs from here, no bypassing the `events` subscription filter, no message shape redeclared in a consumer.
- No `traceparent` read from a header or hand-built; the span to continue is the one open now.
