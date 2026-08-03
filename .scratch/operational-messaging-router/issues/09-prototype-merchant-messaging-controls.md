# Prototype Merchant Messaging Controls

Type: prototype
Status: resolved
Blocked by: 04, 05, 06, 07, 08

## Question

What is the smallest coherent Merchant App interaction for opting into messaging, enabling launch notification types, choosing one supported reminder lead time, understanding Romanian and English platform templates, viewing and topping up Messaging Balance, receiving low-balance warnings, seeing concise Appointment delivery status, and creating a fresh manual send from current Appointment state without exposing routes, raw provider data, or a separate message-history center?

## Comments

### Prototype ready for review — 2026-07-28

The throwaway Merchant Messaging Controls prototype, removed after approval, compared four complete interaction models:

- **Guided setup** treats messaging as a four-step onboarding task, then places recovery on the relevant Appointment.
- **Control center** makes settings, balance health, template previews, and an Appointment example branches of one dense messaging surface.
- **Appointment first** keeps the failed delivery and fresh-send recovery beside the Appointment, with compact Settings and Balance views as secondary destinations.
- **Event controls** adapts the platform owner's mobile reference into grouped, full-width Send/Don't send controls, a directly adjacent reminder lead-time selector, and compact destinations for templates, balance, and Appointment delivery status. It deliberately does not reproduce the reference's Email/Phone/Push columns because transactional email is independent, Push is outside launch scope, and provider routing is not Merchant-configurable.

All variants preserve the settled domain boundaries: provider-neutral controls, four launch notification types, one reminder lead time, RO/EN platform-controlled templates, €0.045 excluding VAT per delivered intent, a persistent low-balance warning below €2, masked phone display, concise Appointment status, and a fresh manual intent that leaves the earlier insufficient-balance result intact. The prototype uses in-memory state only and exposes no route choice, provider payload, or global message history.

Type checking and the Merchant production build pass. Desktop and 390px mobile layouts were reviewed in-browser, variant switching persists through `?variant=`, and the top-up-to-fresh-send interaction reaches a new delivered result without browser warnings.

The ticket remains claimed because a prototype is HITL. Resolution requires the platform owner to choose one variant or combine named pieces from them, and to approve or revise the proposed placement of settings, templates, balance transactions, low-balance recovery, and Appointment delivery actions.

### Resolution — 2026-07-28

The Merchant App uses a distributed interaction assembled from **Event controls** for configuration and **Appointment first** for operational status and recovery. Messaging does not become a standalone dashboard, setup wizard, or global message-history center. The approved throwaway prototype and its losing variants are removed after this decision is recorded.

**Settings → Appointment messaging** is the single configuration surface. It has one Merchant-level Operational Messaging control followed by grouped, full-width **Send / Don’t send** controls for confirmation, reschedule, cancellation, and reminder. Reminder alone exposes one adjacent supported lead-time choice—2, 24, or 48 hours before the Appointment—and states the 08:00–20:00 Shop-time delivery window. Several edits are staged locally and committed together through an explicit **Save notification settings** action rather than mutating on every tap.

This settings surface borrows the platform owner's compact mobile reference as an interaction family, not as a channel matrix. It never offers Email, Phone, Push, WhatsApp, SMS, provider, priority, or fallback controls. Existing transactional email remains independent; Push is outside launch scope; WhatsApp-first routing and SMS fallback remain internal. The Merchant-level control and notification-type controls govern eligibility for future work without implying a route choice.

Each supported notification type has a **Preview** action that opens a compact read-only sheet or inline disclosure. The Merchant can switch between Romanian and English platform-controlled examples and see that the copy uses current Appointment facts. The Merchant cannot edit template bodies, fields, links, language selection policy, provider identity, or delivery route. Only the confirmation preview contains the secure Confirmation link.

**Billing → Messaging Balance** owns funding and financial history. It shows exact available EUR credit to three decimals, the €0.045 excluding VAT price per delivered Notification Intent, approximate remaining delivery capacity only as secondary explanatory copy, €10/€25/€50 self-service top-ups, and downloadable append-only balance transactions. Top-up VAT and invoice treatment appear in checkout and financial records rather than in notification controls. There is no automatic-top-up control.

Crossing below €2 creates one persistent **Low Messaging Balance** notice for Owners across the Merchant App, linked directly to Billing, plus the already-settled Owner email. The notice names the available balance and explains that future notifications may be Not Sent; it does not claim an Appointment change failed or expose provider state. It clears only after confirmed funding restores the balance to at least €2. An insufficient-balance result on a specific Appointment remains separately visible there.

The relevant **Appointment detail** owns concise mobile-delivery status inside its existing activity/timeline. It shows only purpose, safe result, time, masked destination where useful, and a short safe explanation. Merchant-facing result language is **Scheduled**, **Sending**, **Delivered**, **Not sent**, **Delivery failed**, or **Under review**; provider acceptance, attempts, raw errors, route order, provider references, and evidence remain hidden. Independent customer email status may be stated separately when it prevents the Merchant from assuming all communication failed.

After **Not sent — insufficient balance**, an authorized Owner or Manager who may modify that Appointment sees a recovery action beside the result. If credit is still insufficient, the primary action is **Top up balance** and returns to the Appointment afterward. Once credit is sufficient, the action is purpose-specific—for example **Send fresh confirmation**—and requires a concise confirmation that it uses the Appointment’s current facts. Success appends a new timeline item for the fresh Notification Intent; the earlier Not Sent result remains immutable and is never presented as replayed. Employees see the masked status but no financial or manual-send action.

The approved arrangement keeps each concern at its natural existing home: configuration in Settings, funding and transactions in Billing, low-balance urgency across the Merchant shell, and delivery/recovery on the Appointment. The settings screen may link to Balance and Appointment examples for orientation, but it does not duplicate their ledgers or histories. Exact production components, server mutations, projections, loading/error states, responsive integration, accessibility tests, and implementation slices belong to **Synthesize and Seed the Implementation Program**; this resolution surfaces no new ticket or map fog.

### Scope amendment — 2026-07-29

The approved interaction is implemented for BeeSolo's Owner only. Any Manager fresh-send action or Employee read-only status variant shown in the historical prototype decision is deferred and must not appear in the BeeSolo launch implementation.
