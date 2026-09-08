# Workspace outbound webhooks

Workspaces configure outbound endpoints, event subscriptions, and signing secrets through a capability. Provider callbacks remain provider-specific routes; this does not create arbitrary inbound webhook ingestion. Delivery uses [Cloudflare Queues](./0033-cloudflare-queues-for-webhook-delivery.md) and the [shared protocol and evidence model](./0062-webhook-protocol-and-operator-tooling.md).
