# apps/background

## Purpose & Scope

Cloudflare Worker for queued, scheduled and inbound-provider work: webhook fan-out and dead letters (ADR 0033), export archives (ADR 0055), seat sync (ADR 0060), notification emails and the digest (ADR 0061), the inbound Stripe webhook. Orchestration only; behavior lives in [`capabilities`](../../packages/capabilities/AGENTS.md).

## Entry Points & Contracts

- Every entry wires wide-event providers before running work.
- `src/queue-consumer.ts` is the shared boundary; never hand-roll around it. `consumerInvocation` is the one consumer entry: trace continuation, `withTriggerScope` with the attempt count, capability layers, one named fold to `'retry' | 'ack'`. `onFailure` also takes an `(attempts) => outcome` function, which is how the dead-letter entries bound a defect instead of acking it on first delivery.
- `src/queue-routing.ts` owns queue name → consumer. Physical names are
  `stageResourceNames`, so every stage but `prod` prefixes them: match the
  stage-invariant suffix, dead letters first, and never add a fallback branch.
  An unmatched name is an annotated `queue_unrouted` ack, not a webhook.
  `src/scheduled-routing.ts` is the same shape for cron: one `scheduledRun`
  match yields both the work and the monitor slug, and an unknown expression
  exits as `scheduled_unrouted` (`unknownCronEvent`, exported so a test reads
  the event) with no monitor check-in, instead of reporting under another
  trigger's slug.

Read [delivery guidance](../../docs/agents/background-delivery.md) before changing webhook dispatch/signing, queue-specific outcomes, export generation, billing recovery, or notification/digest delivery.

## Anti-patterns

- Do not mint a trace id or set `traceparent`/`b3`: `currentTraceId` is the only source, and `HttpClient` injects the headers on the delivery POST.
- Do not emit terminal delivery audit events here: the capability batches that row with the attempt so both commit together.
- Do not infer queue disposition from delivery evidence or repeat failure notifications after completion.
- Do not edit the generated `wrangler.jsonc`, and build no OTLP exporter at isolate level (ADR 0050): `runInvocation` provides it per invocation, so exporters flush before the handler settles.

## Dependencies & Edges

- `apps/api` and `apps/web` produce onto the queues this worker consumes; it also produces onto `NOTIFICATION_EMAIL_QUEUE`. Absent optional bindings degrade to a no-op. Observability: [`logger`](../../packages/logger/AGENTS.md).
- Queue names, consumer settings and the digest cron are single-sourced in `infra/bindings.ts`, imported as `@b2b-saas-starter/infra` and never by relative path (change it, then `pnpm run infra:wrangler`); alchemy reads the same records.

## Patterns & Pitfalls

- One decode per delivery: `readDelivery(schema, envelope)` folds the platform fields and the message-schema decode into one `QueueDelivery`, so malformed is a named `kind` rather than an absent value, and terminal (no trusted `endpointId` to attach a row to). Report it with `annotateMalformed(outcome)` beside it; no consumer spells that arm itself.
- Cloudflare counts `attempts` from 1, so the platform's last delivery is
  `maxRetries + 1`. `finalQueueAttempt(attempts, settings)` in `monitoring.ts`
  is the only predicate for it: the export consumer's `finalAttempt`, both DLQ
  retry bounds, and `exhaustedQueueDelivery` read it.
- The fold sits outside `withTriggerScope`, so the wide event exits carrying the failure cause before it becomes a queue outcome. `onFailure: 'retry'` except the dead-letter entries, which bound it by attempt.

- The hourly retention invocation owns scheduled cleanup, including webhook/email history. Keep its approval gate separate from the daily digest; see [retention](../../packages/capabilities/src/governance/retention.AGENTS.md).
