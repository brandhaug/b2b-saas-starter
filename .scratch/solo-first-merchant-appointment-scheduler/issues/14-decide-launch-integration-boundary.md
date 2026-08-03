# Decide the Launch Integration Boundary

Type: grilling
Status: resolved
Blocked by:

## Question

Which parts of the existing merchant-scoped Platform API, API Token lifecycle, Webhook Endpoint management, event catalog, delivery history, replay, signing, secret rotation, and ICS add-to-calendar behavior belong in this scheduler release, and which integration promises should remain disabled or deferred alongside external-calendar synchronization and customer booking writes?

## Comments

### Resolution — 2026-07-31

BeeSolo does not ship a Platform API or an external developer-integration promise at launch.

The entire existing Platform API branch is deferred: no `/v1` business routes, OpenAPI or Scalar contract, API Token bootstrap/list/create/revoke or delegation, Webhook Endpoint management, event catalog, delivery history, manual replay, test delivery, signing, secret rotation, or external integration credentials. The Merchant App does not show disabled or “coming soon” API controls. If the API Worker remains operationally present, it exposes only non-business health or internal plumbing; it does not publish a disabled public contract.

Platform Webhook Events and Webhook Delivery Attempts remain distinct from first-party Notifications. Transactional email and SMS for Appointment, Walk-in Queue, and Waiting List lifecycles remain launch behavior through the Notifications capability; external Webhook delivery does not.

The only launch integration-style convenience is the Appointment Calendar Export. From an already-authorized Confirmation view, a customer may download one generated `.ics` file. It is a snapshot: a reschedule or cancellation does not update an imported calendar entry, and the customer must download a fresh current export. There is no standalone public download URL, persisted calendar artifact, subscription URL, provider-specific Google/Yahoo link, external-calendar synchronization, or accepted external calendar change.

The export contains the Service name or names, Merchant public name, exact UTC start and end, `CONFIRMED` status, a stable opaque UID, and the public Shop Address when available. It contains no Customer Details, customer note, price, confirmation URL or secret, or internal identifier. External-calendar synchronization, inbound calendar changes, and customer or Merchant booking-write APIs remain out of scope.
