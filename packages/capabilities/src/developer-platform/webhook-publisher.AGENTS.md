# Webhook publisher

Fans domain events onto `WEBHOOK_QUEUE`. Signing, delivery and retries belong to `apps/background`.

## Contracts

- `enqueue` sends one addressed replay/test message without subscription filtering or workspace resolution. Callers supply every ID; Seed no-ops.
- `publish` takes workspace authority from `WorkspaceContext`. Background mutations that have no request context use the required `publishForWorkspace(workspaceId, input)` seam and pass the owning workspace ID explicitly. The publisher never infers tenant identity from event payloads.
- The public webhook catalog is the eight-event allowlist in `webhook-events.ts`. `WebhookEventPayloads` provides a dedicated schema for each event; unknown payload fields are removed before queueing, and audit metadata, secrets, and actor context are not forwarded.
- `AUDIT_EVENT_PUBLICATION_POLICY` exhaustively assigns every audit taxonomy entry to `webhook` or `audit-only`. Only the eight catalog events are webhook publications; authentication, administration, delivery/failure, and other audit records remain audit-only until their policy entry is deliberately changed.
- This module owns `WebhookQueueMessage`. Producers stamp `workspaceId` from `WorkspaceContext`; consumers verify it before releasing secrets.
- Live fan-out reserves deliveries before sending the batch. Consumers bind `deliveryId` to endpoint/workspace and sign the stored event payload. Queue contents are routing hints; unknown delivery IDs create no replayable rows.
- Reservation is a narrow exception to `auditedMutations`: one insert reserves the batch as transport admission evidence, like test-send rows. The originating domain mutation owns its business audit. Queue confirmation failure uses [enqueue failure evidence](./webhook-enqueue-failure.live.ts) to atomically settle untouched reservations with terminal attempts and `webhook.delivery_failed` audits, without changing endpoint failure streaks. See ADR 0062 for partial acceptance and storage-failure limits.
- `deliveryId` stays stable across retries and dead letters. Replay/test sends use their pending row ID.
- An absent queue leaves `publish` inactive. Explicit `enqueue` refuses with `CapabilityUnavailable`; callers cannot report a queued delivery.
- Producers publish after the domain mutation has succeeded. No-op, refused, duplicate, or failed mutations produce no webhook. Fan-out is best effort and preserves mutation success; Seed supplies the same interface with a no-op implementation.
- Invitation acceptance emits `workspace_invitation.accepted` and the newly created member's `workspace_member.added` event. Direct SSO/plugin membership writes and account-deletion cascades have no publisher hook in this baseline.

## Pitfalls

- `traceparent` comes from `currentTraceparent` in the producing span, never a header or hand-built value. Without it, consumers start a trace (ADR 0050).
- `publishWebhookEventWith` annotates failures as `webhookPublish: 'failed'` without failing the originating mutation. Passing the publisher keeps it out of capability interfaces. Explicit replay/test sends surface enqueue failures to operators.
