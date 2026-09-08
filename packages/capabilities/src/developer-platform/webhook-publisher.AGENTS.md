# Webhook publisher

Fans domain events onto `WEBHOOK_QUEUE`. Signing, delivery and retries belong to `apps/background`.

## Contracts

- `enqueue` sends one addressed replay/test message without subscription filtering or workspace resolution. Callers supply every ID; Seed no-ops.
- This module owns `WebhookQueueMessage`. Producers stamp `workspaceId` from `WorkspaceContext`; consumers verify it before releasing secrets.
- Live fan-out reserves deliveries before sending the batch. Consumers bind `deliveryId` to endpoint/workspace and sign the stored event payload. Queue contents are routing hints; unknown delivery IDs create no replayable rows.
- Reservation is a narrow exception to `auditedMutations`: one insert reserves the batch as transport admission evidence, like test-send rows. The originating domain mutation owns its business audit. Queue confirmation failure uses [enqueue failure evidence](./webhook-enqueue-failure.live.ts) to atomically settle untouched reservations with terminal attempts and `webhook.delivery_failed` audits, without changing endpoint failure streaks. See ADR 0062 for partial acceptance and storage-failure limits.
- `deliveryId` stays stable across retries and dead letters. Replay/test sends use their pending row ID.
- An absent queue leaves `publish` inactive. Explicit `enqueue` refuses with `CapabilityUnavailable`; callers cannot report a queued delivery.

## Pitfalls

- `traceparent` comes from `currentTraceparent` in the producing span, never a header or hand-built value. Without it, consumers start a trace (ADR 0050).
- `publishWebhookEventWith` annotates failures as `webhookPublish: 'failed'` without failing the originating mutation. Passing the publisher keeps it out of capability interfaces. Explicit replay/test sends surface enqueue failures to operators.
