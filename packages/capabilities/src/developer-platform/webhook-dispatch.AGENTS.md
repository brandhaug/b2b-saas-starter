# Webhook Dispatch

## Purpose & Scope

Queue-execution state for `apps/background`: `getDispatchTarget`, `isDeliverySettled`, `recordDeliveryAttempt`, `recordTerminalDeliveryAttempt`. [Attempt completion](./webhook-attempt-completion.ts) owns queue disposition and accepted-only warnings on top of it; signing and HTTP belong to the worker ([background delivery](../../../../docs/agents/background-delivery.md)).

## Contracts

- No `WorkspaceContext` on the consumer. Lookups require `(deliveryId, endpointId, workspaceId)` and bind the persisted delivery to the endpoint's current workspace; a mismatch resolves `null`/`false` and creates no evidence. Dispatch targets return all active signing secrets and the stored event and payload.
- `isDeliverySettled` reads persisted delivered or terminal status. Consumers check it before HTTP dispatch, so a duplicate queue message cannot send a suspension-suppressed delivery after recovery. Explicit replay creates a new delivery ID.
- `webhook-attempt-history.live.ts` atomically accepts immutable attempt observations, advances summaries, moves failure streaks, and auto-disables with guarded `system` audits. Read [ADR 0062](../../../../docs/adr/0062-webhook-protocol-and-operator-tooling.md) before changing acceptance order or identity.
- Trusted bookkeeping can originate history; queued terminal observations require an existing producer-owned delivery and load its stored ownership and contents. Terminal bookkeeping after HTTP failures does not count another dispatch failure. Dead letters notify through the feed, best effort.
