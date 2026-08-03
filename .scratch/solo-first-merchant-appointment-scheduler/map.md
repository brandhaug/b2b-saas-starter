# Complete the beesolo Merchant Appointment Scheduler

Label: wayfinder:map

## Destination

Produce an implementation-ready specification and dependency-ordered delivery plan for turning the existing Booking App and Merchant App into **beesolo**: a production-ready, Solo-only, single-Shop appointment scheduler for a solopreneur barber or salon professional.

The route is complete when the remaining product, domain, provider, interaction, security, operations, and release decisions are explicit enough to hand to implementation agents without inventing product behavior.

## Notes

- Tracker: local Markdown in `.scratch/solo-first-merchant-appointment-scheduler/`.
- Primary evidence: [Booking and Merchant Appointment Scheduler Gap Analysis](../../docs/research/booking-merchant-appointment-scheduler-gap-analysis.md). Re-check changing provider facts against primary sources when resolving a research ticket.
- Parent context: [Recreate ssqu Booking Product in b2b-saas-starter](../booking-product-recreation/map.md). Its implemented architecture and domain decisions remain valid unless a ticket identifies a concrete incompatibility.
- Mobile delivery context: [Specify and Launch the Operational Messaging Router](../operational-messaging-router/map.md). Its provider-neutral Notifications boundary, €0.045-per-Chargeable-Delivery Messaging Rate Card, Messaging Balance, live-route qualification, and Messaging Launch Gate are authoritative; the scheduler's earlier €0.03-per-accepted-segment rule is superseded.
- Use `wayfinder` for this map, `domain-modeling` whenever terms or invariants change, `grilling` for human product decisions, and `prototype` for interaction decisions requiring a concrete artifact.
- Settled during charting: barbershops and salons are the launch vertical; the primary customer is a solopreneur operating one Shop.
- Settled after charting: launch is Solo-only and the product is named **beesolo**, always lowercase. The Team Plan, multiple Merchant Members, invitations, Manager and Employee roles, optional Member–Provider linkage, per-seat billing, and the Solo-to-Team upgrade path are deferred beyond this destination.
- Settled during charting: the Solo Plan has exactly one Merchant Member—the Owner—who is the Shop's sole active Provider and is automatically eligible for every Service.
- Settled during charting: merchant subscription billing for the Solo Plan is in scope. Customer appointment checkout remains Pay In Person; online appointment payment, deposits, saved cards, payouts, and platform refunds are out of scope.
- Settled during charting: the Owner may manually record an External Collection such as cash or separate-terminal payment, but that record is not a verified platform Payment.
- Settled during charting: customers book as guests. The Merchant owns a merchant-scoped Customer Directory; mandatory Customer Accounts and a general intake-form builder are out of scope. Booking supports one optional customer note.
- Settled by the notification workflow decision: transactional email covers Appointment, Waiting List, and Walk-in lifecycles; mobile is Appointment-only through the authoritative WhatsApp-first/SMS-fallback router. Conversational/two-way messaging and marketing automation are out of scope.
- Settled during charting: merchant-created Appointment Series, the Walk-in Queue, the Waiting List, and basic operational reporting are launch scope. Resources, classes, and capacity-based events are not.
- Settled during charting: preserve the current day-centric responsive schedule. Mobile and desktop use a day ledger, seven-day strip, and month date-picker; Team-oriented week-board expansion and a full month appointment grid are out of scope.
- Settled during charting: Google, Microsoft, and Apple calendar synchronization are deferred.
- Preserve the existing Cloudflare-first topology, D1 authority, Effect v4 capabilities, anonymous capability-protected Booking Sessions, conflict-safe holds, immutable Appointment snapshots, idempotency, optimistic concurrency, transactional outbox, and network-fresh PWA constraints.
- Tickets through Synthesize the Implementation Program were planning-only. The published implementation tickets from Establish the beesolo Release Baseline through Contract Compatibility Scaffolding and Release beesolo explicitly execute that agent-ready graph one tracer bullet at a time.
- Before synthesis, [Remove Deferred Team Implementation](issues/20-remove-deferred-team-implementation.md) was the sole execution exception; that historical exception does not constrain the implementation program published by Synthesize the Implementation Program.

## Decisions so far

<!-- Resolved tickets are indexed here by name. -->

