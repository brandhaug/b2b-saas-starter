# Webhook Endpoints

## Purpose & Scope

Webhook destinations and tooling; background dispatch uses [`webhook-publisher`](./webhook-publisher.AGENTS.md).

## Entry Points & Contracts

- Creation applies billing's plan ceiling and publishes a best-effort projection without the secret.
- Replay creates an audited `pending` copy linked by `replayedFrom`; the source stays untouched (ADR 0062). Test sends use their delivery row as the record.
- `/admin` calls `listGlobalDeliveries` and `replayDeliveryAsAdmin` without `WorkspaceContext`. Its boundary rechecks the system-admin session; replay resolves the workspace internally and audits the actual actor with `scope: system_admin`. Never fabricate membership. Workspace replay keeps its membership and permission gates.
- Rotation keeps the replaced secret signing for 24h; `activeSigningSecrets` filters expiry lazily.
- Background lookups use `(endpointId, workspaceId)` from the queue. Dispatch targets return all active signing secrets.
- Dead letters record broadcast notifications, worded by `deadLetterNotification`.
- Failure attempts batch the streak with the delivery; auto-disable batches its audit and skips zero matches. The delivery plan owns the counter transition, reaction, and notification copy; the consumer executes them.

## Patterns & Pitfalls

- The state machine lives in `webhook-delivery-plan.ts`. Attempt upserts change attempt state only: payload and replay provenance are insert-only; absent evidence preserves the previous attempt's evidence.
- Global paging uses `(lastAttemptAt DESC, id DESC)`, with null times last in both adapters. Admin replay requires a terminal source and enabled endpoint. Queue failures remain visible after the pending copy commits.
- Signing secrets are plaintext in D1 by design (HMAC needs them back); only `rotateSecret` and `getDispatchTarget` return them.

## Anti-patterns

- No dispatch from a request path, no in-place delivery mutation to replay, no `successRate` recomputed in a route.
- Every mutation's where clause carries `workspaceId`, never the endpoint id alone (regression test in `src/index.test.ts`).

> TODO(intent): keyset paging for deliveries, a per-attempt timeline, `lastDeliveryAt` on the list projection.
