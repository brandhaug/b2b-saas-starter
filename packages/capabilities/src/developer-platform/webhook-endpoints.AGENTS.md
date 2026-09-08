# Webhook Endpoints

## Purpose & Scope

Webhook destinations and tooling; background dispatch uses [`webhook-publisher`](./webhook-publisher.AGENTS.md).

## Entry Points & Contracts

- [Resource entitlements](../billing/resource-entitlements.AGENTS.md) owns creation admission; creation publishes a best-effort projection without the secret.
- Replay creates an audited `pending` copy linked by `replayedFrom`; the source stays untouched (ADR 0062). Test sends use their delivery row as the record.
- `/admin` calls `listGlobalDeliveries` and `replayDeliveryAsAdmin` without `WorkspaceContext`. Its boundary rechecks the system-admin session; replay resolves the workspace internally and audits the actual actor with `scope: system_admin`. Never fabricate membership. Workspace replay keeps its membership and permission gates.
- Background lookups require `(deliveryId, endpointId, workspaceId)` and bind the persisted delivery to the endpoint's current workspace. Dispatch targets return all active signing secrets and the stored event and payload. Terminal audits and dead-letter notifications also use stored contents; unknown or mismatched deliveries create no evidence.
- [Attempt completion](./webhook-attempt-completion.ts) owns queue disposition and accepted-only warnings. Persistence retains dead-letter broadcasts. Terminal bookkeeping after HTTP failures does not count another dispatch failure.

## Patterns & Pitfalls

- `webhook-attempt-history.live.ts` atomically accepts immutable attempt observations, advances summaries, moves failure streaks, and auto-disables with guarded audits. Read [ADR 0062](../../../../docs/adr/0062-webhook-protocol-and-operator-tooling.md) before changing acceptance order or identity.
- Global paging uses `(lastAttemptAt DESC, id DESC)`, with null times last in both adapters. Admin replay requires a terminal source and enabled endpoint. Queue failures remain visible after the pending copy commits.
- `isDeliverySettled` reads persisted delivered or terminal status scoped to delivery, endpoint, and workspace. Consumers check it before HTTP dispatch, so a duplicate queue message cannot send a suspension-suppressed delivery after recovery. Explicit replay creates a new delivery ID.
- Signing secrets are plaintext in D1 by design (HMAC needs them back); only `rotateSecret` and `getDispatchTarget` return them.

## Anti-patterns

- No dispatch from a request path, no in-place delivery mutation to replay, no `successRate` recomputed in a route.
- Every mutation's where clause carries `workspaceId`, never the endpoint id alone.

> TODO(intent): keyset paging for delivery summaries, `lastDeliveryAt` on the list projection.

- `listDeliveryAttempts` joins through the delivery and endpoint to enforce workspace ownership. `cleanupDeliveryHistory` removes a bounded expired-summary batch; attempts cascade. Seed mirrors both.
