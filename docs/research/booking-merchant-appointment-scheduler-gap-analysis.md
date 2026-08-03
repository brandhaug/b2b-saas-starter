# Booking and Merchant App appointment-scheduler gap analysis

Research date: 2026-07-27  
Repository state: `master` at `eaaf311`, including the uncommitted Merchant App
presentation changes present during the audit. Those changes were inspected but not
modified.  
Scope: customer Booking App, authenticated Merchant App, supporting capabilities,
D1 model, Platform API, notifications, payments, and verification. The Operations
App is considered only where it affects merchant administration or audit.

> **BeeSolo scope update — 2026-07-29:** launch is now Solo-only: one Merchant, one Shop, one Owner, and one active Owner-Provider. Team membership, staff roles, additional Providers, Team billing, Team upgrade paths, and Team-oriented calendar layouts are deferred. Historical evidence below may describe implemented Team-capable seams, but they are not launch work.

## Executive conclusion

This is no longer merely a booking prototype. The repository has strong scheduling
and transaction foundations: provider/service selection, Any Provider assignment,
additional services, conflict-safe holds, composite Booking Parties, immutable
quotes, online payment reconciliation, gift cards, cancellation/refund obligations,
rescheduling, waiting-list offers, walk-ins, optional customer identity, localized
routes, and durable confirmation delivery all have meaningful implementation and
test evidence.

The largest remaining gap is the **merchant operating loop**, not the customer
booking algorithm. A customer can complete sophisticated paths that a merchant
cannot yet configure or operate from the Merchant App. Most importantly:

1. The polished New Appointment composer never submits a command. “Save appointment”
   has no click or submit handler.
2. Merchant appointment projections are intentionally read-only. The merchant cannot
   edit, reassign, reschedule, cancel, complete, mark no-show, or take payment from the
   appointment detail screen.
3. “Block time” is an exposed creation intent with no corresponding workflow or
   persisted availability exception.
4. Recurrence, appointment notes, customer notes, and Notify Customer currently live
   only in the unsaved appointment draft.
5. Cancellation/reschedule/reminder Notification Intents and Scheduled Work can be
   recorded, but the Background Worker only delivers the existing confirmation
   outbox and hard-codes `appointment.created` webhooks. Due reminders and the other
   lifecycle notifications are not claimed and delivered.
6. Payments use one deployment-level Stripe secret and hosted checkout. There is no
   per-Merchant payment onboarding, connected-account routing, payouts, disputes, or
   merchant payment/refund administration.
7. Advanced domains exist below the UI, but merchants lack control planes for Shops,
   Brands, checkout/cancellation policies, promotions, payment settings, gift-card
   products and ledgers, waiting-list rules/offers, notification templates, and most
   integration management.

The recommended strategy is therefore: **finish the merchant command path and
operational delivery before adding more customer-facing breadth**.

## Audit method and confidence

The audit used four evidence levels:

1. **End-to-end surface:** a customer or merchant route calls a live capability and
   exposes the outcome.
2. **Live capability:** production D1 adapters and transport wiring exist, with
   behavioral tests.
3. **Foundation only:** schema, types, adapters, or presentation exist without a
   complete operating workflow.
4. **Missing:** no credible implementation was found.

Repository evidence was taken from source, intent nodes, tests, the parity manifest,
and recent commit history. The external baseline uses only first-party product docs,
API docs, and standards from Square, Calendly, Cal.com, Acuity, Stripe, Google,
Microsoft, W3C, RFC Editor, and EU/EDPB sources.

Verification run during this audit:

| Check                             | Result                                           |
| --------------------------------- | ------------------------------------------------ |
| Full-parity ledger structure      | Pass; 163/163 entries assigned                   |
| Ledger delivery status            | 16 verified, 15 implemented, **132 planned**     |
| Booking App Vitest                | 44 files, 223 tests passed                       |
| Capability Vitest                 | 57 files, 282 tests passed; 83.11% line coverage |
| Merchant App Vitest               | 75 files, 270 tests passed when run alone        |
| Focused Merchant navigation retry | 4/4 passed                                       |
| `git diff --check`                | Pass                                             |

