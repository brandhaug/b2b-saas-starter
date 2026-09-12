# Background delivery

Implementation guidance for `apps/background`. Source filenames below refer to that worker unless another package is named. Read this before changing webhook dispatch/signing, queue-specific outcomes, export generation, billing recovery, or notification/digest delivery.

## Queue outcomes

Per queue the outcome table is the contract; the non-obvious parts:

- Webhooks retry a retryable failure (5xx, 408, 429, network, timeout) at `backoffSeconds(attempts)`; a 4xx or SSRF rejection is `failed_permanent`; undispatchable or malformed acks.
- [Webhook Attempt completion](../../packages/capabilities/src/developer-platform/webhook-attempt-completion.ts) owns planning, recording and accepted-only warnings. The worker owns signing and HTTP dispatch; it follows completion's queue disposition, including for duplicate or late observations.
- The DLQ consumer acks after writing the terminal `dead_lettered` row, but retries if that write fails, so a D1 blip cannot lose the evidence.
- Exports use the capability-owned generation workflow after resolving
  `WorkspaceContext` from the slug with no actor, ownership having been checked
  at request time; a slug naming another `workspaceId` fails the row. The queue
  adapter keeps decoding, tracing, and platform retry scheduling; generation
  owns snapshot/build/completion and terminal settlement. No DLQ, the row is
  the record. `WORKSPACE_EXPORT_RETENTION_DAYS` is declared twice, in
  `infra/bindings.ts` (R2 lifecycle rule) and the capability;
  `export-consumer.test.ts` fails if they diverge.
- Seat sync uses the billing queue and its dead-letter queue. The primary queue
  retries six times; the dead-letter consumer calls `Billing.reconcileWorkspace`
  so recovery does not require a later mutation. A failed recovery takes the
  webhook DLQ's shape: `boundedRecoveryOutcome` retries while the platform will
  redeliver, then acks with the loss annotated. `onFailure` is that same
  bounded arm, so a defect cannot ack a dead letter on its first delivery.
  Both billing entries and the Stripe endpoint build their env with
  `billingCapabilitiesEnv` (`billing-runtime.ts`), which adds the Stripe bag
  because `starterEnv` projects bindings only, and share one
  `applyProviderEvent` for a queued provider event. The operator-retry audit
  row is written after the reconcile settles, so a redelivery cannot append a
  second one.
- Notification email messages carry ids only, so re-read notification and preferences before claiming. Email delivery owns retry timing; use its completion decision even when an active lease skips sending. Digest sends are never fatal, and failed reads retry the run.

## Webhook dispatch and evidence

- Do not give `webhook-signing.ts` dependencies; a test imports it directly against a fixed HMAC vector.

- The publisher persists a delivery before enqueueing its `deliveryId`. Both consumers bind that delivery to its endpoint and current workspace; stored contents supply dispatch and terminal evidence. Each observation is unique by delivery, attempt ordinal, and phase. Completion prevents repeated warnings ([ADR 0062](../../docs/adr/0062-webhook-protocol-and-operator-tooling.md)). Requester authorization stays at scheduling; execution checks current workspace suspension and resource availability.

- `signatureHeaderValue` owns the signature format: Standard Webhooks HMAC-SHA256 over `"<deliveryId>.<unix>.<rawBody>"`, one space-separated `v1,<base64>` per active secret, current first, two only inside a rotation's grace window (ADR 0062).

- The SSRF guard runs at endpoint creation _and again at dispatch_; DNS rebinding is out of scope.
