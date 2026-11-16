# Webhook Endpoints

## Purpose & Scope

Workspace endpoint management for the settings page, REST and MCP: list, create, update, delete, rotate secret, send a test event. Its siblings split the rest by consumer:

| Service                | Consumer                                     | Intent node                                                  |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `WebhookDeliveries`    | Workspace history and replay (web, REST/MCP) | [webhook-deliveries](./webhook-deliveries.AGENTS.md)         |
| `WebhookDeliveryAdmin` | `/admin` cross-workspace reads and replay    | [webhook-delivery-admin](./webhook-delivery-admin.AGENTS.md) |
| `WebhookDispatch`      | `apps/background` queue execution            | [webhook-dispatch](./webhook-dispatch.AGENTS.md)             |

Background fan-out is [`webhook-publisher`](./webhook-publisher.AGENTS.md); age-based cleanup of delivery history is [retention](../governance/retention.AGENTS.md).

## Entry Points & Contracts

- [Resource entitlements](../../../billing/src/resource-entitlements.AGENTS.md) owns creation admission; creation publishes a best-effort projection without the secret.
- `webhook-delivery-plan.ts` owns the delivery status machine (ADR 0077) for all four services: the transition map, the dispatchable/terminal/replayable/settled predicate sets, the single-status names adapters compose SQL from, and the failure-ladder counter transitions. Adapters never write a status literal inline.
- Test sends use their delivery row as the record; no audit event.
- Signing secrets are plaintext in D1 by design (HMAC needs them back); only `rotateSecret` here and `WebhookDispatch.getDispatchTarget` return them.

## Shared storage

- The services share tables, not code paths. Live adapters build on `webhook-storage.live.ts` (workspace-scoped endpoint reads, the success-rate aggregate, the operator dispatch reservation). Seed adapters share one `SeedWebhookStore` (`webhook-store.seed.ts`); `SeedWebhooks` (`webhooks.seed.ts`) builds all four over one store, so a write through one service is what the others read.
- Seed `delete` cascades the same two hops the foreign keys do: deliveries with the endpoint, attempts with their delivery.

## Anti-patterns

- No dispatch from a request path, no `successRate` recomputed in a route.
- Every mutation's where clause carries `workspaceId`, never the endpoint id alone.
- The list projection carries no `lastDeliveryAt`: callers that need the latest attempt time read `WebhookDeliveries.listDeliveries`.
