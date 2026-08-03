# Integrate Appointment Operational Messaging

Type: task
Status:
Blocked by: 30, 31, 32

## Question

Integrate Appointment-only mobile notification producers and Merchant-facing states with the separately authoritative Operational Messaging Router. Produce provider-neutral Notification Intents only for the settled Appointment events and permissioned destinations; preserve independent email and committed domain work; expose Messaging Balance and fresh-send recovery through the router's capabilities; represent insufficient balance, disabled routing, failed qualification, and needs-configuration truthfully; and consume its €0.045-per-verified-Chargeable-Delivery Rate Card, callbacks, reconciliation, kill switches, and Feature Activation state without forking provider, financial, template, or qualification logic.

## Acceptance criteria

- [ ] Scheduler code depends only on the provider-neutral router contract and contains no parallel SMS price, balance, provider selection, or delivery lifecycle.
- [ ] Mobile remains Appointment-only, permissioned, WhatsApp-first/SMS-fallback, and independently suppressible without affecting required email or domain commits.
- [ ] Insufficient balance terminates before provider submission, creates no ordinary charge, and supports only an explicit authorized fresh send after recovery.
- [ ] Core production can launch with every mobile surface honestly disabled; activation waits for the router map's independent production gate and qualification evidence.