The first concurrent Merchant test run had one five-second import timeout; the full
suite and focused test passed when rerun without the other large suites competing for
resources. `bun test` is not the repository test command and was not used as release
evidence; this repo's supported runner is `bun run test`/Vitest.

The structural parity check is easy to overread. Its PASS means every inventory item
has an owner; it does not mean every item ships. The generated report still shows 132
planned entries ([parity report](../generated/full-parity-coverage.md)). Conversely,
the ledger is behind several July implementations, so it is not a reliable feature
status dashboard without reconciliation.

## Current capability scorecard

| Product area                  | Current evidence                                                                                                               | Maturity                                 | What remains                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Merchant onboarding/auth      | Verified Owner auth, email verification, onboarding, and existing Solo/Team presentation seams                                 | End-to-end for one Owner                 | BeeSolo Solo entitlement controls and Owner recovery; Team presentation, invitations, staff accounts, and roles are deferred                |
| Services and Providers        | CRUD, active/inactive state, service/provider eligibility, price, duration, description/category                               | End-to-end basic catalog                 | Variations, per-provider duration/price, buffers/gap time, capacity, resources, richer media, deletion/archive UX                           |
| Availability                  | IANA Merchant/Shop timezone, weekly rules, derived slots, appointment/hold conflicts, 60-day horizon                           | End-to-end basic scheduling              | Date overrides, breaks, time off, blocks, holidays, lead time, booking windows/caps, customer timezone controls, external busy time         |
| Public booking                | Published public page, Shop/Provider/Service routes, Any/Specific Provider, additional services, widget/Google embedding modes | End-to-end core                          | Merchant customization, custom domains, complete iframe contract, configurable intake questions, route recovery/visual matrix closure       |
| Booking correctness           | Capability-protected sessions, optimistic versions, atomic group holds, idempotent all-or-none confirmation                    | Strong live foundation                   | Merchant-side override rules, systematic production E2E, operational inspection of failed/processing states                                 |
| Group booking                 | Ordered Booking Requests, assigned and Any Provider requests, atomic holds/confirmation                                        | Customer path implemented/tested         | Merchant controls, recurring group sessions, capacity/class attendee model, attendee management                                             |
| Pricing/policies              | Immutable quotes, tax/fees/tips adjustment model, promotions, acceptance, marketing consent                                    | Live capability and Booking UI           | Merchant configuration, jurisdictional tax ownership, discounts UI, manual overrides with audit                                             |
| Pay In Person                 | Provider-free checkout and confirmation                                                                                        | End-to-end                               | Merchant collection/settlement status and post-service payment recording                                                                    |
| Online payment                | Stripe hosted checkout, cards/wallets/BNPL eligibility, idempotent attempts and webhook reconciliation                         | Customer path implemented                | Per-Merchant onboarding/routing, deposits, saved-card/no-show charges, refunds UI, receipts, tips, disputes, payouts/reconciliation         |
| Gift cards                    | Purchase, issuance, receipt protection, redemption, mixed settlement                                                           | Customer path and live capability        | Merchant product setup, search/balance/void/refund admin, accounting/reporting, customer delivery workflows                                 |
| Cancellation/refunds          | Protected individual/whole-party cancellation, refund obligations, history                                                     | Customer path implemented/tested         | Merchant actions/UI, provider refund executor and reconciliation dashboard, configurable policies, lifecycle delivery                       |
| Rescheduling                  | Protected replacement session, atomic swap, price consequence/refund facts, stale-reminder invalidation                        | Customer path implemented/tested         | Merchant action/UI, external-calendar sync, actual reminder delivery, richer policy and exception handling                                  |
| Waiting list                  | Application, withdrawal, purpose-bound sequential offers, acceptance/decline/expiry                                            | Customer path and live capability        | Merchant dashboard/configuration, opening detection/automation, candidate ranking controls, delivery worker, reporting                      |
| Walk-ins                      | Customer enrollment/status and authenticated merchant queue transitions                                                        | End-to-end advanced slice                | Merchant queue configuration UI, notifications, capacity/staff assignment, reporting                                                        |
| Customer identity/CRM         | Anonymous booking, optional identity/continuation capability, snapshot-derived directory                                       | Foundation/customer continuation partial | Reachable sign-in/create-account UI, durable merchant-scoped customer profiles, merge/notes/tags/forms/files/history, export/delete/ban     |
| Notifications                 | Confirmation email, durable retrying outbox, signed PII-free `appointment.created` webhooks                                    | End-to-end for creation only             | Reminders, cancellation/reschedule/no-show/completion delivery, SMS, templates, workflows, staff notifications, delivery dashboard          |
| Platform API/webhooks         | Merchant/service/provider/appointment reads; token and webhook endpoint management APIs; delivery history                      | Strong read-and-notify API               | Booking/availability write API if strategically needed, broader event production, replay tooling, complete Merchant UI for tokens/endpoints |
| Merchant appointment calendar | Timezone-correct day view, provider grouping, immutable detail snapshots                                                       | Read-only                                | Manual create/save, blocks, edit/reassign/reschedule/cancel/status, drag/drop, week/month/resource views, search/filter                     |
| Merchant customer directory   | One Customer Details row per Appointment                                                                                       | Read-only projection                     | Durable CRM behavior and privacy tooling                                                                                                    |
| Multi-location                | Brand/Shop/address/resource tables, Shop topology and customer route resolution                                                | Foundation/customer routing              | Merchant CRUD, inheritance/config precedence UI, location schedules/staff/services/payments/reporting                                       |
| Reporting/analytics           | No merchant product reporting found; optional checkout telemetry adapter only                                                  | Missing                                  | Volume/status, no-show/cancellation, revenue/refunds, utilization, staff/service/location, funnel, waitlist, CSV export                     |
| Resources/classes             | No room/equipment capacity model or class/event enrollment aggregate found                                                     | Missing                                  | Resource pools, capacities, class series, attendee-level lifecycle and payments                                                             |

