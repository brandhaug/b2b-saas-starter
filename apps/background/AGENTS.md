# apps/background

Cloudflare Worker for recurring and queued work.

## Owned today

- **Catalog refresh** — cron at `0 6 * * *` (daily 06:00 UTC, `wrangler.jsonc`) runs `runCatalogRefresh` (`@b2b-saas-starter/capabilities`), which owns the "no run goes unrecorded" sequence: capture the refresh outcome, write a `catalogRefreshRuns` row (ok or failed, real duration), then re-raise failures. The handler adds only the env-selected layer and the wide-event scope; don't re-implement the capture-record-refail block here.
- **Webhook delivery** — Queue consumer for `b2b-saas-starter-webhooks`. Decodes each message body against the shared `WebhookQueueMessage` schema, signs payloads (see recipe below), and persists attempt history to `webhookDeliveries` via `WebhookEndpoints`.
- **Webhook dead letters** — Queue consumer for `b2b-saas-starter-webhooks-dlq` (same worker; the `queue` handler branches on `batch.queue`). Records a terminal `dead_lettered` delivery row and a `webhook_dead_letter` wide event, then acks.

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

Queue payloads are `unknown` at runtime. `processWebhookMessage` and `processDeadLetterMessage` decode the body against `WebhookQueueMessage` — the Effect Schema shared with the producer (`WebhookPublisher` in `@b2b-saas-starter/capabilities`) so both sides use one wire shape. The message carries `workspaceId` (stamped by the publisher from the producing request's `WorkspaceContext`), and `getDispatchTarget(endpointId, workspaceId)` verifies it before returning the signing secret — a cross-workspace mismatch resolves `null` and acks as `skipReason: 'not_dispatchable'`, same as a disabled or deleted endpoint. A malformed message is terminal: redelivery can never fix its shape, and there is no trusted `endpointId` to attach a delivery row to, so it is recorded on the wide event (`skipReason: 'malformed_message'`) and acked — never retried. `WebhookMessage` in `src/index.ts` is just a type alias for `typeof WebhookQueueMessage.Type`.

Pure helpers (`backoffSeconds`, `classifyResponseStatus`, `computeWebhookSignature`, `signatureHeaderValue`) are exported from `src/index.ts` for the tests in `src/index.test.ts` — keep them dependency-free. The full delivery orchestration is also exported as `processWebhookMessage(input, attempts, traceId)`, and the DLQ core as `processDeadLetterMessage(input, attempts)`, with their `WebhookEndpoints` (+ `HttpClient` for delivery) requirements left open: tests inject stub layers to exercise delivered/retry/terminal/disabled/SSRF/malformed paths without a queue; the `queue` handler wraps them with the real layers and the wide-event scope (`deliverWebhook` / `recordDeadLetter`). Real-D1 coverage of the terminal-outcome audit rows lives with the capability, in `packages/capabilities/src/live-layers.test.ts`.

## Planned, not wired

- Email fan-out and report scheduling are referenced in the starter narrative but have no handlers in `src/index.ts` yet. Wire alongside their capability counterparts (`@b2b-saas-starter/email`, `implementation-reports`).
- Notification emission on `failed_permanent` and `dead_lettered` deliveries (the audit events are wired — see the delivery contract above).

## Conventions

- Use Cloudflare Queues for retryable webhook work and D1 for delivery attempt history.
- Handlers build the capabilities env through `starterEnv(env)` (`src/index.ts`), which attaches `moduleConfig` via `makeStarterEnvModuleConfig(env)` (`@b2b-saas-starter/env`, ADR 0035). Alchemy forwards the optional module env to this worker under its canonical names (e.g. `CLOUDFLARE_EMAIL_FROM`) — no remapping.
- Wide-event envelopes come from `withTriggerScope` (`@b2b-saas-starter/logger`) — cron and queue handlers pass `{ service, event, env, traceId?, metadata }` and never hand-assemble `withRequestScope` options.
- Local development may direct-dispatch when queues are unavailable — follow the rate-limit fallback pattern in `apps/api/src/rate-limit.ts` when adding new queue consumers.
- `catalog-refresh.ts` is a CLI/test entry point — the scheduled handler lives in `src/index.ts`.
- Queue consumers are wired in both `wrangler.jsonc` (local dev) and the root `alchemy.run.ts` (deploy). Queue names and consumer settings are single-sourced in `infra/bindings.ts` — alchemy imports the constants directly, and the drift test `infra/bindings.test.ts` fails red if `wrangler.jsonc` disagrees. Change a setting there first, then update `wrangler.jsonc` until the test passes.
