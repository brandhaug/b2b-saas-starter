# Webhook Delivery Admin

## Purpose & Scope

Cross-workspace operator surface for `/admin`: `listGlobalDeliveries` and `replayDeliveryAsAdmin`. Workspace-scoped history and replay are [webhook-deliveries](./webhook-deliveries.AGENTS.md).

## Contracts

- No `WorkspaceContext`. The `/admin` boundary rechecks the system-admin session; replay resolves the workspace from the delivery's endpoint and audits the real admin actor with `scope: system_admin` (`planAdminReplay`). Never fabricate membership.
- Global paging uses `(lastAttemptAt DESC, id DESC)`, null times last in both adapters, through the shared table-filter view (`webhook-delivery-view.ts`). Rows expose no payload or signing secret.
- Admin replay requires a terminal source and an enabled endpoint. Queue failures remain visible after the pending copy commits.
