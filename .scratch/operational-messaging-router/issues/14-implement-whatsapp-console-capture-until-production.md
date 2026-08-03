# Implement WhatsApp Console Capture Until Production

Type: task
Status: resolved
Blocked by: 01, 03

## Question

Implement a provider-light WhatsApp boundary for the currently supported appointment-confirmation outbox flow: development and test must emit a useful structured console representation of the Romanian `appointment_confirmation` template request, mask the destination, redact the Confirmation capability, preserve semantic idempotency and the existing independent email/webhook outcomes, and select an explicit needs-configuration state outside local environments. Do not call Meta or represent console capture as provider delivery; live provider lifecycle, templates, credentials, callbacks, costs, SMS fallback, and qualification remain production-gate work.

## Comments

### Rescope — 2026-07-27

The platform owner replaced immediate live Meta provisioning with console/fake WhatsApp delivery until production. The original live-account work moved to [Provision and Qualify the WhatsApp Production Route](./15-provision-and-qualify-whatsapp-production-route.md), downstream of the implementation-program synthesis. This ticket now owns only the provider-light console capture needed to keep local development moving without inventing production evidence.

### Implementation progress — 2026-07-27

Commit `f8b5a38` adds an Effect `WhatsAppDispatcher` at the Background Worker I/O seam, emits a typed Romanian appointment-confirmation request only in development/test, masks the phone number and redacts the Confirmation link in console output, and selects `needs_configuration` everywhere else. It integrates only the currently implemented appointment-confirmation outbox path; the remaining controlled notification types belong to the later implementation program.

### Resolution — 2026-07-27

Commits `f8b5a38`, `2010b6e`, and `e1a46e0` implement deterministic, redacted WhatsApp console capture for development and test without making Meta API calls. WhatsApp outcome state is durable and independent from email and webhook outcomes; non-local environments select `needs_configuration`, and legacy completed outbox rows are terminally backfilled as `not_applicable`. The slice is intentionally limited to the current appointment-confirmation flow. Live Meta provisioning, template approval, credentials, callbacks, billing, and qualification remain in [Provision and Qualify the WhatsApp Production Route](./15-provision-and-qualify-whatsapp-production-route.md).