- [Research Merchant Subscription Billing Reuse and Lifecycle Constraints](issues/01-research-merchant-subscription-billing-reuse.md) — Reuse the billing scaffold and provider-boundary patterns, but make a D1 Merchant Subscription entitlement projection authoritative and recover it through durable signed events plus Stripe API reconciliation.
- [Decide Solo and Team Plans and the Merchant Subscription Lifecycle](issues/02-decide-solo-team-plans-and-subscription-lifecycle.md) — Launch the €19 monthly or €190 annual Solo entitlement with explicit trial, grace, restriction, cancellation, and recovery; retain Team decisions only as deferred future design and defer mobile-messaging economics to the later authoritative router decision.
- [Define Merchant Activation and Onboarding](issues/03-define-merchant-activation-and-onboarding.md) — Use a resumable Solo Owner-Provider checklist from atomic Merchant and single-Shop creation through explicit launch readiness, side-effect-free testing, and recovery-safe first publication.
- [Define Provider Scheduling and Availability Controls](issues/05-define-provider-scheduling-and-availability-controls.md) — Derive conflict-safe Availability from explicit civil-time hours, replacing date overrides, exact blocked time, Service buffers, configurable booking windows, and emergency-safe Owner changes while preserving Appointment history.
- [Define Merchant Appointment Operations](issues/06-define-merchant-appointment-operations.md) — Use explicit revisioned, idempotent Owner commands for conflict-safe creation and lifecycle changes, immutable Customer and price snapshots, append-only off-platform collection and history, and deliberate customer consequences.
- [Define Appointment Series Behavior](issues/07-define-appointment-series-behavior.md) — Materialize finite weekly series atomically as independent Appointments, keep later mutations Appointment-scoped, and reserve one explicit atomic action for cancelling every remaining Scheduled member.
- [Prototype the Responsive Merchant Schedule and Composer](issues/08-prototype-responsive-merchant-schedule.md) — Keep Variant A's ledger-first schedule and contextual desktop focus/mobile sheet, borrowing only contextual gap creation and explicit creation choices from the rejected time-rail and command-first variants.
- [Define the Customer Directory and Privacy Contract](issues/09-define-customer-directory-and-privacy.md) — Persist conservative Merchant-scoped Customer Records beside immutable Appointment snapshots, with explicit identity recovery, privacy, retention, contact, import/export, and ban boundaries.
- [Research the Transactional SMS Channel](issues/10-research-transactional-sms-channel.md) — Route Booking through provider-neutral Notifications and require written contract plus live qualification for the outbound-only Romania seed route; its finding that €0.03 segment economics were nonviable prompted the later Rate Card supersession.
- [Define Transactional Notification Workflows](issues/11-define-transactional-notification-workflows.md) — Use system-issued essential email across Appointment, Waiting List, and Walk-in lifecycles, additive permissioned Appointment-only mobile, required timezone-safe reminders, immutable controlled templates, independent durable delivery evidence, and no manual transactional sends or replays.
- [Define Walk-in Queue Operations](issues/12-define-walk-in-queue-operations.md) — Operate one presence-gated FIFO queue with explicit admission, advisory solo-provider estimates, atomic Appointment conversion, protected customer access, and auditable terminal outcomes.
- [Define Waiting List Operations](issues/13-define-waiting-list-operations.md) — Run opt-in, capacity-bounded demand through deterministic FIFO and sequential offers, conflict-safe booking or replacement conversion, protected email-only customer access, audited exceptions, and cohort-safe reporting.
- [Remove Deferred Team Implementation](issues/20-remove-deferred-team-implementation.md) — Contracted beesolo to one Solo entitlement and Owner-Provider across storage, capabilities, Merchant and Booking surfaces, migration guards, fixtures, and parity evidence.
- [Resolve the €0.03 SMS Segment Unit Economics](issues/21-resolve-sms-segment-unit-economics.md) — Supersede segment-based charging with the router's €0.045-per-verified-Chargeable-Delivery Rate Card and provider-neutral Messaging Balance, while gating production SMS on written route qualification and an expected-cost ceiling of €0.036 per delivery.
- [Decide the Launch Integration Boundary](issues/14-decide-launch-integration-boundary.md) — Defer the entire Platform API, API Token, Webhook, and external developer-integration branch; retain only a Confirmation-scoped, privacy-minimal one-way `.ics` Appointment Calendar Export alongside first-party Notifications.
- [Prototype the Merchant Control Plane](issues/15-prototype-merchant-control-plane.md) — Use a searchable Settings index, pre-publication readiness and conditional alerts, and lifecycle guidance only in onboarding; keep operational actions and delivery recovery in their natural source contexts without Team surfaces.
- [Define Merchant Reporting and Export](issues/16-define-merchant-reporting-and-export.md) — Use Shop-local, service-period and activity-period reporting with Owner-only drill-down, separate unverified External Collection facts, cohort-safe queue metrics, delivery-failure visibility, privacy-minimal CSV exports, and explicit retention and error contracts.
- [Decide the beesolo Public Site and Documentation Boundary](issues/19-decide-beesolo-public-site-and-documentation-boundary.md) — Publish a bilingual Solo-product site with merchant Blog and Help content, retire all starter/developer surfaces, permit only a constrained Pricing teaser for future Teams, and enforce legal, metadata, indexing, naming, and regression gates.
- [Define beesolo Privacy Request Operations](issues/22-define-beesolo-privacy-request-operations.md) — Run accountless, exact-destination requests through permissioned revision-bound review, restore-safe correction and erasure, minimized delivery and audit, standing Merchant instructions, and a counsel-approved launch gate.
- [Define Production Release Gates](issues/17-define-production-release-gates.md) — Bind immutable candidates to non-waivable Core evidence and separately gated optional features across journeys, isolation, correctness, providers, accessibility, rollout, recovery, observability, security, and operational readiness.
- [Synthesize the Implementation Program](issues/18-synthesize-implementation-program.md) — Seed eighteen acyclic tracer-bullet tickets from candidate identity and compatible D1 expansion through complete Solo operations, release proof, forward-only contraction, and Core promotion independent from optional mobile activation.
- [Establish the beesolo Release Baseline](issues/23-establish-beesolo-release-baseline.md) — Canonicalize active package identity, inventory every production ingress, bind deterministic Solo fixtures, and install fail-closed parity and immutable candidate-manifest gates while retaining deployed resource names as compatibility facts.
- [Expand D1 for beesolo](issues/24-expand-d1-for-beesolo.md) — Add dormant forward-only Solo subscription, scheduling, Customer, Appointment, privacy, reporting, and migration-evidence foundations with fail-first preflight, database Solo guards, and bounded anti-join backfill recovery while old Workers remain compatible.

