# Webhook Endpoints

## Purpose & Scope

Outbound webhook destinations and the operator surface over them. Dispatch belongs to the background worker, through `WEBHOOK_QUEUE` and [`webhook-publisher`](./webhook-publisher.AGENTS.md).

## Entry Points & Contracts

- `create` gates on the plan ceiling via `assertWithinPlanLimitFor` (billing owns it) and fans out a best-effort projection that omits the secret.
- Audits `webhook_endpoint.created` / `.updated` / `.deleted` and `webhook.delivery_replayed`. `sendTestEvent` audits nothing; its row is the record.
- `replayDelivery` writes a new `pending` row linked by `replayedFrom`, never touching the source (ADR 0062). `WebhookDispatchRejected` (409) is a non-failed source or disabled endpoint.
- `rotateSecret` shifts the replaced secret into the grace columns, where it signs another 24h. Expired values are filtered lazily by `activeSigningSecrets`, so no sweep exists.
- Background methods take the workspace id off the queue message; every lookup is `(endpointId, workspaceId)`. `getDispatchTarget` returns `signingSecrets` plural, for the grace window.
- A `dead_lettered` attempt also records a broadcast `NotificationFeed` row, its copy owned by `deadLetterNotification`.

## Patterns & Pitfalls

- The delivery state machine lives in storage-free `webhook-delivery-plan.ts`, not the worker. `recordDeliveryAttempt` upserts on the row id, one row per queue message. Its `set` clause is attempt state only: `payload` and `replayedFrom` are insert-only, and evidence absent from the input stays as recorded, else a terminal write erases the previous attempt's.
- `webhook_deliveries.payload` is NOT NULL so a terminal row stays replayable.
- Signing secrets are plaintext in D1 by design (HMAC needs them back); only `rotateSecret` and `getDispatchTarget` return them.

## Anti-patterns

- No dispatch from a request path, no in-place delivery mutation to replay, no `successRate` recomputed in a route.
- Every mutation's where clause carries `workspaceId`, never the endpoint id alone (regression test in `src/index.test.ts`).

> TODO(intent): keyset paging for deliveries, a per-attempt timeline, `lastDeliveryAt` on the list projection.
