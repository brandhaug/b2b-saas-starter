# Notification Intent Lifecycle

This module owns the provider-neutral Notification Intent aggregate and its monotonic
state machine. Keep the ordered WhatsApp-first/SMS-fallback journey, append-only
Submission Attempts and Provider Evidence, supersession, ambiguity closure, fresh
manual intent limits, and the single Chargeable Delivery decision behind the Effect
service.

- Provider acceptance is not delivery and never charges.
- Submission Unknown is reconciliation-only; never retry or fall back automatically.
- SMS activates only after WhatsApp is ineligible before submission, explicitly
  rejects terminally, or has trusted terminal-delivery-failure evidence.
- Duplicate, old, untrusted, or contradictory evidence must not regress projections.
- Live mutations are fenced by the D1 intent lease; never replace that authority with
  isolate-local coordination.
- Routing and every submission require a fresh eligibility input. Live refreshes
  current Merchant controls, suppressions, channel controls, and template approval;
  producers/executors own current permission and controlled source facts.
- Submission Outcomes and Provider Evidence are append-only facts. Non-capture
  provider responses require environment, provider-account, and source-event identity.
- Transactional email, Platform Webhooks, and the originating Appointment remain
  independent sibling lifecycles.
