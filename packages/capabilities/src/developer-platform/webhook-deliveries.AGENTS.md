# Webhook Deliveries

## Purpose & Scope

A workspace's delivery history and operator replay: `listDeliveries`, `inspectDelivery`, `listDeliveryAttempts`, `replayDelivery`. Consumers are the web webhooks page, REST/MCP reads and replay, workspace export snapshots, and investigation tasks. Endpoint management is [webhook-endpoints](./webhook-endpoints.AGENTS.md).

## Contracts

- This contract owns `WebhookDeliveryNotFound` and `DispatchedDelivery`, which `WebhookEndpoints.sendTestEvent` and admin replay also return.
- Every read and the replay source join through the endpoint to `WorkspaceContext`. A foreign delivery id reads as absent: an empty list, or `WebhookDeliveryNotFound`.
- Replay creates an audited `pending` copy linked by `replayedFrom`; the source stays untouched (ADR 0062). `webhook-replay.ts` owns the shared policy; adapters only look up the source and reserve. A caller-supplied `replayDeliveryId` is a stable identity: a duplicate reservation records no second audit row. Queue failures remain visible after the pending copy commits.
- Delivery summaries are newest first by `(lastAttemptAt, id)`, capped at `DELIVERIES_PAGE_SIZE`. Callers that read every endpoint's history bound fan-out with `WEBHOOK_DELIVERY_READ_CONCURRENCY`.
- Attempts return in attempt order, joined through delivery and endpoint for ownership.
