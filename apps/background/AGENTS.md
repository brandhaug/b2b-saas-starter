# apps/background

Cloudflare Worker for queued work.

## Owned today

Cloudflare Worker for queued work.

## Owned today

- **Webhook delivery** — Queue consumer for `b2b-saas-starter-webhooks`. Decodes each message body against the shared `WebhookQueueMessage` schema, signs payloads (see recipe below), and persists attempt history to `webhookDeliveries` via `WebhookEndpoints`.
- **Webhook dead letters** — Queue consumer for `b2b-saas-starter-webhooks-dlq` (same worker; the `queue` handler branches on `batch.queue`). Records a terminal `dead_lettered` delivery row and a `webhook_dead_letter` wide event, then acks.
- **Workspace exports** (ADR 0055) — Queue consumer for `b2b-saas-starter-workspace-exports`, in `src/export-consumer.ts`. Decodes the body against `WorkspaceExportQueueMessage`, resolves a trusted `WorkspaceContext` from the message's slug (`selectWorkspaceContextLayer`, no actor — the owner was checked at request time), snapshots the workspace through `collectWorkspaceExportSnapshot`, builds the ZIP with `buildWorkspaceExportArchive`, and hands the bytes to `WorkspaceExports.complete`, which writes the object to `WORKSPACE_EXPORT_BUCKET`, flips the row `ready`, audits, and notifies. Outcomes: malformed body → ack, nothing to attach to; unknown slug or a slug that resolves to a different `workspaceId` than the message names (deleted and re-created) → `WorkspaceExports.fail` + ack; store outage → retry, or `fail('unavailable: …')` + ack on the last attempt (`workspaceExportConsumerSettings.maxRetries`). No dead-letter queue: the row is the durable record of failure. `processWorkspaceExportMessage(delivery, resolveWorkspace)` is exported with its requirements open — tests inject stub `WorkspaceExports` + read services and `testWorkspaceContext` as the resolver. `WORKSPACE_EXPORT_RETENTION_DAYS` in `infra/bindings.ts` and the capability's constant are asserted equal in `export-consumer.test.ts`.
- **Seat sync** — Queue consumer for `b2b-saas-starter-billing` (`src/seat-sync-consumer.ts`). Membership and invitation mutations enqueue `SeatSyncQueueMessage`s (schema shared with `SeatSyncPublisher` in the capabilities package) so they never await Stripe; this consumer hands each to `Billing.syncSeats`, which counts the workspace's members, calls Stripe's subscription-item quantity update, and batches the `billing.seats_changed` audit event with the stored-quantity write. Outcomes: honest no-ops (`no_subscription`, `no_seat_item`, `quantity_unchanged`, `provider_not_configured`) ack; a real Stripe failure folds into `retry` and rides the queue's backoff; a malformed body acks. No DLQ on purpose — sync is self-healing (next mutation re-syncs; the `customer.subscription.updated` webhook reconciles drift). Stripe env reaches the Live billing layer through `seatSyncEnv` (the worker reads `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID_TEAM` off its own env through the shared `billingOptionsFromEnv` mapping), not through `starterEnv`, which projects bindings only.

## Webhook delivery contract

### Delivery statuses (`webhookDeliveries.status`)

The column is free-text; keep this vocabulary consistent (also documented on `WebhookDeliveryStatus` in `packages/capabilities/src/developer-platform/webhook-endpoints.ts`):

| Status             | Meaning                                                                            | Queue action                                |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `delivered`        | 2xx response                                                                       | ack                                         |
| `failed`           | Retryable failure: 5xx, 408, 429, network error, or 10s timeout                    | retry with `backoffSeconds(attempts)` delay |
| `failed_permanent` | Terminal: non-retryable 4xx, or the endpoint URL failed the SSRF guard at dispatch | ack (no retry)                              |
| `dead_lettered`    | Message exhausted `max_retries` and was consumed from the DLQ                      | ack                                         |