## Not yet specified

<!-- No unresolved planning fog remains; the published implementation tickets now own execution. -->

## Out of scope

- Online customer payment during appointment booking, deposits or prepayment, saved cards, marketplace/connected-account routing, payouts, disputes, and platform-executed appointment refunds.
- Multiple Shops, Brands, franchises, cross-location schedules, and cross-location reporting.
- Bookable Resources, rooms, chairs, equipment, classes, group capacity, and attendee enrollment.
- Google Calendar, Microsoft Outlook, Apple Calendar, or other external-calendar synchronization.
- Mandatory Customer Accounts, customer login/dashboard, saved payment methods, and cross-Merchant customer identity.
- A general-purpose intake-form builder, file uploads, medical forms, and e-signature workflows; the booking flow keeps one optional customer note.
- Two-way or inbound SMS and WhatsApp, customer chat, merchant-configurable channel routing or arbitrary WhatsApp content, marketing campaigns, attribution automation, and promotional messaging; the focused Operational Messaging Router's controlled WhatsApp-first transactional route remains in scope.
- Full month appointment grids and wider desktop week-board layouts; beesolo keeps the day-centric schedule across responsive surfaces.
- The Platform API business contract, API Tokens, Webhook Endpoints, Webhook Events, delivery history, replay, signing, secret rotation, external developer credentials, and related Merchant controls are deferred beyond the beesolo launch.
- Custom Merchant Roles, policy builders, SAML SSO, SCIM, and enterprise organization controls.
- Multi-currency, commissions, payroll, packages, memberships, gift-card expansion, loyalty, referrals, advanced tax, and finance reconciliation.
- Offline Merchant App appointment mutations and new realtime transport without a separately proven coordination need.
- [Define Team Membership, Roles, and Provider Linkage](issues/04-define-team-membership-roles-and-provider-linkage.md), the Team Plan, multi-member Merchants, invitations, Manager and Employee roles, optional Member–Provider linkage, per-seat billing, ownership transfer, and Solo-to-Team upgrade or Team-to-Solo downgrade implementation; the resolved design is retained only for a future Team effort.
- Team-oriented Provider administration, employee authorization surfaces, and wider desktop week-board behavior.
