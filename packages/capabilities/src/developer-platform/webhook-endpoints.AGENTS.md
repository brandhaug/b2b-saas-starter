# Webhook Endpoints

## Purpose & Scope

Workspace-scoped registry of outbound webhook destinations plus a delivery-success ratio computed from recent deliveries. Powers the Webhooks tab in the workspace shell. Read-only today; endpoint creation, updates, and the actual outbound dispatch live in the background worker.

## Public surface

- `WebhookEndpoint` — `{ id, url, enabled, events, successRate }`. `events` is the subscribed event-type array; `successRate` is a 0–100 integer over all known deliveries for the endpoint.
- `WebhookEndpoints.list` — `readonly WebhookEndpoint[]` for the current `WorkspaceContext`.

## Storage

- Tables: `webhookEndpoints` (config) and `webhookDeliveries` (per-attempt log). For each endpoint, the Live layer fetches every delivery row and computes `successRate = round(delivered / total * 100)`. Empty delivery set returns 100.
- The per-endpoint delivery scan is O(N×M) by design — fine for small fleets. Once any workspace has thousands of deliveries, switch to a `count() group by endpointId, status` aggregate.

## Status & follow-ups

- Add `createEndpoint`, `updateEndpoint`, `disableEndpoint`, `rotateSecret` mutators. Each mutation should also emit an `auditEvents` row ([`audit-event-log`](../governance/audit-event-log.AGENTS.md)).
- Add a paginated `listDeliveries(slug, endpointId)` method for the per-endpoint history view.
- Surface `lastDeliveryAt` and `lastFailureReason` once the underlying tables track them.

## Anti-patterns

- Don't dispatch webhooks from a request path. Outbound delivery goes through the Cloudflare Queue (`WEBHOOK_QUEUE`) and is owned by the background worker.
- Don't expose webhook signing secrets through this capability. The DTO intentionally omits the secret column.
- Don't compute `successRate` in the route. It's part of the capability contract so the math stays consistent everywhere.