`nextAttemptAt` is derived from the same `backoffSeconds(attempts)` (`min(attempts, 6) × 30s`) used for the actual `message.retry({ delaySeconds })`, so the persisted schedule matches reality. Terminal rows have `nextAttemptAt: null`.

Terminal statuses also emit an audit event: the worker passes the queue message's `workspaceId` in every `recordDeliveryAttempt` call, and the Live capability batches an `AuditEventLog` insert (`webhook.delivery_failed` for `failed_permanent`, `webhook.delivery_dead_lettered` for `dead_lettered`; `targetType: 'webhook_endpoint'`, `actorUserId: null`) with the attempt row so both commit or roll back together. Don't emit these from the worker directly — the mapping lives on `terminalDeliveryAuditEventType` in `packages/capabilities/src/developer-platform/webhook-endpoints.ts`.

### SSRF guard

`validateWebhookUrl` (shared from `@b2b-saas-starter/capabilities`, source in `packages/capabilities/src/developer-platform/webhook-url.ts`) runs at endpoint creation **and again at dispatch time**. Invalid URLs at dispatch record a terminal `failed_permanent` row and ack. DNS-rebinding protection is out of scope for the starter.

### Signature recipe

Each delivery POST carries:

- Body: `{"deliveryId": "whd_…", "eventType": "…", "payload": …}` — `deliveryId` equals the persisted `webhookDeliveries.id`, so receivers can deduplicate redeliveries.
- `x-b2b-starter-event`: the event type.
- `x-b2b-starter-timestamp`: unix seconds at signing time.
- `x-b2b-starter-signature`: `t=<unix>,sha256=<hex>` where `<hex>` is HMAC-SHA256 over the string `"<unix>.<rawBody>"` using the endpoint's plaintext signing secret.

Verification recipe for receivers:

1. Parse `t` and `sha256` from `x-b2b-starter-signature`.
2. Reject if `|now − t|` exceeds your tolerance window (e.g. 5 minutes) — this is the replay guard.
3. Compute HMAC-SHA256 over `` `${t}.${rawBody}` `` with your signing secret and constant-time-compare the hex digest against `sha256`.
4. Deduplicate on `deliveryId` from the body.

### Message boundary