The current route list reinforces the imbalance. Merchant navigation contains only
Appointments, Walk-ins, Customers, Services, Providers, Availability, and Settings
([navigation](../../apps/merchant/src/components/merchant-shell/navigation.tsx)).
Appointment detail explicitly describes itself as inspect-only
([route](../../apps/merchant/src/routes/appointments.$appointmentId.tsx#L37-L42)),
and the owning capability explicitly forbids mutations
([intent node](../../packages/capabilities/src/booking/appointment-operations.AGENTS.md)).

## Highest-priority remaining work

### P0 — make the existing product operable

These are release blockers for a credible BeeSolo appointment scheduler.

#### P0.1 Persist merchant-created appointments

Build one merchant-authorized command that takes the existing composer draft and
creates an Appointment without bypassing scheduling, quote, lifecycle, audit, and
notification invariants.

It must support:

- existing or newly entered Customer Details;
- Provider, Service, date/time, duration, notes, and Notify Customer;
- conflict revalidation with an explicit authorized override path, not silent double
  booking;
- idempotency and optimistic versioning;
- recurrence as either a deliberate series aggregate or a bounded batch with partial
  failure rules;
- one audit entry and one versioned notification intent per committed result;
- immediate appearance in the Merchant calendar and customer history.

Current smoking-gun evidence: the button becomes enabled, but it has no action
handler ([composer](../../apps/merchant/src/components/merchant-shell/mobile/mobile-new-appointment-sheet.tsx#L1020-L1029)).

#### P0.2 Implement block time and availability exceptions

Weekly hours alone are not enough to run a business. Add a schedule-exception model
and Merchant App workflow for:

- one-off working-hour overrides;
- time off, breaks, holidays, and manual busy blocks;
- whole-provider, whole-Shop, and optionally service/resource scope;
- reason, visibility, recurrence, source, and audit metadata;
- conflict behavior for existing appointments;
- DST-safe wall-time semantics.

The current schedule input is only weekday/start/end
([scheduling contract](../../packages/capabilities/src/scheduling/scheduling.ts#L25-L46)).
Square, Calendly, and Acuity all treat service buffers, blocks, date-specific hours,
notice, and booking limits as core availability controls
([Square services](https://squareup.com/help/us/en/article/6487-create-a-service-from-the-square-appointments-app),
[Calendly rules](https://help.calendly.com/hc/en-us/articles/1500004754122-Managing-additional-rules-for-your-availability),
[Acuity availability](https://help.acuityscheduling.com/hc/en-us/articles/16676883635725-Managing-availability-and-calendars)).

#### P0.3 Complete the merchant appointment lifecycle

Add actions from day view and detail for:

- edit Customer Details, notes, services, Provider, and duration;
- reassign and reschedule through the existing replacement invariants;
- cancel one Appointment or an explicit party scope;
- mark completed or no-show;
- record collection/payment state and initiate permitted refunds;
- show lifecycle, payment, notification, and audit timelines.

Every command needs a revision/precondition so a stale calendar tab cannot overwrite
a customer cancellation or another staff edit. Square likewise exposes idempotency
and revision-based concurrency in booking creation/update
([Create Booking](https://developer.squareup.com/reference/square/bookings/create-booking),
[Booking object](https://developer.squareup.com/reference/square/objects/Booking)).

#### P0.4 Turn Notification Intents and Scheduled Work into a delivery engine

Implement a due-work claimer and delivery state machine for:

- confirmation, reschedule, cancellation, reminder, follow-up, no-show, completion,
  waiting-list offer, and walk-in events;
- customer and staff recipients;
- email first, with SMS as a later channel;
- version-aware cancellation of stale reminders;
- retries, dead-letter inspection, replay, delivery history, and template/timezone
  rendering.

The current Scheduled Work service can only `findById`
([contract](../../packages/capabilities/src/scheduled-work/index.ts#L27-L39),
[live adapter](../../packages/capabilities/src/scheduled-work/adapters.ts#L21-L58)).
The active booking webhook sender hard-codes `appointment.created`
([worker](../../apps/background/src/booking-notifications.ts#L227-L245)), even though
the endpoint contract advertises updated/cancelled/completed/no-show events
([events](../../packages/capabilities/src/developer-platform/platform-webhook-endpoints.ts#L18-L25)).
Calendly and Acuity provide lifecycle-triggered reminder/follow-up workflows and
delivery history, establishing the expected operational baseline
([Calendly Workflows](https://help.calendly.com/hc/en-us/articles/360051017814-Automate-tasks-with-Workflows),
[Acuity notifications](https://help.acuityscheduling.com/hc/en-us/articles/28110776461709-Managing-Acuity-notifications)).

#### P0.5 Productize the settings/control plane

Expose authenticated management for the advanced capabilities already in code:

- Merchant/Brand/Shop identity, timezone, address, currency, and public booking
  presentation;
- booking horizon, minimum notice, buffers, cancellation/no-show/refund policy;
- payment availability and collection policy;
- pricing/tax/fees/tips, promotion rules, and checkout policy;
- gift-card products and balances;
- waiting-list and walk-in rules;
- notification templates/timing;
- token list/revoke and webhook endpoint CRUD/delivery history.

The current Advanced Settings UI only bootstraps one token and rotates a secret when
the operator already knows an endpoint ID
([settings](../../apps/merchant/src/components/merchant-advanced-settings.tsx#L6-L95)).
The underlying API is much richer, including token list/create/revoke and endpoint
list/create/patch/disable/rotate/delivery history
([API](../../packages/api/src/index.ts#L202-L340)).

#### P0.6 Decide and implement the Merchant payment account model

If online payments are enabled for multiple independent Merchants, the current global
Stripe configuration is not a finished marketplace design. Hosted checkout uses the
deployment secret directly and does not select a connected account
([Stripe adapter](../../apps/booking/src/lib/stripe-payment-provider.ts#L146-L169),
[deployment](../../alchemy.run.ts#L222-L247)).

The product must explicitly choose one of:

1. **Platform is merchant of record:** platform owns collection, tax/liability,
   refunds, payouts, disputes, statements, and onboarding terms.
2. **Merchant is payment merchant:** use per-Merchant connected accounts and route
   charges, application fees, refunds, disputes, and payouts accordingly.
3. **No online money for initial Solo release:** ship Pay In Person and keep payment
   modules disabled until this decision is complete.

Add payment onboarding/status, deposits or full prepay, saved-card/no-show policy if
required, refund execution/reconciliation, receipts, payout/dispute visibility, and
failure recovery. Stripe documents that Connect dispute liability depends on the
charge model and that refunds are asynchronous financial operations, not merely a
booking-state transition
([Connect disputes](https://docs.stripe.com/connect/disputes),
[refunds](https://docs.stripe.com/refunds)).

#### P0.7 Close release verification and operational visibility

- Reconcile the parity ledger with actual shipped work; do not leave implemented
  journeys marked planned.
- Add real production-ingress E2E journeys for create/book/pay/cancel/reschedule and
  Merchant App create/edit/status operations. The current Web Playwright smoke file
  validates public pages, PWA ingress, and retired routes, not a completed booking
  ([smoke](../../apps/web/e2e/smoke.spec.ts)).
- Run the named parity scenarios in CI and publish which profiles actually pass.
- Add due-work/refund/payment/webhook operational dashboards, structured alerts, and
  replay/runbooks.
- Treat WCAG 2.2 AA as a release target for the complete booking process, including
  keyboard use, 200% zoom/reflow, target sizes, errors, status messages, and
  accessible authentication ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)).

### P1 — operational completeness and competitive baseline

#### P1.1 Customer CRM, intake, and privacy operations

Replace the appointment-snapshot directory with an explicit Merchant Customer
relationship while preserving immutable Appointment Customer Details. Add search,
history, notes, tags, custom fields, intake forms/agreements, merge suggestions,
import/export, delete/ban, consent history, and retention policy. Customer accounts
should remain optional.

The current route explicitly emits one row per Appointment and does not merge matching
contacts ([customers](../../apps/merchant/src/routes/customers.tsx#L17-L28)). Square
and Acuity both expose customer history, notes/custom fields, merge and deletion;
Acuity also associates intake responses and agreements
([Square Customers API](https://developer.squareup.com/docs/customers),
[Acuity client list](https://help.acuityscheduling.com/hc/en-us/articles/16676896712589-Managing-your-client-list-in-Acuity-Scheduling),
[Acuity forms](https://help.acuityscheduling.com/hc/en-us/articles/16676931038093-Client-intake-forms-and-agreements-in-Acuity-Scheduling)).

The Booking menu's email/Apple/Google/create-account/manage-choices buttons are still
disabled, so optional identity is not a complete customer feature
([menu](../../apps/booking/src/components/booking-widget-menu.tsx#L435-L503)). Add a
customer dashboard for upcoming/past appointments, purpose-bound access recovery,
profile/consent controls, and data export/deletion.

#### P1.2 External calendar integration

Add Google Calendar first or Microsoft first based on the launch segment, then the
other. Required semantics include:

- selected conflict calendars and one destination calendar per Provider;
- free/busy ingestion and Booking-created event ownership;
- create/update/delete propagation and external-edit conflict policy;
- incremental sync tokens, channel renewal, disconnect/reconnect, full-resync recovery,
  and health visibility;
- recurring event and DST correctness;
- source/revision metadata so calendar webhooks are signals, not truth.

Google and Microsoft both provide multi-calendar free/busy APIs
([Google freebusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query),
[Microsoft getSchedule](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0)).
Google warns that push delivery is not guaranteed and sync tokens can expire, which
requires renewal/full resync logic
([push](https://developers.google.com/workspace/calendar/api/guides/push),
[sync](https://developers.google.com/workspace/calendar/api/guides/sync)).

#### Deferred — Staff access, permissions, and audit

Do not introduce this for BeeSolo launch. A future Team effort may introduce Merchant Members separately from Providers, invite/revoke flows, and at
least Owner/Admin/Staff roles. Scope staff to Shop, Provider/calendar, customer,
payment, reporting, and settings permissions. Record actor, source, before/after
version, policy decision, and result for every mutation. Keep Provider identity and
bookability separate from login authority.

Cal.com exposes organization/team roles, optional fine-grained policy controls, and
booking/security audit history
([access control](https://cal.com/docs/api-reference/v2/access-control),
[audit logs](https://cal.com/help/enterprise/audit-logs)). SSO/SCIM can remain P2.

#### P1.4 Resources, capacity, and classes

Model finite rooms, chairs, equipment, vehicles, or other resources independently of
Providers. Then add class/event series with capacity, attendee enrollment, per-attendee
cancel/no-show, series exceptions, and payment/refund rules.

The existing Booking Party coordinates multiple guest appointments; it is not the same
as multiple attendees consuming seats in one class. Square and Acuity both support
resource pools and capacity-based group classes
([Square resources](https://squareup.com/help/us/en/article/7065-square-appointments-resource-management),
[Square classes](https://squareup.com/help/us/en/article/7991-class-booking-with-square-appointments),
[Acuity resources](https://help.acuityscheduling.com/hc/en-us/articles/16676949567757-Using-resources-to-limit-bookings),
[Acuity classes](https://help.acuityscheduling.com/hc/en-us/articles/16676883946253-Creating-and-editing-group-classes)).

#### P1.5 Merchant dashboards and reporting

Start with operationally actionable reports:

- appointment volume by status, service, Provider, and Shop;
- cancellations, no-shows, lead time, and rebooking;
- available versus booked minutes and utilization;
- gross/collected/refunded/outstanding amounts and payment exceptions;
- waiting-list offers/conversion and walk-in wait/service time;
- notification delivery failures;
- CSV export with timezone and currency made explicit.

Square reports retention, pre-booking and schedule utilization; Acuity reports
appointments, revenue, staff, intake answers, add-ons and tips with filters/export
([Square reports](https://squareup.com/help/us/en/article/7904-square-appointments-reporting),
[Acuity reports](https://help.acuityscheduling.com/hc/en-us/articles/16676901157389-Generating-reports)).

#### P1.6 Broaden integrations intentionally

- Produce every advertised appointment webhook event, plus payment/refund, waiting-list,
  walk-in, and customer events where justified.
- Add replay-safe signatures, delivery replay, secret rotation overlap, endpoint test,
  and event schema/version documentation.
- Add availability/booking write APIs only if partners genuinely need them; protect
  them with idempotency, revisions, exact scopes, and the same domain commands as the
  first-party app.
- Support ICS add-to-calendar links before promising full two-way synchronization.

Cal.com's API surface covers slots, schedules, bookings, event types, organizations,
and signed webhooks with granular access control
([API](https://cal.com/docs/api-reference/v2/introduction)).

### P2 — growth and enterprise differentiation

- Weighted round robin, least-recently-booked allocation, collective/multi-provider
  appointments, routing forms, and CRM-based routing
  ([Cal.com round robin](https://cal.com/help/event-types/round-robin),
  [collective events](https://cal.com/help/event-types/collective-events)).
- Packages, appointment credits, memberships/subscriptions, loyalty, coupons, and
  referral programs. Use an immutable redemption ledger, not a discount shortcut
  ([Acuity packages/subscriptions](https://help.acuityscheduling.com/hc/en-us/articles/16676947677325-Packages-gift-certificates-and-subscriptions-overview)).
- Tips, commissions, payroll exports, multi-currency, advanced tax, payout forecasting,
  chargeback/dispute tooling, and finance reconciliation.
- Automated waitlist promotion/optimization and class-compatible waitlists.
- Attribution, conversion funnel, forecasting, cohort/retention analytics, and
  marketing automation.
- Custom domains, deeper white-labeling, configurable themes/content, and partner
  marketplace integrations.
- SAML SSO, SCIM, custom policy-based access, audit export/retention, data residency,
  and vertical compliance modes where demanded by the target market.

## Recommended dependency order

```text
Reconcile product contract and ledger
        |
        v
Merchant appointment command + audit/versioning
        |-----------------------------|
        v                             v
Manual appointment save        Blocks/date exceptions
        |                             |
        +-------------+---------------+
                      v
       Merchant edit/reschedule/cancel/status
                      |
          +-----------+------------+
          v                        v
Lifecycle delivery worker    Payment account decision
          |                        |
          +-----------+------------+
                      v
       Merchant configuration/control plane
                      |
          +-----------+------------+-------------+
          v                        v             v
   Customer CRM            Calendar sync     Reporting
          |                        |
          +-----------+------------+
                      v
           Resources/classes/growth features
```

The first command should be narrow but deep: a merchant-created Pay In Person
appointment that uses the existing provider/service/availability rules, rejects a
race, snapshots accepted facts, appears in the calendar, sends a confirmation, and
records audit. It becomes the tracer for block time, merchant rescheduling, online
payments, CRM, and API writes.

## Launch-profile recommendation

### Smallest credible Solo release

Keep the promise deliberately narrow:

- one Merchant/Shop/Provider;
- services, weekly hours, date exceptions, and block time;
- public guest booking and Pay In Person;
- merchant manual create/edit/reschedule/cancel/complete/no-show;
- email confirmation plus at least one reminder;
- basic customer history/notes and data export/delete;
- basic appointment/no-show/utilization report;
- no online money, staff accounts, resources/classes, or two-way calendar unless the
  target users say those are acquisition blockers.

This is the fastest coherent path because it closes the missing merchant loop without
turning on unresolved payment or team obligations.

### Deferred Team/online-payments expansion

Retain this as future expansion evidence; do not add it before BeeSolo launch:

- Merchant Members and least-privilege roles;
- Provider-specific schedules/exceptions and at least one external calendar sync;
- per-Merchant payment onboarding/routing, deposits/prepayment, refunds, disputes, and
  reconciliation;
- multi-Shop management if advertised;
- richer reports and operational dashboards;
- resources/capacity if the target vertical uses chairs/rooms/equipment as independent
  constraints.

## Things not to implement merely because they appear in a backlog

1. **Persisted Availability:** the current derived model is a sound design. Persist
   rules, blocks, commitments, and external busy facts—not generated slots—unless a
   measured performance requirement justifies a projection.
2. **Realtime transport:** holds, idempotency, version checks, and explicit refresh can
   protect correctness. Add realtime only for a proven operator experience such as a
   high-volume live queue.
3. **A parallel customer-write Platform API:** first finish first-party merchant
   commands. Later APIs should call those same commands, not become a second engine.
4. **Mandatory customer accounts:** anonymous booking is a product strength. Accounts
   should improve continuation and preferences without gating a booking.
5. **All 132 planned parity entries as one release gate:** many are route names,
   presentation states, legacy retirement items, viewports, and optional-provider
   variants—not independent market features. Reconcile them, then tie release gates to
   the chosen product promise.
6. **Offline mutation in the Merchant PWA:** network-authoritative booking operations
   avoid dangerous conflict queues. Cached read-only shell/data can be considered
   later, but offline appointment writes need a much stronger reconciliation model.

## Production-critical edge cases to retain

The repository already handles several hard cases well; new work must preserve them:

- last-slot races, all-or-none group capacity, expiring holds, and idempotent retries;
- immutable service/price/policy/customer snapshots after catalog changes;
- stale concurrent cancel/reschedule/staff edits;
- late payment success after a client timeout or expired browser flow;
- duplicate and out-of-order provider events—Stripe explicitly says webhook events can
  be duplicated and are not ordered ([Stripe webhooks](https://docs.stripe.com/webhooks));
- future bookings after Provider/Service/Shop/resource deactivation;
- DST gaps and repeated hours, recurring wall times, Merchant travel, and Shop timezone
  changes. Use IANA identifiers as required by Google Calendar and preserve UTC plus
  original wall-time context
  ([Google event/time concepts](https://developers.google.com/workspace/calendar/api/concepts/events-calendars),
  [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html));
- separate booking status, payment status, refund obligation, notification status, and
  customer consent;
- data minimization, retention, export/deletion, and purpose-specific consent. GDPR
  requires minimization and storage limitation
  ([GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679),
  [EDPB guidance](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en)).

## Final recommendation

Do not start with another broad parity or visual-polish wave. Create one implementation
program named **Merchant Appointment Operations**, with these first four tracer
tickets:

1. Persist a Merchant-created Pay In Person Appointment from the existing composer.
2. Persist a Provider block/date exception and remove those slots from customer
   Availability.
3. Add versioned Merchant reschedule/cancel/complete/no-show commands and appointment
   timeline UI.
4. Claim and deliver due lifecycle Notification Intents/Scheduled Work.

After those land, make the payment-account decision and build the configuration
control plane. That sequence converts the existing strong booking engine into a
merchant-operable scheduler while reusing, rather than duplicating, the repository's
best domain work.
