# apps/background

## Purpose & Scope

Cloudflare Worker for queued, scheduled and inbound-provider work: webhook fan-out and dead letters (ADR 0033), export archives (ADR 0055), seat sync (ADR 0060), notification emails and the digest (ADR 0061), the inbound Stripe webhook. Orchestration only; behavior lives in [`capabilities`](../../packages/capabilities/AGENTS.md).

## Entry Points & Contracts

- `src/index.ts`: `fetch` (only `POST /webhooks/stripe`), `queue` branching on `batch.queue` against the names in `infra/bindings.ts`, `scheduled` for the digest cron. Each wires wide-event providers first.
- `src/queue-consumer.ts` is the shared boundary; never hand-roll around it. `consumerInvocation` is the one consumer entry: trace continuation, `withTriggerScope` with the attempt count, capability layers, one named fold to `'retry' | 'ack'`.

## Usage Patterns

Per queue the outcome table is the contract; the non-obvious parts:

- Webhooks retry a retryable failure (5xx, 408, 429, network, timeout) at `backoffSeconds(attempts)`; a 4xx or SSRF rejection is `failed_permanent`; undispatchable or malformed acks.
- The DLQ consumer acks after writing the terminal `dead_lettered` row, but retries if that write fails, so a D1 blip cannot lose the evidence.
- Exports resolve `WorkspaceContext` from the slug with no actor, ownership having been checked at request time; a slug naming another `workspaceId` fails the row. No DLQ, the row is the record. `WORKSPACE_EXPORT_RETENTION_DAYS` is declared twice, in `infra/bindings.ts` (R2 lifecycle rule) and the capability; `export-consumer.test.ts` fails if they diverge.
- Seat sync has no DLQ, since the next mutation re-syncs. Its Stripe env is `starterEnv(env)` plus `billingOptionsFromEnv(env)`, because `starterEnv` projects bindings only.
- Notification email messages carry ids only, so re-read notification and preferences. Digest sends are never fatal, and the run retries so a failed cron is recorded.

## Anti-patterns

- Do not mint a trace id or set `traceparent`/`b3`: `currentTraceId` is the only source, and `HttpClient` injects the headers on the delivery POST.
- Do not emit terminal delivery audit events here: the capability batches that row with the attempt so both commit together.
- Do not duplicate the delivery state machine: `backoffSeconds`, `classifyResponseStatus`, `planDeliveryAttempt` and `validateWebhookUrl` are pure capability exports.
- Do not give `webhook-signing.ts` dependencies; a test imports it directly against a fixed HMAC vector.
- Do not edit the generated `wrangler.jsonc`, and build no OTLP exporter at isolate level (ADR 0050): `runInvocation` provides it per invocation, so exporters flush before the handler settles.

## Dependencies & Edges

- `apps/api` and `apps/web` produce onto the queues this worker consumes; it also produces onto `NOTIFICATION_EMAIL_QUEUE`. Absent optional bindings degrade to a no-op. Observability: [`logger`](../../packages/logger/AGENTS.md).
- Queue names, consumer settings and the digest cron are single-sourced in `infra/bindings.ts` (change it, then `pnpm run infra:wrangler`); alchemy reads the same records.

## Patterns & Pitfalls

- One decode per delivery: `queueDelivery` folds platform fields and the consumer's decode into one `QueueDelivery`, so malformed is a named `kind` rather than an absent value, and terminal (no trusted `endpointId` to attach a row to).
- The fold sits outside `withTriggerScope`, so the wide event exits carrying the failure cause before it becomes a queue outcome. `onFailure: 'retry'` except the DLQ entry.
- `recordDeliveryAttempt` upserts on `deliveryIdFor`: one row per message, not per attempt, `payload` and `replayedFrom` insert-only so a redelivery cannot erase a replay's provenance.
- `signatureHeaderValue` owns the signature format: HMAC-SHA256 over `"<unix>.<rawBody>"`, one `sha256=` per active secret, current first, two only inside a rotation's grace window (ADR 0062).
- The SSRF guard runs at endpoint creation _and again at dispatch_; DNS rebinding is out of scope.
