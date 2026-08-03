# Platform Webhook Endpoints

Merchant-scoped developer configuration for Platform API v1 webhook endpoints and safe delivery-attempt history.

## Invariants

- Every operation takes the verified token's `merchantId`; resource lookups always pair it with the opaque endpoint id.
- Only the five Appointment lifecycle event types are accepted. Subscriptions are non-empty and unique.
- Creation and rotation are the only operations that return plaintext signing material. Endpoint and delivery DTOs omit it.
- `disabled` is terminal. Disable is idempotent; patch cannot reactivate or mutate a disabled endpoint.
- Delivery DTOs contain operational metadata only: no payload bodies, Customer Details, secrets, or exception text.
- `validateWebhookUrl` runs during create/patch. Dispatch code must run the same guard immediately before network I/O.
- Lifecycle audits contain endpoint/actor identity only and never signing material.
- Collection cursors are HMAC-signed, expire after 24 hours, and bind the endpoint plus normalized filters while deliberately not binding `limit`.
- Merchant-settings rotation accepts only a password proof no older than 15 minutes; bearer-token rotation remains governed by `webhooks:manage` at the HTTP boundary.

The API requires `webhooks:manage` and the `developer_config` rate-limit bucket. There is intentionally no get-one, hard-delete, replay, test-delivery, inferred health, wildcard subscription, or re-enable operation.