Queue payloads are `unknown` at runtime. `readQueueDelivery(envelope)` decodes the body against `WebhookQueueMessage` — the Effect Schema shared with the producer (`WebhookPublisher` in `@b2b-saas-starter/capabilities`) so both sides use one wire shape. The message carries `workspaceId` (stamped by the publisher from the producing request's `WorkspaceContext`), and `getDispatchTarget(endpointId, workspaceId)` verifies it before returning the signing secret — a cross-workspace mismatch resolves `null` and acks as `skipReason: 'not_dispatchable'`, same as a disabled or deleted endpoint. A malformed message is terminal: redelivery can never fix its shape, and there is no trusted `endpointId` to attach a delivery row to, so it is recorded on the wide event (`skipReason: 'malformed_message'`) and acked — never retried. `WebhookMessage` in `src/webhook-consumer.ts` is just a type alias for `typeof WebhookQueueMessage.Type`. The decode runs **once per delivery**: `deliverWebhook` / `recordDeadLetter` turn the platform's `QueueEnvelope` (`{ id, body, attempts }`, the structural subset of a Cloudflare queue `Message`, shared with the export consumer) into a `WebhookQueueDelivery` — the platform fields plus `kind: 'message'` with the decoded message, or the named terminal outcome `kind: 'malformed'` — and both the trace continuation (`queueParentSpan`) and the consumer read that one result. `processWebhookMessage` / `processDeadLetterMessage` take the decoded delivery, so neither re-decodes and neither signals malformed with an absent value.

The delivery **state machine lives below the capability interface**: `backoffSeconds`, `classifyResponseStatus`, and `planDeliveryAttempt(responseStatus, attempts, now)` are pure exports of `webhook-endpoints.ts` (the capability derives persisted status, `nextAttemptAt`, and the ack/retry outcome from them — the worker passes the same `backoffSeconds(attempts)` to `message.retry`), and never-dispatched/exhausted messages go through `recordTerminalDeliveryAttempt({ endpointId, workspaceId, eventType, attempts, status })`, which mints the delivery id, timestamps the row, and batches the terminal audit event inside the capability. The worker keeps only `computeWebhookSignature` / `signatureHeaderValue` (exported from `src/index.ts` for `src/index.test.ts` — keep them dependency-free). The full delivery orchestration is also exported as `processWebhookMessage(delivery, traceId)`, and the DLQ core as `processDeadLetterMessage(delivery)`, with their `WebhookEndpoints` (+ `HttpClient` for delivery) requirements left open: tests inject stub layers to exercise delivered/retry/terminal/disabled/SSRF/malformed paths without a queue; the `queue` handler wraps them with the real layers and the wide-event scope (`deliverWebhook` / `recordDeadLetter`). Real-D1 coverage of the terminal-outcome audit rows lives with the capability, in `packages/capabilities/src/developer-platform/webhook-endpoints.live.test.ts`.

## Planned, not wired

- Email fan-out is referenced in the starter narrative but has no handler in `src/index.ts` yet. Wire alongside its capability counterpart (`@b2b-saas-starter/email`).
- Notification emission on `failed_permanent` and `dead_lettered` deliveries (the audit events are wired — see the delivery contract above).

## Conventions

- Use Cloudflare Queues for retryable webhook work and D1 for delivery attempt history.
- Handlers build the capabilities env through `starterEnv(env)` (`src/index.ts`). Alchemy forwards the optional provider env to this worker under its canonical names (e.g. `CLOUDFLARE_EMAIL_FROM`) — no remapping.
- Wide-event envelopes come from `withTriggerScope` (`@b2b-saas-starter/logger`) — queue handlers pass `{ service, event, env, parent?, spanKind?, metadata }` and never hand-assemble `withRequestScope` options.
- **Trace continuation across the queue.** The producer stamps the request's W3C `traceparent` onto `WebhookQueueMessage`; `queueParentSpan(delivery)` reads it off the delivery the consumer already decoded and resolves it via `parentSpanFromHeaders` (a malformed body carries no trusted `traceparent`, so it just starts its own trace) and both consumers pass it as `parent` with `spanKind: 'consumer'`. The `x-trace-id` forwarded on the delivery POST is `currentTraceId`, i.e. this scope's OTel trace id, so the header a receiver quotes back resolves in the trace backend. Don't mint a fresh id here — `currentTraceId` is the only source. The `traceparent`/`b3` headers on that POST are injected by Effect's `HttpClient` — don't set them by hand.
- **Every invocation runs through `runInvocation(env, effect)`**, which provides `makeOtlpLayer('background', env)` per invocation (`Effect.provide(..., { local: true })`, never per isolate — see ADR 0050), the same split `apps/api` and `apps/web` use. `WideEventLoggerLive` is provided isolate-level from a module-scope `ManagedRuntime` in `src/index.ts`, not rebuilt per invocation.
- Local development may direct-dispatch when queues are unavailable — follow the rate-limit fallback pattern in `apps/api/src/rate-limit.ts` when adding new queue consumers.
- Queue consumers are wired in both `wrangler.jsonc` (local dev) and the root `alchemy.run.ts` (deploy). The `queue` handler's dead-letter branch imports `webhookDeadLetterQueueName` from `infra/bindings.ts` rather than repeating the literal, so the branch cannot drift from the consumer it is bound to. Queue names and consumer settings are single-sourced in `infra/bindings.ts` — alchemy imports the constants directly and `infra/write-wrangler.ts` generates `wrangler.jsonc` from them. Change a setting there, then run `pnpm run infra:wrangler`; never edit the generated config by hand.
