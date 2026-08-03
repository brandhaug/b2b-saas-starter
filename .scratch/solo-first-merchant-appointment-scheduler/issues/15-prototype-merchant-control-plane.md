# Prototype the Merchant Control Plane

Type: prototype
Status: resolved
Blocked by: 02, 03, 05, 11, 12, 13, 14, 20

## Question

What BeeSolo Merchant App information architecture and responsive settings interactions make Solo subscription status, onboarding readiness, the Owner-Provider profile, Services, schedules and exceptions, Booking Policies, notifications, Walk-in Queue, Waiting List, Customer privacy, External Collections, and selected integrations discoverable and safely operable without exposing deferred Team concepts?

## Comments

### Prototype ready for review — 2026-07-31

The throwaway Merchant Control Plane prototype is mounted inside the existing authenticated `/settings` route and Merchant shell. Run `bun run dev:merchant`, then compare:

- `http://localhost:3072/settings?variant=A` — **Readiness home**: publication, activation, subscription and urgent health lead; domain controls follow in compact Settings groups.
- `http://localhost:3072/settings?variant=B` — **Shop lifecycle**: controls follow the customer journey from becoming bookable through availability, daily demand and customer follow-through.
- `http://localhost:3072/settings?variant=C` — **Settings index**: a compact searchable control index with persistent Booking and Solo status plus domain-grouped rows.

The floating arrows and keyboard Left/Right switch variants through the shareable `?variant=` URL. Each option uses BeeSolo's existing Onest typography, semantic color tokens, muted Settings groups, rounded mobile sheet, 32rem desktop modal and real desktop secondary sidecar. Mobile opens an in-memory push-in detail and always starts each detail or newly selected variant at the top. All edits, toggles, warnings, top-ups, queue admission and publication actions are fixtures and visibly marked as unsaved prototype behavior.

Every variant reaches the same concrete controls: completed activation/readiness, one Owner professional profile, Services, Weekly Working Hours, Date Exceptions, Blocked Time, impact-previewed schedule changes, Booking Policies, independent email and provider-neutral mobile messaging, Walk-in Enrollment, Waiting List Admission and demand state, Customer Directory privacy tools, Appointment-scoped append-only External Collections, the immutable Solo subscription and the privacy-minimal one-way `.ics` customer calendar file. No Team plan, seat, invitation, Merchant role, additional Provider, Provider selector, connected calendar, Platform API or Webhook control appears.

Temporary prototype assets (removed after the human verdict was captured):

- `apps/merchant/src/features/control-plane/prototype/merchant-control-plane-prototype.tsx`
- `apps/merchant/src/routes/settings.tsx` development-only mount

Focused formatting, lint, Merchant type checking and `git diff --check` pass. Desktop at 1440×900 and mobile at 390×844 were reviewed in the local app across all three variants, including desktop sidecars, mobile detail navigation, safe publication confirmation, settings search, keyboard focus handling and variant scroll restoration. The browser reported only the pre-existing TanStack route-export warning from `settings.appointment-messaging.tsx`.

Human verdict prompt at review time: choose the strongest base information architecture and identify any pieces to borrow from the other two. In particular, decide whether External Collections and the customer calendar file deserve index rows for discoverability or should remain reachable only from their natural Appointment and Confirmation contexts.

The ticket remains claimed and cannot be resolved yet: [Define Transactional Notification Workflows](11-define-transactional-notification-workflows.md) is still an open blocker, so exact email/mobile wording, retry and delivery-recovery behavior in this prototype is explicitly provisional.

### Human verdict — 2026-07-31

Approved direction: **Settings index as the base, Readiness home for readiness and alerts, and Shop lifecycle only for onboarding guidance.**

- Use the compact, searchable Settings index as the persistent Merchant control plane.
- Before publication, lead with a readiness card. After launch, collapse readiness into compact status indicators and show a prominent “Needs attention” banner only when the Merchant Owner must act.
- Keep lifecycle ordering and explanatory language in onboarding instead of making it the permanent Settings navigation.
- Put External Collections on Appointment detail; expose summaries or exports from their natural reporting context rather than as a standalone Settings destination.
- Keep Walk-in Queue and Waiting List operations on their operating screens, with only their durable configuration in Settings.
- Keep messaging configuration in Settings, messaging balance and spend in Billing, and delivery failure recovery on Appointment detail.
- Keep the one-way customer `.ics` calendar file under Booking Policies and the booking-confirmation context, not as a standalone integration.
- Name the Solo identity destination **Your professional profile**. Do not introduce plural Providers, seats, members, roles, invitations, or other Team concepts.

This captures the human answer, so the throwaway prototype and its development-only route mount were deleted. At the time of this verdict, the ticket remained claimed because [Define Transactional Notification Workflows](11-define-transactional-notification-workflows.md) was still open and its exact delivery and recovery rules had to be reconciled before resolution.

### Resolution — 2026-08-01

Adopt the compact, searchable **Settings index** as BeeSolo's persistent Merchant control plane. Before first publication, lead with the **Readiness home** checklist; after launch, reduce it to compact status and show a prominent conditional alert only when the Merchant Owner must act. Use **Shop lifecycle** ordering and explanatory language only inside onboarding.

Keep operations where their consequences are visible: External Collections and notification delivery recovery on Appointment detail, Walk-in Queue and Waiting List operations on their operating screens, and only durable policy controls in Settings. Keep Messaging Balance and spend in Billing. Place the one-way customer `.ics` file under Booking Policies and the booking-confirmation context. Name the Solo identity destination **Your professional profile** and expose no plural Provider, member, seat, role, invitation, or other Team surface.

[Define Transactional Notification Workflows](11-define-transactional-notification-workflows.md) is now resolved and does not materially change this structure. It narrows the notification controls as follows:

- Settings exposes Notification Readiness, the required 2/24/48-hour Reminder policy, relevant Shop language defaults, and persistent degraded configuration state—not a Merchant-selectable event matrix, template editor, customer channel chooser, manual send/replay control, or global message center.
- Appointment detail owns its source-local delivery timeline, **Customer email needs attention** state, destination-correction recovery, and Appointment-specific mobile permission. It offers no resend action.
- Walk-in Queue and Waiting List remain email-only and surface their workflow-local status in their natural operating contexts; launch mobile messaging remains Appointment-only.
- Known disabled or unconfigured transactional email appears as a readiness failure that pauses new public demand while preserving Published intent. Mobile never substitutes for email readiness.

All declared blockers are resolved, the human verdict is captured, and no new investigation ticket or fog item is required.
