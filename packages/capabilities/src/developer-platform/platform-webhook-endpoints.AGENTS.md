# Platform Webhook Endpoints

Merchant-scoped developer configuration for Platform API v1 webhook endpoints and safe delivery-attempt history. This capability is separate from the Workspace-era `WebhookEndpoints`, which remains the legacy dashboard/background-worker surface.

## Invariants

- Every operation takes the verified token's `merchantId`; resource lookups always pair it with the opaque endpoint id.
- Only the five Appointment lifecycle event types are accepted. Subscriptions are non-empty and unique.
- Creation and rotation are the only operations that return plaintext signing material. Endpoint and delivery DTOs omit it.
- `disabled` is terminal. Disable is idempotent; patch cannot reactivate or mutate a disabled endpoint.
- Delivery DTOs contain operational metadata only: no payload bodies, Customer Details, secrets, or exception text.
- `validateWebhookUrl` runs during create/patch. Dispatch code must run the same guard immediately before network I/O.
- Lifecycle audits contain endpoint/actor identity only and never signing material.

The API requires `webhooks:manage` and the `developer_config` rate-limit bucket. There is intentionally no get-one, hard-delete, replay, test-delivery, inferred health, wildcard subscription, or re-enable operation.
