# Deliver Booking Disclosure and Merchant Messaging Settings

Type: task
Status: resolved
Blocked by: 18, 21

## Question

Deliver the approved existing Booking App “Get appointment updates by text” policy-sheet flow so supplied mobile number plus affirmative Yes records provider-neutral Operational Messaging Permission, while Skip, transactional email, and marketing permissions remain independent. In the Merchant App, implement Owner-only Settings → Appointment messaging with the Merchant-level control, grouped Send/Don't send controls for confirmation/reschedule/cancellation/reminder, 2/24/48-hour reminder choice, explicit save, RO/EN read-only template previews, and truthful loading, error, disabled, and needs-configuration states. Use narrow Merchant-scoped Notifications contracts, ordinary non-disclosing tenant isolation, responsive 390px behavior, keyboard accessibility, localization, and browser tests without exposing route, provider, raw evidence, or editable template controls.

## Comments

### Resolution — 2026-07-29

Implemented and verified the Booking disclosure and Merchant messaging settings in
commit `e868f21`.

- Booking now records versioned, provider-neutral Operational Messaging Permission
  independently from email Marketing Consent, clears stale permission when Customer
  Details change, and carries current permission into confirmation, cancellation,
  reschedule, and reminder intents.
- Owner-only Merchant Settings now stages and explicitly saves the supported
  provider-neutral controls, exposes read-only RO/EN synthetic template previews,
  and presents truthful loading, error, frozen, and configuration states without
  route, provider, or raw-evidence disclosure.
- Merchant reminder lead time now authoritatively schedules initial and rescheduled
  reminders; the ready state requires the complete approved eight-template set, and
  frozen writes are rejected atomically in the capability.
- Added forward-only D1 permission columns, Seed/Live Effect services, ordinary
  tenant-isolation coverage, responsive browser coverage, keyboard-modal behavior,
  and explicit save-failure retention.

Verification covered focused Booking, Merchant, Notifications, and D1 tests,
monorepo build and lint, React Doctor (Merchant `100`), and final parallel Standards
and Spec reviews with no remaining findings. The repository-wide suite currently
also observes unrelated concurrent Operational Messaging Jobs/Background work; its
failures are outside this ticket's files and focused ticket coverage remains green.
