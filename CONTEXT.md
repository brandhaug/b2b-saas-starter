# beesolo Domain Context

beesolo is the Cloudflare-first Booking Product built from the useful behavior of `ssqu/recreate`. It has separate public, merchant, booking, API, background, and operations surfaces. Launch is Solo-only: one Merchant Owner operates one Shop as its sole active Provider; Team capability is deferred.

## Language

**Booking Product**:
The actual recreated product being built from `ssqu/recreate`.
_Avoid_: Starter demo, template showcase

**beesolo**:
The customer-facing product name for the launch Booking Product: a Solo-only appointment scheduler for one Merchant Owner operating one Shop as its sole active Provider. The name is always written in lowercase, including at the start of headings, titles, metadata, and sentences. Team capabilities are deferred beyond the beesolo launch.
_Avoid_: BeeSolo, B2B SaaS Starter, Team Plan, multi-employee scheduler

**Public Site**:
The unauthenticated beesolo product-marketing and merchant-information surface for prospective solopreneur barbers and salon professionals. It may link customers into a Merchant's Public Booking Page, but it does not publish repository, starter-template, reference-application, architecture, module, adoption-readiness, or external-developer documentation.
_Avoid_: Merchant App, Booking App, developer portal, repository showcase, starter documentation

**Public Booking Page**:
The public customer-facing page for a merchant where customers can learn enough to start booking.
_Avoid_: Storefront, profile page, microsite

**Public Page Status**:
The Merchant-controlled publication intent of a public booking page: **Published** or **Unpublished**. Effective customer availability additionally requires Booking Readiness, Notification Readiness, and subscription access.
_Avoid_: Appointment status, merchant status

**Published**:
A public page status expressing that the Merchant intends the page to be available to customers whenever readiness and subscription access permit it.
_Avoid_: Cached version, immutable revision

**Unpublished**:
A public page status for a page that is not available to customers, including a newly created merchant or a page later removed from public access.
_Avoid_: Draft, deleted, suspended merchant

**Booking Readiness**:
The derived condition that determines whether a public booking page can be Published: it has a public name and slug, an active service, an eligible provider, and schedule rules.
_Avoid_: Adoption Readiness, current time-slot availability, team setup

**Merchant Activation**:
The one-time derived launch condition required before a Merchant's first publication. It composes Booking Readiness with essential Business Details, explicit booking-policy choices, Notification Readiness, and a successful non-customer-facing launch test. Publication atomically re-evaluates Merchant Activation and subscription access: failure leaves the page Unpublished and preserves all saved work, while success records first activation permanently. After first publication, ordinary configuration changes do not reactivate Merchant Onboarding; continued customer availability depends on current Booking Readiness, Notification Readiness, Public Page Status, and subscription access.
_Avoid_: Booking Readiness, account activation, subscription activation

**Preview Mode**:
A Merchant-authorized rehearsal of the customer booking journey against current saved configuration and production booking and Availability rules. It may select a real candidate Time Slot and produce a simulated confirmation, but it creates no operational Appointment or Customer Directory entry, consumes no Time Slot, and sends no customer notification.
_Avoid_: Published page, test appointment, draft page

**Launch Test**:
The successful completion of Preview Mode through Service, Provider preference, actual available Time Slot, customer details, review, and simulated confirmation. Before first publication, its evidence is bound to the activation-relevant configuration and becomes stale when that configuration changes; after first publication, later edits do not require another Launch Test.
_Avoid_: Booking Readiness, production Appointment, notification test

**Business Details**:
The onboarding and settings grouping for the single-Shop release's Merchant identity, one persisted Shop and Shop Address, and Public Booking Page presentation fields. Activation requires country, street address, city or locality, postal code where applicable, IANA timezone, and a public phone number; website or social link and arrival directions are optional. The UI hides the default Brand and multi-Shop topology. Mobile services, customer-address visits, virtual appointments, and multiple service locations remain deferred.
_Avoid_: separate onboarding aggregate, branch profile

**Merchant App**:
The authenticated business-facing application where merchants manage their public page, services, providers, appointments, customers, settings, and reports.
_Avoid_: Admin app, back office, app app

**Operations App**:
The staff-only application for platform-wide support and administration across Merchants and platform identities. It is separate from the Merchant App and never derives authority from Merchant membership.
_Avoid_: Admin app, internal app, back office

**Operations Vertical Slice**:
The first Operations App release proving operator authentication, controlled provisioning, Merchant and Merchant Member discovery, safe impersonation, and global impersonation audit review end to end.
_Avoid_: Legacy admin port, full operations console, Merchant App administration

**System Operator**:
An authenticated platform staff member authorized to use the Operations App. A System Operator identity cannot also be a Merchant Member or Customer Account.
_Avoid_: Merchant admin, workspace admin, support user

**Operator Session**:
The authenticated interaction envelope that grants a System Operator access to the Operations App only. It never grants Merchant authority and cannot be presented as a Merchant App session.
_Avoid_: Admin session, shared session, Merchant session

**Operator Enrollment Session**:
A temporary permissionless interaction envelope allowing an invited staff identity to complete password, email-verification, two-factor, and backup-code setup before receiving an Operator Session.
_Avoid_: Operator Session, partial admin access, Merchant onboarding

**Operator Permission**:
An explicit platform-wide authorization granted to a System Operator for one Operations App capability and sourced from Better Auth custom access control. Better Auth roles may bundle Operator Permissions, but Operations App access alone implies none.
_Avoid_: Merchant Role, blanket admin access, UI-only permission

**Privacy Request Permission**:
An Operator Permission in the privacy-request family: `privacy-request:read` permits masked queue access, `privacy-request:review` permits case claiming, necessary-data review, evidence requests, deadline extensions, rejection, access release, and correction approval, and `privacy-request:erase` additionally permits irreversible Customer Data Erasure approval after holds clear. Every sensitive action rechecks current permission and a recently two-factor-authenticated Operator Session; the approved action executes as a system workflow and launch does not require a second operator.
_Avoid_: privacy role, Merchant approval, approval-by-impersonation

**Operator Invitation**:
A controlled offer for a new dedicated staff identity to become a System Operator with an explicit initial permission set. It grants only an Operator Enrollment Session until email verification, password setup, and mandatory two-factor enrollment are complete.
_Avoid_: Public sign-up, Merchant invitation, immediate account creation

**Impersonated Merchant Session**:
A temporary Merchant App session that acts with a target Merchant Member's effective authority while preserving the initiating System Operator as provenance. It is created only through an explicit impersonation handoff and remains distinct from the Operator Session.
_Avoid_: Shared admin cookie, operator login, permanent access

**Impersonation Reason**:
The required human explanation for starting an Impersonated Merchant Session, optionally linked to an external support reference. It records intent for review but grants no authority.
_Avoid_: Permission, authorization, free access note

**Impersonation Handoff Ticket**:
A single-use, short-lived capability that authorizes the Merchant App to create one Impersonated Merchant Session after Operations App checks succeed. Only its hash persists, and consumption is atomic.
_Avoid_: Shared cookie, session token, reusable login link

**Impersonation Record**:
The durable lifecycle record connecting one System Operator, Operator Session, target Merchant Member, Merchant, Impersonation Reason, handoff, and resulting Impersonated Merchant Session. Its lifecycle is **Pending Handoff**, **Active**, **Stopped**, **Expired**, or **Revoked**.
_Avoid_: Audit event, Better Auth session, support ticket

**Impersonation Audit Trail**:
The two-year persisted history that attributes an impersonation lifecycle and its sensitive activity to both the initiating System Operator and target Merchant Member, surviving either identity's deactivation or deletion through stable identifiers.
_Avoid_: Application log, target-only audit history, session debug log

**Booking App**:
The public customer-facing booking experience for choosing a service, provider preference when needed, time, customer details, checkout path, and appointment confirmation.
_Avoid_: Widget, public app, storefront

**Platform API**:
The deferred external server-to-server integration surface for merchant-owned data, appointment records, API tokens, and webhook configuration. It is not a BeeSolo launch surface.
_Avoid_: Booking API, customer booking channel, first-party app data layer, launch API

**Read-and-Notify Integration**:
The future non-mutating Platform API contract: server-to-server reads of Merchant, Service, Provider, and Appointment data plus outbound Webhook Events. It cannot create or change booking records, Availability, or Customer Records and is deferred beyond BeeSolo launch.
_Avoid_: Booking API, write integration, launch integration, external-calendar synchronization

**Appointment Calendar Export**:
A one-way customer convenience for adding a confirmed Appointment to a personal calendar from an already-authorized Confirmation view. It is a snapshot with no standalone public download URL, persisted calendar artifact, external-calendar synchronization, or accepted external calendar changes.
_Avoid_: external-calendar synchronization, connected calendar, calendar conflict source

**Booking Vertical Slice**:
The first recreated journey that proves the architecture end to end: merchant-managed booking data, public booking, checkout path, and appointment confirmation.
_Avoid_: Full port, demo flow

**Merchant**:
The Booking Product tenant and authorization boundary: a business or operator that owns a public booking presence and bookable configuration. In the first slice a merchant may be a solopreneur; later it can grow into a team, brand, or multi-shop operation.
_Avoid_: Account, workspace, tenant

**Merchant Member**:
An authenticated person authorized to operate one Merchant. BeeSolo launches with exactly one Active Merchant Member, the Owner; future Team design may add Pending or additional Active relationships. A Merchant Member is not necessarily a bookable Provider outside the Solo invariant.
_Avoid_: Workspace member, Provider, staff member

**Merchant Membership**:
One auditable episode of a person's relationship to a Merchant, with a lifecycle of **Pending**, **Active**, or **Revoked**. Pending grants no authority, Active grants the assigned Merchant Role, and Revoked is permanent historical state; rehiring creates a new membership episode rather than restoring the old one.
_Avoid_: Better Auth account, Merchant Invitation, Provider linkage

**Merchant Access Hold**:
A reversible security override that temporarily blocks an Active Merchant Membership after suspected compromise without changing its role, billing seat, Provider linkage, or Provider Status. It is cleared only after credential recovery and fresh authentication.
_Avoid_: Revoked membership, inactive Provider, Restricted Access

**Merchant Member–Provider Linkage**:
An optional one-to-one relationship between an Active Merchant Member and a Provider of the same Merchant. It supplies self-service bookable context but grants no Merchant authority: an unlinked member keeps their role, and an unlinked Provider may remain bookable.
_Avoid_: Merchant Membership, Provider Status, permission grant

**Merchant Role**:
The fixed authorization level assigned to a Merchant Member. BeeSolo launches with Owner only; the deferred Team design adds Manager and Employee independently of whether a member is a bookable Provider.
_Avoid_: Workspace Role, Provider Status, custom permission set

**Merchant Owner**:
The Merchant's single accountable authority, with access to all Merchant operations including financial, identity, ownership, and destructive decisions. Each Merchant has exactly one Merchant Owner, and each Merchant Owner owns one Merchant.
_Avoid_: Workspace owner, shop user, Provider

**Merchant Reporting Access**:
The Owner-only authority to view BeeSolo operational reports and export their Merchant's reporting data. An Impersonated Merchant Session may exercise the same effective authority with System Operator provenance; no customer, public session, deferred Team role, or Platform API credential receives it. Restricted Access preserves read and export, while a Merchant Access Hold blocks it.
_Avoid_: analytics role, public dashboard, cross-Merchant reporting, unscoped export

**Report Drill-down**:
The Owner's filtered path from a report aggregate to underlying Merchant-scoped records. Appointment drill-down exposes local times, status or outcome, Service snapshot, origin, Customer Details, and External Collection entries; Walk-in and Waiting List drill-downs expose their lifecycle facts and linked Appointment; Notification drill-down exposes purpose, masked destination, outcome, safe failure reason, and attempt times. It never exposes other customers' identities or queue positions, raw provider payloads, credentials, or cross-Merchant data.
_Avoid_: raw database view, global customer search, provider log, public queue detail

**Reporting Export**:
An Owner-initiated export of the currently filtered report view, with one CSV per primary fact rather than a duplicated wide file: Appointments, External Collection entries, Walk-in Entries, Waiting List Applications or Offers, and Notification Intents or delivery families. Each file states the Shop, period, Shop Reporting Timezone, currency, filters, and generation time; it contains no customer name, email, phone, Merchant Note, ban reason, consent evidence, confirmation token, or raw notification destination. Each row includes stable opaque identifiers for its primary fact and permitted related records, including Merchant-scoped Customer Record IDs, so files can be joined without identifying the person. It is distinct from Customer Directory Export and Customer Data Package.
_Avoid_: mega CSV, Platform API export, customer privacy package, revenue ledger

**Reporting Timestamp Format**:
The export convention for exact instants: every instant is represented as an ISO-8601 UTC value and as the equivalent Shop-local civil timestamp, with the Shop Reporting Timezone and selected local date range included in export metadata. This preserves unambiguous ordering across daylight-saving transitions while keeping local periods readable.
_Avoid_: browser-local timestamp, ambiguous local time, UTC-only report period

**Reporting Money Format**:
The export convention for amounts: decimal major units with two decimal places plus an ISO currency column. Launch uses the Shop's single EUR currency, names agreed value and net External Collections explicitly, and never labels either fact as revenue or Payment.
_Avoid_: floating-point total, integer-only amount without currency, revenue, Payment

**Reporting Retention**:
The retention boundary for reporting artifacts: report views derive from authoritative source facts on demand rather than a permanent aggregate copy; encrypted generated exports remain available for twenty-four hours and are then deleted, while export audit metadata follows ordinary governance retention. Source records keep their own domain retention and privacy-erasure rules, so new reports reflect anonymization and re-download requires a new export.
_Avoid_: indefinite report archive, stale materialized dashboard, export as backup

**Reporting Empty and Error State**:
The explicit result contract for report queries: a valid period with no matching facts is a successful zero or empty state; invalid dates or filters are validation errors; source or system failure is an unavailable report with retry and never a fabricated zero or silently partial result; pending Notification Evidence remains pending rather than failed; and a failed export produces no downloadable artifact.
_Avoid_: blank screen, zero-on-error, stale partial report, pending-as-failed

**Reporting Consistency**:
The shared server-side read boundary for one report view or export. Metrics, drill-downs, and exported rows use one generated-at instant and one consistent source read; facts committed afterward appear only after refresh or a new export. The generated-at instant is included in report metadata.
_Avoid_: live card drift, browser-time snapshot, mixed-read export

**Merchant Manager**:
A Merchant Member trusted to administer daily Shop operations, bookable configuration, employees, and reporting, but not ownership, billing, Manager authority, or destructive Merchant decisions.
_Avoid_: Merchant Owner, system administrator, Provider

**Merchant Employee**:
A Merchant Member authorized for day-to-day customer, appointment, queue, and Shop schedule operations, with self-service control of their own bookable configuration only when linked to a Provider.
_Avoid_: Provider, contractor, shared staff login

**Merchant Ownership Transfer**:
A current Owner's 24-hour, single-use offer for an Active Manager to become the Merchant's sole Owner. Acceptance atomically makes the recipient Owner and the former Owner a Manager; cancellation or expiry leaves both roles unchanged, and Provider linkages never change with ownership.
_Avoid_: Manager promotion, membership invitation, Provider reassignment

**Owner Account Recovery**:
The support-assisted restoration of sole-Owner authority when the current verified email is unavailable. It uses business and subscription-control evidence, two System Operator approvals, a security hold, and notice to the old email and Active Managers; it transfers ownership to an Active Manager when possible and otherwise replaces the identity attached to the existing Owner membership.
_Avoid_: password reset, Merchant Ownership Transfer, operator impersonation

**Solo Plan**:
A paid beesolo entitlement for one Shop with exactly one Merchant Member, whose automatically created Provider is its sole active Provider. That Owner-Provider remains Active, is automatically eligible for each new Service, and requires only a confirmed customer-facing name for activation; richer profile fields are optional. A new Merchant may use the plan through a 14-day trial, but it is not a permanent free tier.
_Avoid_: Team with one employee, free Team Plan

**Team Plan**:
A deferred future entitlement for one Shop with two to twenty active Merchant Members, including the Owner, and optional Provider linkage for each member. Its resolved design is retained for a later effort, but no Team onboarding, membership, role, Provider-linkage, per-seat billing, upgrade, or downgrade behavior belongs to the beesolo launch. The launch Public Site may show the exact non-interactive note **Teams — coming later** on Pricing, without a price, date, feature promise, waitlist, signup choice, navigation entry, or upgrade path.
_Avoid_: Multi-Shop Plan, shared employee login

**Merchant Subscription**:
The platform billing relationship that grants a Merchant its beesolo Solo Plan entitlement at launch. Future Team entitlement remains deferred. Merchant Subscription is separate from customer booking Payments and Checkout Paths.
_Avoid_: Appointment Payment, Pay Now, customer subscription

**Subscription Access State**:
The authoritative effective-access lifecycle of a Merchant Subscription: **Trialing**, **Active**, **Grace**, or **Restricted**. Pending upgrades and scheduled quantity, plan, or cancellation changes are separate lifecycle facts, while provider billing statuses never directly grant product authority.
_Avoid_: Stripe status, Payment status, Public Page Status

**Grace Period**:
A seven-day interval after the first failed paid renewal during which the Merchant retains its existing plan entitlement while payment recovery continues.
_Avoid_: Free trial, permanent extension, Stripe retry schedule

**Restricted Access**:
A subscription access condition that stops new bookings and setup changes while preserving billing recovery, data export, read access, and safe handling of Appointments created before restriction. It blocks Merchant-Created Appointment and Record Completed Appointment, but allows Edit, Reschedule, Cancel, Complete, No Show, Appointment Outcome Correction, External Collection, and explicit whole-party cancellation for existing commitments under their ordinary validation, history, and notification rules. It does not bypass a Merchant Access Hold or invalid authentication, does not overwrite the Merchant's Public Page Status, and successful payment restores the effective plan automatically. Recoverable operational data is retained for 12 months before deletion or irreversible anonymization.
_Avoid_: Deleted Merchant, Unpublished, disabled account

**Merchant Onboarding**:
The authenticated, resumable setup path through which a verified person selects a Solo billing interval, then atomically creates a Merchant, becomes its Merchant Owner, and starts the Merchant's single 14-day trial. Creation also establishes the Owner as the Solo Plan's sole active Provider, one default Brand, one Shop and Shop Address, and an Unpublished Public Booking Page; abandoning the path before that boundary creates no Merchant and starts no trial. After creation, setup is a dependency-aware checklist whose canonical order is Business Details and Owner-Provider confirmation, Service setup, working hours and exception review, Booking Policies, Notification Readiness, Launch Test, and publication. Progress is derived from authoritative saved configuration: valid saves persist immediately, completed steps remain editable, optional fields may be skipped, and the Merchant may leave and later resume at the first incomplete required step. Restricted Access preserves the checklist and configuration as read-only until billing recovery restores setup changes and resumes the same Merchant; it never starts another trial or onboarding record. Team selection, Team Setup, and plan switching are deferred beyond BeeSolo launch.
_Avoid_: Sign-up, merchant registration, workspace creation

**Merchant Member Onboarding**:
The invitation and enrollment path through which a person authenticates with the invitation's verified email and accepts a Merchant Invitation. Acceptance creates a Pending Member first; Merchant App authority begins only when trial or paid Team capacity allows activation. Enrollment grants Merchant App access separately from any optional relationship to a bookable Provider.
_Avoid_: Team onboarding, Provider onboarding, staff setup

**Merchant Invitation**:
A seven-day, email-bound, single-use offer for a person to join one Merchant as a named Merchant Role. An Owner may offer Manager or Employee authority, while a Manager may offer only Employee authority; resending rotates the acceptance secret, revocation ends the offer, and changing its role creates a new offer.
_Avoid_: Operator Invitation, shared login, active membership, seat

**Pending Member**:
A person who has accepted a Merchant Invitation but has no Merchant App authority until Team capacity is confirmed through the trial, an already-paid vacant slot, or successful prorated seat payment.
_Avoid_: active Merchant Member, pending invitation, Provider

**Merchant Catalog**:
The bounded context for merchant-owned bookable configuration: merchants, brands, shops, shop addresses, providers, and services. Booking configuration resolves by explicit precedence from Merchant to Brand to Shop, and downstream aggregates snapshot the resolved values.
_Avoid_: One generic booking bucket, product catalog

**Brand**:
A customer-visible grouping under a Merchant for one or more Shops, public identities, or business lines. Merchant Onboarding creates one default Brand, but the single-Shop release does not expose Brand management.
_Avoid_: Account, workspace, chain

**Shop**:
A Merchant business unit and operational configuration boundary used for booking at one fixed physical premises. BeeSolo Merchant Onboarding creates exactly one Shop; multiple Shops remain outside launch.
_Avoid_: Location, store, branch

**Shop Reporting Timezone**:
The Shop's configured IANA timezone used to interpret reporting periods and civil-time buckets for its historical operational facts. Browser or device timezone never changes report membership, and every report or export identifies this timezone, including across daylight-saving transitions.
_Avoid_: browser timezone, UTC reporting timezone, device local time

**Shop Address**:
The physical address details for a Shop. Merchant Onboarding creates and Business Details completes the single Shop Address required for activation.
_Avoid_: Location

**Provider**:
The bookable person who performs services for a Merchant. BeeSolo has exactly one Active Provider, automatically linked to its Merchant Owner; additional Providers are deferred with the Team Plan.
_Avoid_: Staff member, employee, barber, professional

**Provider Status**:
The booking lifecycle of a provider: **Active** or **Inactive**. An inactive provider remains part of historical appointments but cannot receive a new appointment.
_Avoid_: Employment status, member status, deleted provider

**Provider Booking Access Policy**:
Merchant Catalog rules that may restrict public selection of a Provider through a verifier such as a passcode. Successful verification yields only a short-lived proof bound to one Booking Session and Provider.
_Avoid_: Customer identity, Merchant membership, provider login

**Professional**:
Customer-facing copy for a provider in the booking flow.
_Avoid_: Canonical entity name

**Barber**:
Legacy and vertical-specific wording for a provider in the barber booking vertical.
_Avoid_: Canonical entity name

**Service**:
A bookable catalog item with a customer-facing name, category, duration, positive customer-facing price in the Merchant's configured currency, Provider eligibility, and optional before and after Service Buffers. Merchant Activation requires at least one Active Service; its duration is configured in five-minute increments from five minutes through eight hours, while description and image are optional.
_Avoid_: Product, add-on

**Service Buffer**:
Provider preparation or cleanup time reserved before or after a Service without increasing its customer-facing duration. Each Service has independently configurable before and after buffers from zero through 120 minutes, defaults both to zero, and uses five-minute increments. When one Appointment contains multiple Services, the Services remain contiguous and its occupied interval uses the largest selected before buffer and largest selected after buffer; buffers are neither summed nor inserted between Services. Availability conflicts use that resolved occupied interval, while the Time Slot Hold, Booking Quote, and Appointment snapshot the buffer facts that produced it.
_Avoid_: Service duration, Blocked Time, break

**Service Status**:
The booking lifecycle of a service: **Active** or **Inactive**. An inactive service remains part of historical appointments but cannot enter a new booking session.
_Avoid_: Deleted service, availability

**Primary Service**:
The main service selected for an appointment.
_Avoid_: Service line item

**Additional Service**:
A service selected alongside the primary service in the same appointment.
_Avoid_: Add-on

**Add-on**:
Customer-facing copy for an additional service.
_Avoid_: Canonical entity name, separate first-slice entity

**Scheduling**:
The bounded context for deciding when a service can be booked with an eligible provider for a merchant public booking presence.
_Avoid_: Calendar UI, appointment record

**Availability**:
The set of candidate times for a selected public booking page, services, and provider choice in a booking session.
_Avoid_: Schedule rules, calendar

**Time Slot**:
One bookable candidate time within availability.
_Avoid_: Calendar event

**Time Slot Hold**:
A short-lived, provisional exclusive claim on a Provider and time interval held by an active Booking Session while the customer completes booking. A coordinated Booking Party acquires its complete conflict-free hold set atomically or acquires none. Except for a guarded Shop-timezone change, an Owner scheduling change takes effect immediately and atomically invalidates only the holds it makes unavailable; the affected customer receives a slot-lost recovery on their next action while retaining the rest of their Booking Party selections. If customer confirmation races Merchant creation or rescheduling for the same occupied interval, the first committed Appointment wins: customer-first makes the Merchant command fail with the conflicting Appointment, while Merchant-first invalidates the hold and makes confirmation return slot lost. A Time Slot Hold never prevents the Owner from responding to an urgent interval change and is not an Appointment commitment.
_Avoid_: Appointment, reservation, persisted availability

**Schedule Rules**:
Merchant-side configuration that produces Availability in the Shop's IANA timezone from distinct Weekly Working Hours, Date Overrides, Blocked Time, and a Start-Time Interval. Weekly Working Hours and Date Overrides are civil-time rules: their clock labels remain anchored to the Shop timezone across daylight-saving transitions. Nonexistent local slot starts are omitted, while repeated local times may produce two distinct Time Slots that customer and Merchant surfaces distinguish by offset or timezone abbreviation. Appointments, Blocked Time, and Time Slot Holds are exact instant intervals and never shift because of a daylight-saving transition. The Owner may change the Shop timezone only through an impact preview and explicit confirmation, and never while a Time Slot Hold is active. A timezone change preserves Weekly Working Hours and Date Overrides as the same local labels, preserves Appointment and Blocked Time instants, immediately re-derives unheld future Availability, and never rewrites historical Provider or Appointment facts. Merchant Activation requires at least one explicit weekly working interval for the Owner-Provider and confirmation that upcoming Date Overrides have been reviewed; it never assumes or silently saves default business hours. Overnight intervals are outside the single-Shop launch model.
_Avoid_: Availability

**Weekly Working Hours**:
The Owner-Provider's recurring local-time working intervals, grouped by weekday, that form the ordinary base for Availability. A weekday may contain multiple non-overlapping intervals, and no interval may cross midnight.
_Avoid_: Availability, business hours, opening hours

**Date Override**:
Schedule Rules for one Shop-local calendar date that replace, rather than merge with, its Weekly Working Hours. A Date Override either closes the entire date or supplies one or more non-overlapping working intervals for that date.
_Avoid_: Blocked Time, special hours, exception hours

**Blocked Time**:
One ad hoc unavailable instant interval subtracted from otherwise working time without changing Weekly Working Hours or a Date Override. Its start and end use five-minute input increments, become exact instants, and may cross midnight or span multiple dates; recurring Blocked Time series are outside launch because split Weekly Working Hours cover recurring breaks and Date Overrides cover date-specific closures. An optional private reason appears only in the Merchant App. The Owner may create Blocked Time even when it overlaps a future Appointment; the Appointment remains unchanged and becomes a Schedule Conflict rather than being silently moved or cancelled.
_Avoid_: Date Override, Appointment, break

**Schedule Conflict**:
The derived condition of a non-terminal Appointment whose occupied interval no longer fits current Schedule Rules after an explicitly confirmed Owner change. It is not an Appointment status: the Appointment remains a commitment and the conflict stays visible until the Appointment is rescheduled, cancelled, or otherwise becomes terminal.
_Avoid_: double booking, Appointment status, Availability

**Schedule Change**:
An Owner-authorized mutation to Schedule Rules, Booking Window controls, or Service scheduling facts. Current configuration alone produces new Availability, while each Schedule Change leaves immutable actor, time, reason where supplied, and before-and-after audit facts. Except for a Shop-timezone change, which waits until no Time Slot Hold is active, a Schedule Change atomically invalidates only the active holds it makes unavailable. Accepted Appointment snapshots and unaffected Time Slot Hold snapshots preserve their own booking facts; BeeSolo does not persist generated Availability or promise to reconstruct every historical Time Slot.
_Avoid_: Appointment mutation, stored Availability, Schedule Rule version

**Start-Time Interval**:
The Shop-level five, ten, fifteen, or thirty-minute local-time grid on which customer-bookable Time Slots may begin, defaulting to fifteen minutes. Service duration determines whether the complete occupied interval fits, not the next candidate start; the occupied interval includes the resolved Service Buffers and must fit within working time without conflict.
_Avoid_: Service duration, Time Slot duration, buffer

**Booking Policies**:
The Merchant-facing configuration grouping for the Booking Window, when customers may cancel or reschedule, and whether successful bookings confirm automatically. Merchant Activation begins with an explicitly confirmed or edited launch preset: bookings from two hours through sixty days ahead, customer cancellation or rescheduling until twenty-four hours before the Appointment, contact-the-business handling after that cutoff, and automatic confirmation. With Pay In Person it never promises a cancellation fee, no-show charge, or stored payment credential.
_Avoid_: Checkout Policy, Schedule Rules, payment terms

**Booking Window**:
The Booking Policies interval in which a customer may start an Appointment, bounded by Minimum Notice and Booking Horizon. Availability display and Time Slot Hold acquisition both enforce the current Booking Window. Minimum Notice must be shorter than the nominal Booking Horizon so the configured window cannot be permanently empty; the activation preset is two hours through sixty days.
_Avoid_: Availability range, working hours, cancellation window

**Minimum Notice**:
The exact elapsed duration from the current instant to the earliest customer-bookable Appointment start, including across daylight-saving transitions. The Owner may configure zero minutes through thirty days in fifteen-minute increments.
_Avoid_: Booking Horizon, cancellation cutoff, lead time

**Booking Horizon**:
The latest Shop-local calendar date on which a customer may start an Appointment. The Owner may configure one through 365 whole days; a horizon of N days includes every otherwise valid start on the local date N calendar days after today.
_Avoid_: Minimum Notice, rolling duration, availability query range

**Booking**:
The bounded context for the customer journey from booking session through confirmed appointment.
_Avoid_: Cart, sale order

**Booking Party**:
The single-currency aggregate owned by one Booking Session for either a single or composite booking, containing one or more ordered Booking Requests coordinated by one customer and payer. Confirmation is atomic. Afterward each resulting Appointment has an independent lifecycle: edit, reschedule, completion, No Show, and External Collection operations always target one Appointment. Cancellation may explicitly target either one Appointment or every still-Scheduled Appointment created by the same Booking Party; a whole-party cancellation is atomic and never happens implicitly.
_Avoid_: Cart, sale order, group reservation

**Booking Party Notification**:
The atomic confirmation or whole-party cancellation notice consolidated once per unique email destination and limited to that destination's affected Appointments, while the coordinating Customer receives the protected whole-party Confirmation. Mobile permission remains Booking Request-specific, and reminders plus later changes remain Appointment-specific.
_Avoid_: one email per Appointment, guest-wide consent, shared mobile permission

**Booking Party Status**:
The aggregate lifecycle of a Booking Party: **Active**, **Confirming**, **Confirmed**, **Expired**, or **Abandoned**. Confirming parties reject material edits, and terminal parties cannot be confirmed again; hold, quote, acceptance, and payment states remain separate facts.
_Avoid_: Checkout phase, payment status, appointment status

**Booking Request**:
One intended guest appointment within a Booking Party, including that guest's selected services, resolved Provider, and customer details. After atomic confirmation it becomes one independently identifiable Appointment.
_Avoid_: Cart item, reservation, service line item

**Booking Session**:
The capability-protected interaction envelope for exactly one Booking Party, governing browser access, locale, expiry, and continuation. It does not own selections, pricing, confirmation, or Appointment lifecycle.
_Avoid_: Cart, reservation, booking aggregate

**Booking Locale**:
The Romanian or English presentation language selected for one Booking Session and reused for continuation, confirmation, and customer notifications. Spanish, French, and silent English notification fallback are outside the beesolo launch language set; locale remains independent of Shop timezone and currency.
_Avoid_: Browser locale, Shop locale, language route

**Public Content Locale**:
The explicit Romanian or English language of one beesolo Public Site page, Help article, FAQ entry, legal page, or Blog post. Romanian is the launch default. Locale-prefixed canonical routes keep languages distinct; content is published in a locale only when that version exists and has been reviewed, never through silent cross-language fallback. Blog posts need not launch in both locales simultaneously.
_Avoid_: Booking Locale, browser-language-only URL, silent English fallback, automatic translation

**Customer Notification Locale**:
The Romanian or English language snapshotted by an Appointment, Waiting List Application, or Walk-in Entry for its customer notifications. Customer-started work uses the selected interface language; Owner-created or assisted work requires an explicit choice prefilled from the Shop default, never an inference from phone country, name, or Customer Record history.
_Avoid_: Browser locale, Customer Record language, automatic translation fallback

**Notification Timezone Snapshot**:
The source revision's IANA timezone used for customer-visible times, Reminder target calculation, its delivery window, deterministic rendering, and investigation. A later Shop timezone change never rewrites existing notification work; only an explicit source revision may supply new notification facts.
_Avoid_: worker timezone, current Shop timezone at send time, browser timezone

**Booking Session Capability**:
A secret held by the customer's browser that, together with its Booking Session ID, grants limited access to one active Booking Session.
_Avoid_: Customer session, customer login, booking URL

**Pricing Quote**:
An immutable, versioned price proposal for a Booking Party, bound to the exact selections, holds, policies, promotions, tips, and gift-card reservations that produced it. Booking snapshots the accepted version; Payments settles its amount due, and any material input change requires a new version and acceptance.
_Avoid_: Booking Quote, payment intent, sale order, live catalog data

**Pricing Adjustment**:
A named monetary change within a Pricing Quote, such as a discount, tax, fee, or tip, recorded separately from service prices and allocated deterministically where required.
_Avoid_: Price override, hidden total change

**Settlement Allocation**:
An immutable allocation of an accepted Pricing Quote's total across Gift Card value and externally collected Payment value. It changes how the total is settled rather than changing the price, and refunds reverse the original allocations.
_Avoid_: Pricing Adjustment, discount, recalculated refund

**Promotion**:
A server-owned eligibility rule that produces one or more Pricing Adjustments, optionally activated by a customer-entered code. Limited uses are reserved for the quote, atomically committed at confirmation, and released on expiry or abandonment.
_Avoid_: Promo-code field, gift card, client-calculated discount

**Appointment**:
A customer service commitment created either by atomic Booking Party confirmation or an authorized Merchant command, with selected Services, scheduled time, and assigned Provider. It preserves the customer-visible facts accepted when created and every later revision so catalog changes do not rewrite booking history.
_Avoid_: Reservation, sale order

**Appointment Price Snapshot**:
The customer-visible Service prices and total preserved by an Appointment. Merchant creation derives it from the current prices of the selected Active Services; arbitrary custom totals, discounts, and surcharges are outside launch. A time-only Reschedule Appointment preserves it despite later catalog price changes, while adding, removing, or replacing a Service recalculates the complete replacement from current catalog prices and requires preview before commit. External Collection never changes it.
_Avoid_: Live catalog total, External Collection balance, custom price, Payment

**Merchant-Created Appointment**:
An Appointment entered directly by the Merchant Owner rather than confirmed through a customer Booking Party. Customer cancellation or reschedule cutoffs, Minimum Notice, and Booking Horizon do not restrict it. It may start outside current working time or overlap Blocked Time only after an explicit conflict warning and with an optional override reason preserved in Appointment history. Creation atomically invalidates any affected Time Slot Hold, but can never overlap another non-terminal Appointment because BeeSolo has one Owner-Provider. Only an Active Service may be newly selected. It otherwise preserves the same customer-visible service, price, time, Provider, and Customer Details snapshots as a customer-confirmed Appointment.
_Avoid_: Blocked Time, draft appointment, untracked calendar event, double booking

**Appointment Series**:
A merchant-created finite weekly recurrence plan relating two through fifty-two Appointments that retain independent operational lifecycles. It repeats on the original Shop-local weekday and clock time at an interval of one through eight weeks; never-ending, daily, monthly, multiple-weekday, and custom recurrence rules are outside launch. BeeSolo previews and materializes the complete finite set upfront: the Owner may adjust or exclude individual proposed occurrences, after which one atomic command creates every finalized Appointment or none. Occurrences outside current working time or across Blocked Time require one explicit preview confirmation and may share an override reason, while overlap with another non-terminal Appointment is a hard conflict that must be adjusted or excluded. Any nonexistent or ambiguous Shop-local time caused by a clock change is exposed and resolved in that preview, so every created member has an exact start instant and no occurrence remains floating for later generation. Creation queues one consolidated series confirmation rather than one message per member, while later reminders remain Appointment-specific. After creation, ordinary edits, reschedules, and cancellations target only one Appointment, which stays related to the series as an explicit exception without changing other members; BeeSolo offers no generic **This and Future Appointments** mutation. A customer acting through one Appointment's Confirmation can cancel only that Appointment under the ordinary customer policy. **Cancel Remaining Series** is an Owner-only bulk lifecycle action: it atomically cancels every still-Scheduled member while preserving Completed, No Show, and already-Cancelled members and queues one consolidated cancellation notice rather than one notice per member. One cancellation category, optional private note, and optional customer message govern that operation. When affected members have net External Collections, the Owner records per Appointment whether value was actually returned; matching Returned entries and all cancellations commit atomically, while unreturned value remains truthful history and never blocks cancellation. Series cadence and membership are immutable after creation: the Owner cannot extend a series or change its interval, and continuing or adopting another cadence requires a newly previewed Appointment Series. Later Schedule Rules, Blocked Time, Service, price, or catalog changes never move, reprice, regenerate, or cancel existing members; each preserves its snapshot and may independently become a Schedule Conflict under the ordinary rule. Consolidated creation and cancellation notices send by default when an eligible contact channel exists; **Don't Notify** requires explicit confirmation and a private suppression reason recorded across affected Appointment histories. Notification delivery failure never rolls back series creation, an individual Appointment command, or Cancel Remaining Series.
_Avoid_: Customer subscription, class series, one indivisible recurring appointment

**Appointment Status**:
The operational state of an Appointment: **Scheduled**, **Completed**, **Cancelled**, or **No Show**. Confirmation or Merchant creation creates a Scheduled Appointment; rescheduling changes its time rather than introducing another status. Only Scheduled may ordinarily become Completed, Cancelled, or No Show, and Complete or No Show is unavailable before the Appointment starts. A Cancelled Appointment can never be restored; a renewed commitment is a new Appointment. Completed and No Show may change only through an Appointment Outcome Correction and can never return to Scheduled.
_Avoid_: Booking session status, payment status, rescheduled

**Appointment Reporting Date**:
The Shop-local date used to attribute an Appointment to a report. Primary appointment reports use the Appointment's scheduled start and count each Appointment once with its latest status; activity reports use the timestamp of the cancellation, No Show, completion, or correction. The two attributions remain distinct, so an outcome change may appear in a different reporting period from the scheduled visit.
_Avoid_: browser date, export date, last-updated date as the only basis

**Report Filter Set**:
The launch reporting filters shared by the Merchant App: a required Shop-local date range and an optional Service selection, with appointment reports additionally filtering by current status and Appointment origin. Solo launch exposes no Shop or Provider filters because each Merchant has one of each; collection method remains a detail and export field rather than a global filter.
_Avoid_: team filter, browser date filter, provider availability filter

**Reporting Date Range**:
The Shop-local period selector for reports: it defaults to the last thirty calendar days including today and offers Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Year to date, and Custom. Custom may cover any retained period, and all boundaries use the Shop Reporting Timezone.
_Avoid_: browser date range, UTC-midnight period, rolling report without named boundaries

**Appointment Volume**:
The count of distinct Appointments whose scheduled start falls in the selected Shop-local period. Each Appointment is counted once using its latest status; finite Appointment Series members count individually, while Booking Sessions, Time Slot Holds, Waiting List Applications, Walk-in Entries, and Notification Intents do not count as Appointments.
_Avoid_: booking attempts, occupied slots, customer count, series count

**Appointment Outcome Rates**:
The launch rates for a service-period cohort with a terminal outcome. Cancellation Rate is Cancelled divided by Cancelled plus Completed plus No Show. No Show Rate is No Show divided by Completed plus No Show. Still-Scheduled Appointments are shown separately and excluded from both denominators.
_Avoid_: rate over all created records, payment conversion, future appointment rate

**Rebooking**:
A new, non-Cancelled Appointment for the same Customer Record that starts after a Completed Appointment and within ninety calendar days. The Rebooking Rate is calculated only for Completed Appointments whose ninety-day follow-up window has fully elapsed; other members of the same Booking Party or Appointment Series do not qualify.
_Avoid_: series continuation, duplicate booking, customer account return

**Appointment Outcome Correction**:
An explicit Owner correction between Completed and No Show when the recorded outcome was wrong. It requires a reason, advances the Appointment Revision, and preserves both the erroneous and corrected outcomes in history. It never restores a terminal Appointment to Scheduled.
_Avoid_: Ordinary status change, reopening, deleting history, new Appointment

**Complete Appointment**:
The Owner workflow that records a Scheduled Appointment as Completed once it has started. Because BeeSolo uses Pay In Person, the workflow defaults to also recording the full Appointment total as an External Collection with a selected method, but permits **Already Recorded** or **Collect Later**. When a new collection is entered, completion and the append-only collection entry commit atomically. Completed describes the service outcome and never by itself means paid.
_Avoid_: Capture Payment, paid status, receipt, automatic charge

**Record Completed Appointment**:
An explicit Owner action for entering one already-finished visit that was omitted at the time of service, such as an unrecorded walk-in. It creates the Appointment directly as Completed from required past start and end times, Customer Details, selected Services, a completion reason, and an External Collection choice, with Appointment History showing when and by whom it was recorded after service. Because terminal Appointments do not reserve time, a historical overlap requires a strong warning but does not block the record. It cannot manufacture a past Cancelled or No Show lifecycle and is not a bulk history-import path.
_Avoid_: Backdated Scheduled Appointment, data import, fake cancellation, fake No Show

**Cancel Appointment**:
The Owner workflow that irreversibly ends one Scheduled Appointment or explicitly selected still-Scheduled Appointments from its Booking Party. Cancellation releases occupied time and supersedes unsent reminders regardless of External Collection facts. When net collected value exists, the workflow asks whether value was actually returned and may atomically append a matching Returned External Collection entry; otherwise collection history remains unchanged and never blocks cancellation. Cancellation requires the Merchant-private category **Customer Requested**, **Merchant Unavailable**, **Duplicate or Error**, or **Other**; Other also requires a private note. Internal reasons never become customer-visible automatically, while a separate optional customer message may appear in the cancellation notification and Confirmation. Whole-party cancellation uses one reason and customer message for its atomic operation.
_Avoid_: Delete Appointment, automatic refund, restore Appointment, implicit whole-party cancellation

**Appointment Notification Choice**:
The Owner's explicit choice to queue or suppress the ordinary customer notification caused by Merchant creation, rescheduling, or cancellation. Sending is the default whenever the Appointment has an eligible contact channel; suppression requires deliberate confirmation and a reason preserved in Appointment history. Editing Customer Details sends no general update, but changing email mandatorily sends a fresh current-revision Confirmation after revoking old access, while removing email requires a No-Contact Exception. Completion, No Show, outcome correction, and External Collection do not automatically notify. Notification failure never rolls back the Appointment Command, and the capability-protected Confirmation view reflects the current Appointment Revision independently of delivery.
_Avoid_: Marketing consent, delivery guarantee, destination suppression, implicit silence

**Appointment Revision**:
The monotonic version of one Appointment used to prevent stale Merchant actions from overwriting newer facts. Every Appointment Command names the revision the Owner viewed; a stale command changes nothing and returns the latest Appointment for deliberate review. A command affecting multiple Appointments verifies every expected revision and commits all changes or none.
_Avoid_: Last-write-wins timestamp, UI cache version, Booking Party version

**Appointment Command**:
One Owner-authorized request to create or mutate Appointment facts. Every command has an idempotency key: replaying the identical command returns its recorded result without duplicating history or customer consequences, while reusing the key for different input is rejected. Commands never silently merge against a stale Appointment Revision.
_Avoid_: Form submission, audit event, last-write-wins update

**Appointment History**:
The immutable, Owner-visible sequence of successful Appointment Commands. Each entry records command and operation identity, actor and any impersonating System Operator, timestamp, prior and resulting Appointment Revision, changed before-and-after facts, supplied or required reason, and Appointment Notification Choice where relevant. Whole-party cancellation writes one entry per affected Appointment linked by one operation identity; idempotent replay adds nothing. Customers see only current customer-visible Appointment facts, never Merchant-private reasons, actors, the complete history, or External Collection details. Rejected commands belong only in appropriate security or operational telemetry, not Appointment History.
_Avoid_: Customer timeline, mutable notes, application log, audit-event replacement

**Edit Appointment**:
An Appointment Command that changes only the snapshotted Customer Details or optional customer note. Any change to start time, selected Services, duration, Service Buffers, or customer-visible total is a Reschedule Appointment instead; a destination change supersedes unsent old-destination work, revokes old Confirmation access, mandatorily confirms a new email, rebuilds the future Reminder, and never transfers mobile permission.
_Avoid_: Reschedule Appointment, catalog edit, customer profile update

**Reschedule Appointment**:
An Appointment Command that atomically replaces one Scheduled Appointment's time, selected Services, duration, resolved Service Buffers, or customer-visible total after validating the complete replacement occupied interval. Merchant rescheduling is not constrained by customer policy cutoffs, Minimum Notice, or Booking Horizon; outside-hours or Blocked-Time placement requires the same explicit conflict warning as Merchant creation, overlap with another non-terminal Appointment remains forbidden, and affected Time Slot Holds are invalidated atomically. A time-only reschedule may preserve an already snapshotted inactive Service, but it cannot newly select one. The original Appointment remains intact until commit, and the successful replacement advances its Appointment Revision and preserves before-and-after history. BeeSolo exposes no Provider reassignment because the Owner is its sole Provider.
_Avoid_: Edit Appointment, Reassign Appointment, Rescheduled status, cancel-and-rebook

**Confirmation**:
The customer-visible current Appointment summary and status view derived only after an Appointment exists. For a customer Booking Party, it appears only after the party atomically creates all of its Appointments; while external settlement or local commitment is unresolved, the customer sees Processing rather than partial Appointments. A Merchant-Created Appointment may issue the same capability-protected view when the Owner chooses to notify an eligible contact destination. Payment facts are shown only from Payments, and External Collection remains Merchant-private.
_Avoid_: Sale order, receipt-only page

**Confirmation Access Token**:
A secret issued for an Appointment that grants a customer limited access to its current Confirmation without requiring a customer account. Changing only customer name or note preserves access; changing email or phone atomically revokes every existing grant, a new email mandatorily receives a fresh current-revision link, and mobile permission never transfers to another number. Ordinary reschedule, cancellation, completion, No Show, or outcome correction preserves access so the same secure link displays current customer-visible facts.
_Avoid_: Booking session capability, customer login, appointment ID

**Browser Active Bookings**:
The device-and-browser-local list of a customer's active Appointments on one Merchant's Public Booking Page, reconstructed from opaque Appointment access capabilities retained by that browser rather than stored Appointment details, guessable identifiers, a Customer Account, or public search. Successful booking records the resulting capabilities, and opening a valid Confirmation link on another browser records that Appointment there. Only currently active Appointments appear; terminal Appointments leave the list even while their underlying access may remain valid under its own retention rule. Clearing browser data or changing browser or device loses the local list and never triggers a replacement transactional notification.
_Avoid_: Customer Account bookings, public appointment lookup, notification recovery email, server-side identity dashboard

**Customer**:
The person for whom an appointment is booked.
_Avoid_: User, account, customer profile

**Customer Details**:
The unverified name, email, and optional phone captured and snapshotted for an Appointment. A future customer-confirmed Appointment requires valid email, while an Owner-created Appointment may omit it only through a recorded No-Contact Exception; Walk-in enrollment may still use name alone, and Customer Record edits never rewrite earlier Appointment snapshots.
_Avoid_: Customer account, identity profile

**No-Contact Exception**:
The Owner's explicit acknowledgement that a Merchant-Created Appointment has no email destination after BeeSolo warns that essential Transactional Email cannot be sent. The Appointment still commits, while its Reminder uses eligible permitted mobile delivery or becomes **Not Sent — no eligible destination**.
_Avoid_: Don't Notify, invalid email, delivery failure, marketing opt-out

**Customer Account**:
An optional platform-wide verified identity that may be referenced by a Booking Party coordinator or guest without replacing snapshotted Customer Details or capability-based anonymous access. Merchants can access only facts arising from their own customer interactions.
_Avoid_: Customer Details, Customer Directory, Merchant Member, cross-merchant profile

**Customer Directory**:
The Merchant-private collection of reusable Customer Records built from that Merchant's customer interactions. It supports finding and reusing customers without requiring Customer Accounts or creating a cross-Merchant identity. Search covers preferred and previously observed names, normalized emails, and normalized phone numbers within that Merchant; historical details may locate a record but are labelled and never selected automatically for contact. Ordinary results exclude Archived Customer Records and absorbed merge aliases. Result summaries expose preferred details, possible-duplicate and ban state, last visit, next Appointment, and aggregate visit, No Show, and cancellation counts without claiming verified lifetime spend.
_Avoid_: Customer account, cross-merchant directory, CRM

**Customer Record**:
A durable identity local to one Merchant that groups observations from Appointments, Waiting List Applications, and Walk-in Entries while holding the Merchant's current reusable customer facts. Public booking links it atomically with Appointment confirmation; Merchant Appointment creation, Waiting List admission, and Walk-in Enrollment each match or create and link it in their own transaction, while abandoned Booking Sessions, Preview Mode, quotes, and Time Slot Holds create nothing. Automatic attachment succeeds only when a normalized email or phone identifies exactly one record and every other supplied identifier is absent or non-conflicting; a name alone never matches, ambiguity creates a possible duplicate, and only the Owner may confirm a merge. Linked activity contributes immutable observations without silently replacing preferred details or rewriting its own historical Customer Details snapshots.
_Avoid_: Customer Account, Appointment snapshot, cross-Merchant customer identity

**Customer Record Merge**:
The Owner-confirmed, auditable, and irreversible consolidation of one Merchant's duplicate Customer Records into a chosen survivor. Appointment links and observations move to the survivor without changing Appointment snapshots; distinct contact points and chronological Merchant Notes are preserved; the Owner chooses the current preferred Customer Details; consent evidence remains bound to its original destination, purpose, and time rather than broadening through the merge; and the strictest active Customer Ban governs the survivor. The absorbed record becomes a non-searchable merge alias so historical references resolve. Correcting a mistaken merge requires an explicit split workflow rather than editing merge history.
_Avoid_: automatic deduplication, Appointment rewrite, cross-Merchant merge

**Customer Record Split**:
The ordinary Owner-controlled, audited recovery from a mistaken Customer Record Merge. It creates a new Customer Record without erasing the merge event, after the Owner previews and assigns Appointment links, observations, contact points, and Merchant Notes between the resulting records. Consent Evidence follows its exact destination, Appointment snapshots remain unchanged, and any active Customer Ban initially governs both records until the Owner explicitly reviews it. A proven Privacy Request may instead use the narrower Privacy Identity Partition without Merchant approval.
_Avoid_: merge deletion, snapshot rewrite, silent unlinking

**Privacy Identity Partition**:
A System Operator's narrow, audited separation of the identity boundary proven by a Privacy Request when a mistaken merge combines more than one person. It assigns only proven Appointments, observations, contacts, consent, and notes to a new Customer Record, preserves snapshots and merge provenance, and quarantines uncertain data from disclosure; `privacy-request:review` authorizes the partition and `privacy-request:erase` additionally authorizes erasing it. It is an exception to Owner-only Customer Record Split, not authority for ordinary deduplication or preference choices, and the Merchant receives only the resulting directory-correction notice.
_Avoid_: operator deduplication, Merchant-approved privacy request, whole-record disclosure

**Booking Note**:
Optional customer-supplied text for one Appointment, preserved in its snapshots and visible to the Merchant Owner and through that Appointment's customer Confirmation. It never becomes a Merchant Note or a general intake response, and it grants neither consent nor permission.
_Avoid_: Merchant Note, intake form, consent evidence

**Merchant Note**:
Private Customer Record text written by the Merchant Owner, with authorship and created or edited times preserved in an audit trail. It is never shown or sent to the Customer and cannot stand in for consent, a Customer Ban, or structured medical, payment, or intake data.
_Avoid_: Booking Note, customer message, consent evidence, ban reason

**Customer Ban**:
A private Merchant-scoped restriction, applied indefinitely or until an explicit expiry, that blocks new public bookings, Waiting List entries, and Walk-in Queue joins when BeeSolo uniquely matches the Customer Record. It requires a private reason and auditable authorship; a ban applied after Waiting List admission supersedes any Pending offer and pauses further offers without exposing the reason, while lifting before application expiry restores eligibility. Existing Appointments remain unchanged, and only the Owner's explicit reasoned Appointment creation may bypass the ban.
_Avoid_: platform-wide blocklist, Customer Account suspension, Appointment cancellation

**Archived Customer Record**:
A reversible Customer Record state excluded from ordinary directory search and reuse while preserving its data and Appointment relationships. It remains eligible for private exact-contact matching: a uniquely matched confirmed public booking automatically restores it before contributing the new observation, while ambiguity or conflict creates a separate possible duplicate. A Merchant-created Appointment requires the Owner to restore and select it explicitly. A Customer Ban takes precedence, and archiving is neither privacy erasure nor a way to bypass a ban.
_Avoid_: deleted customer, anonymized Appointment, banned customer

**Customer Data Erasure**:
An irreversible, resumable privacy operation that first quarantines a Customer Record from matching and suppresses unsent communication, then executes a fixed manifest of in-scope authoritative records, snapshot fields, generated artifacts, caches, notification destinations, and provider deletion obligations. Each unheld target is anonymized or deleted idempotently with durable evidence; partial failure remains **Executing** and never rolls erased data back, while held targets stay isolated until their holds clear. Completion requires a post-erasure scan showing that prohibited personal values are absent from searchable or deliverable storage. The operation removes preferred details, contact points, Merchant Notes, preferences, and private ban reason and irreversibly anonymizes personal Customer Details in historical Appointments while preserving non-personal time, Service, price, lifecycle, collection, and audit facts. A minimal non-identifying tombstone may preserve idempotency, audit linkage, and permitted suppression or active-ban fingerprints without retaining erased values. The erased Customer Record can never be restored or linked to a later interaction; a later booking creates a fresh record with fresh observations and consent choices.
_Avoid_: Archive Customer Record, Appointment correction, silent hard delete

**Customer Data Correction**:
An approved Privacy Request mutation that prospectively changes preferred Customer Details after any replacement email or phone passes exact-destination verification. The incorrect contact becomes **Disputed** or **Superseded** and is excluded from matching, search, and communication; historical Appointment snapshots stay unchanged unless the requester explicitly selects future Scheduled Appointments for the existing audited destination-change workflow. Removing personal data from completed history is Customer Data Erasure, and correction never silently changes consent, queued Notifications, Confirmation access, bans, Merchant Notes, or another Customer Record.
_Avoid_: ordinary directory edit, silent snapshot rewrite, consent transfer

**Customer Data Retention**:
The fixed launch policy that keeps identifiable Customer Record and Appointment customer data until thirty-six months after the latest customer interaction, provided no future Appointment, Waiting List entry, Walk-in Queue entry, active Customer Ban, or retention hold requires it. Each new interaction restarts the clock; expiry automatically performs Customer Data Erasure, while the Owner may request earlier erasure. Consent or withdrawal evidence remains for three years after the permission ends or its last use, whichever is later, after which only a necessary non-contactable suppression fingerprint may remain; an active ban's matching fingerprint remains until the ban ends. Non-personal Appointment and financial facts follow their own retention rules. The shorter twelve-month Merchant-level deletion boundary after Restricted Access wins unless a valid hold applies, and launch offers no arbitrary retention extension.
_Avoid_: indefinite customer history, Merchant-configurable legal policy, archive period

**Retention Hold**:
A narrowly scoped legal or dispute requirement that temporarily preserves named records or data classes otherwise eligible for Customer Data Erasure. Creating, renewing, narrowing, or releasing it requires the separate `governance:retention-hold` Operator Permission plus a reason, authority or case reference, responsible operator, and review or expiry date; privacy reviewers may inspect but never override it. Unheld data is erased while held data stays isolated, and the Privacy Request remains **Executing** until the hold clears and residual erasure completes.
_Avoid_: indefinite preservation, Merchant retention preference, privacy-reviewer delay

**Provider Preference**:
The customer's choice of either a specific provider or any eligible provider during a booking session.
_Avoid_: Staff preference, barber selection

**Specific Provider**:
A provider preference where the customer chooses one provider before availability.
_Avoid_: Specific staff, specific barber

**Any Provider**:
A provider preference where the customer chooses any eligible provider before availability.
_Avoid_: Any staff, any barber

**Paying Customer**:
The payer for a booking when payment behavior needs to distinguish the payer from the appointment customer.
_Avoid_: Default synonym for customer

**Cart**:
Legacy source wording for a booking session.
_Avoid_: Canonical entity name

**Sale Order**:
Legacy source wording for the checkout result and confirmation payload.
_Avoid_: Canonical entity name

**Payments**:
A bounded context for collected or refunded value, provider integration, and payment lifecycle behavior during booking and gift-card sale.
_Avoid_: Billing, sales ledger

**Payment**:
The aggregate for value collected from or refunded to one payer through the platform against an accepted Pricing Quote, with explicit allocations and one or more Payment Attempts. Pay In Person creates no Payment; any later External Collection remains separate.
_Avoid_: Checkout, sale order, unpaid appointment, payment intent

**External Collection**:
A Merchant-entered, append-only record that value was collected or returned outside the platform for one Appointment, such as by cash or a separate card terminal. Each entry records a positive amount in the Appointment currency, method, actual collection time, actor, and optional note or reference; correcting an error requires an offsetting entry and reason rather than edit or deletion. Multiple and partial entries are allowed, but net collected value stays between zero and the Appointment's snapshotted total, so launch records neither tips nor overpayment. Complete Appointment normally offers an atomic full-total collection entry, while **Already Recorded** and **Collect Later** preserve the distinction between service outcome and collected value. An entry may follow any Appointment Status because value movement and operational outcome are independent. It is not a verified Payment and never triggers platform settlement or refund behavior.
_Avoid_: Payment, Payment Attempt, Pay In Person status

**External Collection Reporting**:
The financial view that keeps an Appointment Price Snapshot, net External Collections, and Returned External Collections as separate facts. Net External Collections are Owner-recorded off-platform amounts and are explicitly unverified; an indicated difference from the Appointment Price Snapshot is not verified debt or revenue. BeeSolo launch reporting does not present these facts as platform revenue, Payments, or settlement.
_Avoid_: Revenue report, payment report, verified sales, platform settlement

**Payment Attempt**:
One idempotent attempt to authorize, capture, or refund value through a payment method or provider. Provider-specific intent identifiers are references on an attempt, not canonical payment entities.
_Avoid_: Payment, payment intent, checkout attempt

**Payment Status**:
The derived lifecycle of a Payment: **Pending**, **Authorized**, **Partially Captured**, **Captured**, **Partially Refunded**, **Refunded**, or **Cancelled**. It derives from successful monetary transactions; failed provider operations remain facts of their Payment Attempts.
_Avoid_: Appointment status, checkout status, directly assigned status, Failed

**Gift Card Product**:
Merchant-configured rules for selling gift-card value, including permitted amounts, currency, and Brand, Shop, or Provider scope.
_Avoid_: Service, issued gift card

**Gift Card Sale**:
The purchase aggregate for one Gift Card, preserving purchaser, recipient, product, amount, currency, and Payment references. Its lifecycle is **Pending Payment**, **Issuing**, **Issued**, **Cancelled**, or **Refunded**; captured value issues exactly one Gift Card idempotently.
_Avoid_: Appointment, booking party, sale order

**Gift Card**:
An issued stored-value instrument whose scope and currency are fixed at issuance, whose status is **Active**, **Suspended**, **Expired**, or **Voided**, and whose available balance derives from its immutable value ledger. A zero balance does not introduce a separate status.
_Avoid_: Gift Card Product, promo code, payment method token

**Gift Card Redemption**:
A value-ledger transaction reserved for a Booking Party and then atomically committed or released. Committed redemptions cannot exceed the Gift Card's available balance or cross its currency and scope.
_Avoid_: Promo code, discount, mutable balance deduction

**Waiting List Application**:
A customer's durable request for one exact Primary Service and Additional Service set and one continuous Shop-local window of at most 31 calendar days inside the Booking Horizon, implicitly targeting and snapshotting BeeSolo's sole Owner-Provider. A new-booking application preserves original Service facts without freezing a quote, requires a name and valid email, allows phone as optional Customer Directory data, and has lifecycle **Active**, **Fulfilled**, **Withdrawn**, **Removed**, **Expired**, or **Superseded**; one Active application is allowed per matched Customer Record and Shop, FIFO spans both purposes, only a confirmed Appointment fulfills it, and notifications are email-only at launch.
_Avoid_: Booking Session, appointment, walk-in entry

**Replacement Waiting List Application**:
A Waiting List Application created through a Scheduled Appointment's protected Confirmation for one exact replacement window while preserving the original Appointment. At most one may be Active per source Appointment; it inherits that Appointment's revisioned Service, duration, buffer, and agreed-price snapshots, is fulfilled only by an atomic purpose-bound time-only reschedule, and becomes Superseded when the source changes or stops being customer-reschedulable.
_Avoid_: Reschedule Session, new-booking application, tentative reschedule

**Waiting List Status Access**:
An application-scoped protected customer view of one Waiting List Application's exact request, lifecycle, deadline, and Pending offer, with Withdraw as its application mutation and no numeric position or wait estimate. It lasts through the Active lifecycle and thirty days after terminal outcome; secure reissue to the exact application email revokes prior access and cannot enumerate applications, while temporary pause reasons remain generic so bans and Merchant-internal state are never exposed.
_Avoid_: Confirmation, Customer Account, public waiting list

**Waiting List Admission**:
The Shop-level setting, explicit Active Service subset, and Active-application cap that together permit a new Waiting List Application when the Public Booking Page is effectively bookable and no matching Time Slot currently exists in the requested window. Admission defaults to Disabled, no eligible Services, and a cap of fifty configurable from one to two hundred; later changes affect only new admission, while an Inactive Service pauses new-booking offers and closed publication, readiness, or subscription gates pause all new offers.
_Avoid_: Waiting List Application status, Availability Offer status, Walk-in Enrollment

**Availability Offer**:
A purpose-limited sequential offer of one eligible Time Slot to one Waiting List Application, with lifecycle **Pending**, **Accepted**, **Declined**, **Expired**, or **Superseded**. Issuance atomically creates its urgent email intent and starts a fixed fifteen-minute response window; an unconverted outcome returns the application to Active without losing FIFO age, but that attempted exact slot is never offered to the application again.
_Avoid_: Availability, appointment, confirmation

**Waiting List Ordering Override**:
An Owner action that selects a later eligible Waiting List Application for one specific opening instead of the FIFO application. It requires a private reason and audit history but cannot change the request, bypass eligibility or conflicts, extend the offer window, or create concurrent offers.
_Avoid_: Priority ranking, VIP status, manual booking

**Remove Waiting List Application**:
The Owner action that terminally ends an Active Waiting List Application as Removed with a required reason and audit history. It does not edit the customer's request or misrepresent the outcome as customer withdrawal.
_Avoid_: Withdraw Waiting List Application, edit request, delete application

**Waiting List History**:
The immutable chronology of successful Waiting List admission, offer, response, override, removal, conversion, supersession, and expiry changes with actor, revision, reason, and linked lifecycle identities. Background scans that make no domain change are operational telemetry rather than Waiting List History.
_Avoid_: application log, scan log, mutable status note

**Waiting List Conversion Metrics**:
The admission-cohort funnel for Waiting List demand: applications admitted, offers issued, offers accepted, confirmed Appointments, and terminal outcomes by reason. For matured cohorts, Application Conversion is confirmed Appointments divided by terminal applications; still-Active applications remain visible but are excluded from the denominator. New-booking and Replacement Waiting List Applications are reported separately, with offer-acceptance and accept-to-confirmation durations alongside conversion.
_Avoid_: point-in-time active-demand rate, offer count as booking count, immature cohort rate

**Walk-in Queue**:
The Shop-scoped FIFO view and configuration boundary for active Walk-in Entries; only Waiting entries have numbered positions, while at most one entry may be Called and one may be Serving. It is not one contention-heavy aggregate, and exceptional Owner reordering of Waiting entries remains explicit history on the affected entries.
_Avoid_: Waiting list, appointment calendar, booking session

**Walk-in Enrollment State**:
The Walk-in Queue's admission state, either **Open** through an explicit Owner action or **Closed** manually or by a safety condition. Closed stops new Walk-in Enrollment without discarding active Walk-in Entries, and BeeSolo never opens the queue automatically.
_Avoid_: Shop opening hours, queue status, Walk-in Entry status

**Shop Presence Capability**:
A fifteen-minute, single-Shop proof obtained from the rotating onsite QR code or code displayed while Walk-in Enrollment is Open; a successful enrollment consumes it, and any open or close transition invalidates prior codes. It permits self-enrollment without identifying or geolocating the customer and grants no access to another Walk-in Entry.
_Avoid_: Customer Account, GPS verification, permanent walk-in link

**Walk-in Enrollment**:
The act of admitting a physically present customer directly into Waiting, either through customer self-enrollment with a Shop Presence Capability or through Owner-assisted enrollment in the Merchant App, while conservatively matching or creating and linking a Merchant-scoped Customer Record. It is not an approval request: an eligible self-enrollment joins immediately after ordinary admission checks succeed, and a name without exact contact never matches an existing record.
_Avoid_: Waiting List Application, booking request, approval queue

**Walk-in Wait Estimate**:
An advisory, non-persisted projection of when a Walk-in Entry may begin service, derived from the sole Owner-Provider's current queue workload, scheduled commitments, and scheduling constraints. Customer-facing estimates are rounded rather than presented as promised start times.
_Avoid_: Time Slot, appointment start time, service guarantee

**Walk-in Wait Metrics**:
The reporting measures for the Walk-in Queue: actual wait runs from Walk-in Enrollment to Start Walk-in Service, with median, p90, and maximum reported for entries that reach service; Removed and Expired entries are excluded from wait-time calculations but counted as terminal outcomes. Estimate error compares Walk-in Wait Estimate with actual start, Start-to-Finish service duration is separate, and queue length is reported separately from wait time.
_Avoid_: Called-to-start only, promised wait, Appointment duration as wait

**Walk-in Status Access**:
An entry-scoped protected customer view of one Walk-in Entry's Services, lifecycle, position, and Walk-in Wait Estimate, with Leave Queue as its only mutation. It reveals no other customer's identity or request and is recovered or reissued only with Owner assistance.
_Avoid_: Confirmation, Customer Account, public queue

**Walk-in Entry**:
An independently mutable aggregate representing a physically present customer's request to join a Walk-in Queue with a snapshotted Primary Service and optional Additional Services, contact details, join time, and ordering facts; BeeSolo's sole Owner-Provider is implicit and remote demand belongs to the Waiting List. Its lifecycle is **Waiting**, **Called**, **Serving**, **Served**, **Removed**, or **Expired**; Called assigns the next service opportunity without promising an immediate start, only Start Walk-in Service creates an Appointment, and terminal states never reopen.
_Avoid_: Appointment, waiting-list application, time-slot hold

**Leave Queue**:
The protected customer action that moves their Waiting or Called Walk-in Entry to Removed with customer-left provenance. A Serving entry cannot leave the queue because its linked Appointment already governs the service outcome.
_Avoid_: Cancel Appointment, withdraw Waiting List Application, expire entry

**Start Walk-in Service**:
The Owner action that atomically moves a Called Walk-in Entry to Serving and creates its linked Scheduled Appointment at the actual start instant; overlap with another non-terminal Appointment is forbidden, while working-time or Blocked Time conflicts require an explicit override reason. The Walk-in Entry and Appointment retain their separate identities and histories.
_Avoid_: Call Walk-in, confirm booking, queue status change

**Finish Walk-in Service**:
The Owner action that atomically moves a Serving Walk-in Entry to Served and completes its linked Appointment with the ordinary External Collection choice. It records actual service completion rather than merely removing someone from the queue.
_Avoid_: Complete queue entry, remove walk-in, appointment creation

**Abort Walk-in Service**:
The Owner action that atomically moves a Serving Walk-in Entry to Removed and cancels its linked Appointment under the ordinary cancellation and External Collection rules. It preserves the attempted service interval without falsely reporting the customer as Served.
_Avoid_: Finish Walk-in Service, remove queue entry, No Show

**Cancellation Policy**:
The versioned Merchant rules snapshotted at confirmation that determine whether and how an Appointment or whole Booking Party may be cancelled.
_Avoid_: Appointment status, refund policy, mutable eligibility flag

**Refund Policy**:
The versioned monetary rules snapshotted at confirmation that determine refund entitlement from an Appointment's allocated Pricing Quote and Payment facts. A due refund becomes an idempotent Payments obligation and does not control whether cancellation commits.
_Avoid_: Cancellation Policy, provider refund result, appointment status

**Reschedule Session**:
A purpose-limited attempt to replace a Scheduled Appointment's time or Provider while preserving the original Appointment until commit. Commit atomically applies the held replacement and records history; failure or expiry leaves the original unchanged.
_Avoid_: Booking Session, new appointment, Rescheduled status

**Checkout Path**:
The payment timing and collection path applied to a Booking Session. A customer may select it when more than one path is available, but the first slice applies Pay In Person automatically.
_Avoid_: Checkout Choice, Payment Intent, checkout type

**Checkout Policy**:
The versioned checkout rules and disclosures a Merchant applies to new Booking Parties, including the permitted Checkout Paths. It is distinct from customer selection and provider configuration.
_Avoid_: Customer selection, payment-provider configuration, terms checkbox

**Policy Acceptance**:
Immutable evidence that a Booking Party's coordinating customer accepted an exact Checkout Policy version and disclosure snapshot at a recorded time. One acceptance covers the party transaction but grants no consent on behalf of its guests.
_Avoid_: Marketing consent, notification preference, mutable checkbox state

**Marketing Consent**:
A person-specific, optional permission for promotional communication. It is separate from Policy Acceptance and is never inferred for guests from the coordinating customer's choice.
_Avoid_: Policy acceptance, operational notification permission

**Customer Activity History**:
The chronological Merchant view from one Customer Record across linked Appointments, Walk-in Queue and Waiting List activity, Merchant Notes, destination-specific evidence, merges, and privacy actions. Booking Notes remain attached to their individual Appointments. Financial facts show Appointment prices and recorded External Collections without presenting them as verified lifetime spend. Merchant Notes are available within record detail but excluded from directory-wide free-text search.
_Avoid_: Appointment snapshot, verified payment history, global notes search

**Customer Directory Import**:
An idempotent, preview-before-commit ingestion of a versioned CSV containing customer name, optional email, optional phone, and optional source-system reference. The preview exposes invalid rows, normalized values, exact matches, conflicts, and possible duplicates. Commit creates Customer Records only: it may fill an empty preferred field on one exact unique contact match but never overwrites an existing preferred value; ambiguous or conflicting rows remain separate possible duplicates; and name-only rows never match automatically. It creates no historical Appointment, Booking Note, Merchant Note, Customer Ban, consent, or messaging permission, and retains the uploaded file only as long as processing and recovery require.
_Avoid_: Appointment import, consent migration, silent bulk merge

**Customer Directory Export**:
An Owner-authorized operational export of the Merchant's Customer Records, preferred and historical contact points, mobile permission and suppression state, Merchant Notes, ban state, activity summaries, and stable Appointment references. BeeSolo produces it asynchronously as an encrypted, short-lived download and records an audit event; it never emails the export automatically.
_Avoid_: customer-facing privacy response, public download, verified payment report

**Customer Data Package**:
A beesolo-reviewed Privacy Request export for one Customer Record containing the person's Customer Details observations, Booking Notes, Appointment and customer activity, mobile permission and suppression state, and Consent Evidence. It excludes Merchant Notes, private ban reasons, security signals, other customers' data, internal audit metadata, and secrets. The point-in-time package provides a human-readable HTML index plus machine-readable JSON and CSV files, is encrypted at rest, and has no public object URL or email attachment. A notification to the verified destination carries no bearer download capability; fresh exact-destination verification creates a fifteen-minute case-scoped download session. The artifact expires after seven days and may be regenerated from then-current retained data before the request deadline. Generation, notification, verification, completed download, expiry, and regeneration are separate delivery evidence; failure or expiry never silently completes delivery. Merged records produce one package with merge provenance, and erased values never reappear.
_Avoid_: Customer Directory Export, automated email disclosure, unreviewed subject-access response

**Privacy Request**:
A customer request for access, correction, or Customer Data Erasure submitted through beesolo's public privacy surface without requiring a Customer Account. Intake, exact-destination verification, and deterministic preflight may proceed automatically, but a System Operator must approve every data-package release or mutation; ambiguous contact points, shared destinations, merge or split history, active holds or bans, and conflicting evidence require enhanced review and proportionate additional verification. The customer identifies the Merchant and proves control of an exact Customer Record email address or phone number through a one-time code; a Confirmation Access Token proves access only to its Appointment and cannot authorize the whole record. A correction changes preferred Customer Details prospectively and marks an incorrect historical contact point disputed or superseded so it is excluded from matching, search results, and communication without silently rewriting Appointment snapshots. Removing that value from history invokes the audited privacy-erasure mechanism while retaining non-personal Appointment facts. Existing Confirmation access and queued notifications follow the Appointment destination-change rules rather than changing implicitly across every linked Appointment. beesolo previews retention holds and executes the request without Merchant approval, audits each step, and gives the Merchant only the minimum necessary correction or erasure notice.
_Avoid_: Merchant-approved deletion, Customer Account setting, Appointment-link deletion

**Privacy Request Intake**:
The bilingual, public, accountless receipt of an **Access**, **Correction**, or **Erasure** request after Turnstile, linked from the Public Site, every Public Booking Page, confirmation view, and privacy notice. Before verification it collects only the request type, Merchant booking-page URL or exact public slug, one email address or phone number, and preferred language—never an explanation, replacement value, Appointment detail, or document. Receipt immediately creates a **Submitted** Privacy Request Case and starts its deadline before identity verification; the requester then has seventy-two hours to complete exact-destination verification, after which an unverified case becomes **Expired** without revealing whether a Customer Record exists.
_Avoid_: verified-only receipt date, support email, Customer Account form

**Privacy Request Authority**:
The controller–processor boundary under which the Merchant remains controller for Merchant-scoped Customer Records and Appointment customer data and its accepted Data Processing Agreement gives beesolo standing documented instructions to process Access, Correction, and Erasure without case-by-case Merchant approval. beesolo is independently controller only for its own security, operator-access, abuse-prevention, and legally required audit data; launch requires counsel-approved controller details, Data Processing Agreement, public privacy notice, retention schedule, and rejection language.
_Avoid_: Merchant case approval, beesolo ownership of Merchant customer data, undocumented processor action

**Privacy Request Proof**:
The capability-based evidence used to authorize one Privacy Request without creating a Customer Account: exact-destination one-time-code verification, strengthened when risk requires by a linked Confirmation Access Token, proof of another historical destination, or evidence spanning multiple relevant Appointments. It never grants general customer login or cross-Merchant access; beesolo does not collect government identity documents, selfies, or payment data for launch verification, and inconclusive evidence is rejected without confirming whether a Customer Record exists.
_Avoid_: Customer Account, identity-document archive, Confirmation Access Token alone

**Verification Delivery**:
The provider-neutral, platform-funded security capability that sends Privacy Request one-time codes by essential email or plain SMS. It is separate from Appointment Notifications, WhatsApp routing, Merchant Messaging Balance, reporting, and consent; it retains purpose-bound delivery evidence and requires live SMS-route qualification in production while remaining safely unavailable or test-only when no local provider is configured.
_Avoid_: Operational Notification, Chargeable Delivery, WhatsApp verification

**Privacy Request Abuse Control**:
The existence-hiding protection around public Privacy Request intake: Turnstile precedes code sending; responses never reveal Merchant, destination, or Customer Record existence; codes expire after ten minutes, allow five attempts, and supersede earlier codes; one Merchant-and-destination fingerprint permits three sends per hour, six per day, and at most three open cases, with compatible verified duplicates coalesced. Rate-limit keys are rotatable keyed fingerprints, network limits remain configurable, and suspicious activity raises a risk flag without preventing an authorized operator from admitting a legitimate separately verified request. A reviewer may reject a manifestly unfounded or excessive request only with a recorded reason and non-disclosing requester notice; launch charges no fee.
_Avoid_: account lockout, existence-revealing error, permanent IP ban

**Privacy Request Lifecycle**:
The audited progression **Submitted**, **Awaiting Verification**, **Queued for Review**, **Awaiting Additional Evidence** or **Approved**, **Executing**, and **Completed**, with **Rejected**, **Withdrawn**, and **Expired** as terminal alternatives. beesolo targets completion within fourteen calendar days while tracking the governing one-month response deadline from initial receipt; only an explicitly authorized System Operator may record a justified extension, rejection, or additional-evidence request, none of which silently pauses that deadline. Access completes only after an approved package exists and its availability notice is delivered; Correction completes after approved mutations and destination or Notification effects reconcile and its notice is delivered; Erasure completes only after every manifest and provider obligation, every hold, the post-erasure scan, and its notice finish. An unresolved required notice, hold, provider deletion, retry, or scan keeps the case **Executing**; Merchant-notice failure remains operational attention without blocking completion.
_Avoid_: support-ticket status, untracked manual review, verification-started deadline

**Privacy Request Withdrawal**:
The requester's instruction to stop a Privacy Request: before approval it ends the case, an approved Access withdrawal revokes and deletes its undownloaded package, and an Erasure withdrawal before the first mutation releases quarantine. After any correction or erasure mutation commits, beesolo never recreates deleted or superseded data; it stops remaining uncommitted work where safe, prevents held data from later erasure under that request, and records **Withdrawn — partial irreversible execution** with a precise requester notice. A later request creates a new case rather than reopening the withdrawn one.
_Avoid_: rollback erased data, reopen case, silent partial completion

**Privacy Request Notice**:
A localized, delivery-evidenced communication to the verified request destination for receipt, verification outcome, additional-evidence need, deadline extension, material hold or execution delay, completion, rejection, withdrawal, or expiry. It carries no attachment or unnecessary personal value; an extension states its reason and new deadline, completion states what was acted on or retained, and rejection states a clear reason category plus complaint and judicial-remedy information. Required-notice delivery failure creates operator attention and is never recorded as successful communication.
_Avoid_: best-effort notification, privacy-package attachment, Merchant notice

**Privacy Request Case**:
The revisioned operational record for one Privacy Request and its proof, deadlines, risk flags, decisions, execution, delivery, and audit references. Its masked queue summary is ordered by approaching deadline and risk; personal data and decisions require an exclusive thirty-minute renewable operator claim, with reasoned takeover, automatic inactivity release, current-permission checks, optimistic concurrency, and idempotent transitions.
_Avoid_: shared spreadsheet row, permanent operator assignment, unclaimed data view

**Privacy Request Preflight**:
The immutable, revision-bound review snapshot that scopes one Privacy Request approval to its verified identity, risk flags, Customer Record graph and provenance, holds, bans, future activity, queued Notifications, artifacts, provider obligations, governing policy, and source-data revision. It previews the exact Access package and exclusions, Correction mutation plan, or Erasure manifest and retained facts; any relevant identity, hold, destination, merge, Appointment, or policy change invalidates approval and returns the case to review rather than silently changing its effect.
_Avoid_: live mutable approval, generic operator consent, stale export preview

**Privacy Request Audit Trail**:
The immutable, value-minimized three-year history of Privacy Request intake, verification outcomes, risk flags, claims and takeovers, sensitive-data reveals, evidence exchanges, decisions, lifecycle changes, correction or erasure steps, holds, delivery, Merchant notices, retries, and recovery. It retains stable non-identifying actor, case, and affected-record references, event and state facts, permission and policy versions, reason codes, and outcomes while excluding raw customer values, one-time codes, package contents, provider payloads, and free-text evidence. Verification secrets expire immediately after use or timeout; request free text and direct delivery destinations are purged thirty days after terminal resolution, and customer display data is redacted without destroying audit attribution.
_Avoid_: application log, retained privacy package, personal-data archive

**Privacy Action Ledger**:
A value-free recovery authority outside the primary Merchant-data restore boundary that records approved corrections, quarantines, erasures, active holds, and their completion state. After any point-in-time restore, beesolo remains in maintenance mode until it replays ledger actions absent from the restore point, invalidates expired packages, retries outstanding provider obligations, and passes the post-erasure scan; a restored value never becomes searchable, deliverable, or writable merely because backup history predates its privacy action.
_Avoid_: D1 backup, duplicate customer archive, best-effort restore checklist

**Merchant Privacy Notice**:
A minimum-necessary operational notice emitted after an approved Customer Data Correction changes Merchant-visible current details or future Appointments, and at Customer Data Erasure quarantine and completion when upcoming Appointments or active queue entries are affected. It uses opaque references and safe Merchant App links and reveals no old or replacement contact value, request proof, private reason, operator identity, hold detail, or downloadable data. Access requests produce no notice; notice failure never delays or reverses the privacy action, and the Merchant cannot approve, reject, delay, reverse, or contact the requester through it.
_Avoid_: Merchant approval request, customer disclosure email, access-request alert

**Consent Evidence**:
Immutable evidence of a person-specific permission or withdrawal, including its purpose, exact destination, wording or policy version, source, and recorded time. A merge never transfers permission to another destination. Retaining Marketing Consent evidence does not enable marketing functionality that is outside BeeSolo's launch scope.
_Avoid_: current contact preference, Policy Acceptance, inferred consent

**Operational Messaging Permission**:
Person-specific affirmative permission, tied to a supplied mobile number, for subsequent Operational Notifications by mobile message. The Customer may grant it directly or the Owner may record the Customer's explicit verbal or in-person choice against the standardized wording; it is never inferred from Customer Record selection and remains separate from Marketing Consent and transactional email.
_Avoid_: WhatsApp consent, SMS consent, channel preference, Marketing Consent, Policy Acceptance

**Transactional Email**:
The mandatory email route for essential BeeSolo customer-lifecycle Operational Notifications whenever the relevant customer snapshot has an eligible address. Supplying that address for the workflow requires no separate consent checkbox or customer unsubscribe; only the Shop reminder policy and an established command-specific **Don't Notify** choice govern creation, Marketing Consent remains unrelated, and delivery failure never changes the domain outcome.
_Avoid_: Marketing email, Merchant campaign, configurable email channel

**Owner Operational Email**:
A transactional email to the Merchant Owner for a customer-confirmed Appointment, customer reschedule, customer cancellation, or Low Messaging Balance Notice. Owner commands, reminders, individual delivery failures, Waiting List activity, and Walk-in Queue activity create no Owner email or mobile alert at launch.
_Avoid_: customer notification, Merchant mobile alert, activity digest, per-delivery failure alert

**Notification Readiness**:
The current condition proving Transactional Email can support the booking lifecycle, required both for Merchant Activation and effective new public booking. It requires a test appointment email to the Owner's verified account to be accepted by the configured provider; known missing or disabled configuration pauses new public demand without unpublishing, while transient provider failure uses retries and Mobile Operational Messaging never substitutes for readiness.
_Avoid_: delivery guarantee, SMS enablement, Marketing Consent

**Operational Notification**:
A non-promotional message needed to fulfil or manage a booking lifecycle, such as a confirmation, reminder, cancellation, reschedule, or offer. Every non-reminder Operational Notification becomes sendable at domain commit regardless of the reminder window, and workflow deadlines never depend on provider acceptance or delivery.
_Avoid_: Marketing message, policy acceptance

**Controlled Notification Template**:
A BeeSolo-owned, versioned Romanian or English rendering contract for one Operational Notification purpose and channel. It accepts only authoritative workflow facts and explicitly permitted customer-safe Merchant text; Merchants cannot author subjects, markup, links, or general message bodies.
_Avoid_: Merchant template, campaign template, arbitrary message body

**Notification Template Binding**:
The immutable template version, locale, source facts, access-link identity, and safe fingerprints snapshotted by one Notification Intent without retaining a long-lived plaintext rendered body. Ordinary template retirement affects new work only, while a safety disablement terminates bound pending work as **Not Sent — template unavailable**; only a later qualifying domain transition may create a new intent bound to the current approved version.
_Avoid_: latest-template lookup at send time, mutable rendered body, automatic template migration

**Notification Access Link**:
A capability-protected link scoped to the notified Appointment, Waiting List Application or offer, or Walk-in Entry, without raw identifiers or customer data in the URL. Every Appointment email may carry its current Confirmation link, Waiting List and Walk-in emails carry only their own scoped access, and mobile carries a link only in appointment confirmation.
_Avoid_: public status URL, raw resource link, customer account link

**Notification Operation**:
The semantic customer consequence created atomically with one source aggregate version and purpose, linking its independently processed email and mobile Notification Intents under one operation identity. It supplies cross-channel deduplication and one Merchant timeline grouping without merging channel outcomes or financial lifecycles.
_Avoid_: Notification Intent, domain event, provider attempt, combined delivery status

**Semantic Notification Key**:
The unique automatic-intent identity composed from Shop, source type, source identity and revision, purpose, recipient, and delivery family; consolidated party or series email additionally resolves one key per unique recipient destination. Provider retries remain attempts of that same intent, and only a new qualifying source revision or system workflow transition may create another semantic consequence.
_Avoid_: random deduplication token, provider message ID, queue message ID

**Notification Delivery History**:
The source-local Merchant timeline projection grouping one Notification Operation's purpose, time, locale, masked destination, and independent email and mobile outcomes, with safe attempt times and failure reasons. It is observational and offers no manual resend action. Provider payloads and raw identifiers remain Operations evidence, and BeeSolo exposes no separate global Merchant message-history center.
_Avoid_: provider log, customer timeline, global message inbox, raw delivery payload

**Notification Reporting**:
The separate operational report of notification delivery activity, grouped by purpose, channel, delivery outcome, and delivery or attempt period. It distinguishes Delivered, Provider Accepted, Delivery Failed, Not Sent, Submission Unknown, and suppression or invalid-destination outcomes without changing Appointment, Waiting List, or Walk-in conversion metrics. The Owner sees aggregate counts and source-level actionable attention flags with masked destinations and safe reasons; provider evidence, raw identifiers, and manual resend remain Operations-only.
_Avoid_: provider-cost report, domain conversion report, resend center, raw message log

**Notification Evidence Retention**:
The purpose-bound lifecycle that keeps encrypted destinations while actionable plus thirty days after terminal, capped at ninety days after submission without a narrow hold; provider attempts, normalized evidence, and controlled facts for 180 days; and redacted ordinary logs for thirty days. Masked summary follows the source record and Customer Data Erasure, Consent Evidence keeps its separate three-year rule, mobile financial evidence follows statutory retention, and rendered message bodies are never retained long-term.
_Avoid_: indefinite message archive, plaintext body history, log-based audit retention

**Notification Intent**:
A durable system-issued request for one Operational Notification through one delivery family, appended atomically under a Notification Operation and identified by a semantic deduplication key. An email intent owns its provider attempts and a mobile intent owns the complete WhatsApp-first/SMS-fallback journey; no Merchant, customer, or System Operator command may create an ad hoc or replacement transactional intent.
_Avoid_: Domain event, provider message, delivery attempt, marketing consent

**Notification Intent Phase**:
The nonterminal progress of a Notification Intent: **Scheduled**, **Ready**, **Routing**, or **Awaiting Provider**; completion moves it to **Terminal**. Worker claims, leases, and reconciliation cursors are not phases.
_Avoid_: Provider status, retry count, Merchant-visible result

**Notification Intent Result**:
The delivery-family outcome projected from append-only evidence. Mobile ends **Delivered**, **Not Sent**, or **Delivery Failed**; email distinguishes **Provider Accepted** from evidenced **Delivered**, and later evidence may refine acceptance to **Bounced** or **Complained** without rewriting attempt history.
_Avoid_: Notification Intent Phase, API success means delivered, retry state

**Email Delivery Status**:
The truthful email projection **Scheduled**, **Ready**, **Submitting**, **Submission Unknown**, **Provider Accepted**, **Delivered**, **Bounced**, **Complained**, **Not Sent**, or **Delivery Failed**. Hard bounce suppresses the exact email destination, complaint adds suppression and Operations review, and affected active Appointments expose **Customer email needs attention** to the Owner. Due work with no valid destination becomes **Not Sent** without manual replacement; correcting the Appointment email is a new domain revision that makes the system issue its mandatory current confirmation and rebuild any future Reminder. Only trustworthy provider evidence establishes Delivered, and Submission Unknown permits reconciliation but never blind resend.
_Avoid_: send-call success, generic completed, mobile route status

**Email Retry Class**:
The bounded retry schedule selected by notification purpose: urgent Waiting List offers and Walk-in spot assignments try when due and at thirty seconds, two, five, and ten minutes, while other lifecycle email tries when due and at one, five, and fifteen minutes plus one, four, and twelve hours. Every attempt requires the source version and destination to remain current; reminders stop at Appointment start, urgent work stops with its live state or deadline, and permanent rejection never retries.
_Avoid_: unbounded retry, one global backoff, retry after stale workflow

**Notification Provider State**:
The runtime availability of one delivery provider: **Configured**, **Needs Configuration**, or **Disabled**. Configured transient failure uses the intent's retry policy, while the other states terminate due work as **Not Sent** with their exact reason. Restoration never replays or manually replaces terminal work; only later qualifying system workflow transitions create new intents.
_Avoid_: delivery outcome, transient outage, Merchant channel preference

**Notification Dead Letter**:
The redacted terminal recovery record for a Delivery Failed intent after permanent rejection, exhausted retries, or unresolved ambiguity. It is never reopened, replayed, or resent; Operations may recover a provably lost pre-submission wake-up of the same live intent but cannot create replacement customer messages.
_Avoid_: retry queue, mutable intent, provider payload archive

**System-Issued Notification**:
An Operational Notification created only by BeeSolo's deterministic response to a qualifying domain commit, scheduled due time, or declared recovery transition. Merchant Owners, customers, and System Operators cannot compose, resend, or manually create transactional messages; their authorized domain actions may change source state, after which the system alone determines whether a new Notification Operation is required.
_Avoid_: manual resend, ad hoc transactional message, operator-composed notice, replay

**Delivery Route**:
One channel-and-provider path owned by a Notification Intent, such as platform WhatsApp or SMSO.ro SMS. Its progress is **Planned**, **Eligible**, **Submitting**, **Accepted**, **Delivered**, **Ineligible**, **Submission Unknown**, or **Terminal Failure**.
_Avoid_: Notification Intent, provider message, retry

**Submission Attempt**:
Immutable evidence of one request by a Delivery Route to submit its message to a provider, including ambiguous requests whose acceptance is not yet known. Retries add Submission Attempts rather than overwriting earlier evidence.
_Avoid_: Delivery Route, Notification Intent, provider callback

**Submission Unknown**:
A Delivery Route state in which a provider request may have been accepted but no authoritative acceptance or rejection evidence is available. It permits reconciliation but prevents automatic resubmission and fallback.
_Avoid_: Retryable failure, terminal failure, provider acceptance

**Suppression Directive**:
A durable instruction preventing Operational Notifications to a destination across all operational channels or through one named channel. A customer's **Stop text updates** choice is Shop-scoped across every mobile route for the exact phone number until fresh affirmative permission; it stops unsent work but cannot recall a message already accepted by a provider.
_Avoid_: Invalid destination, transient provider failure, marketing preference

**Notification Supersession**:
The fact that a version-bound email or mobile Notification Intent became obsolete after a newer domain change. Unsent work becomes **Not Sent — superseded** atomically with any replacement; possibly accepted work records **superseded after submission**, stops retry and fallback, and continues ingesting evidence without pretending the message can be recalled.
_Avoid_: Provider cancellation, delivery failure, Notification Intent deletion

**Provider Evidence**:
An immutable observation about a Delivery Route received from a submission response, provider callback, provider query, or explicit Operator reconciliation. Route state is an idempotent projection of Provider Evidence; contradictory terminal evidence requires reconciliation rather than automatic fallback or charging.
_Avoid_: Mutable provider status, application log, routing decision

**Chargeable Delivery**:
The first verified delivery for a Notification Intent while its Messaging Balance Reservation remains active that converts the reservation into the one snapshotted Rate Card charge allowed for that intent, €0.045 at launch. Additional provider deliveries and delivery proven only after the seven-day ambiguous-outcome closure remain cost evidence absorbed by the platform; invalidated delivery evidence is corrected by a compensating credit.
_Avoid_: Provider acceptance, provider cost, Submission Attempt, duplicate charge

**Provider Messaging Cost**:
The platform's separately recorded upstream cost for a provider-billed WhatsApp message or SMS segment, whether or not the Notification Intent becomes a Chargeable Delivery. It affects realized margin but never directly changes the Merchant's snapshotted Rate Card charge.
_Avoid_: Merchant charge, Messaging Balance debit, Rate Card price, estimated reservation

**Operational Messaging Router**:
The Booking Product capability that delivers an Operational Notification through WhatsApp first and SMS as its fallback channel, choosing the lowest-cost eligible route within each channel. At launch, mobile Operational Notifications cover Appointment confirmation, reminder, cancellation, and reschedule only; Waiting List and Walk-in Queue messages use transactional email.
_Avoid_: SMS router, standalone messaging product, marketing campaign engine

**Messaging Processing Role Matrix**:
The stage-specific allocation of privacy responsibility for Operational Messaging. The Merchant determines the appointment relationship and which supported notification purposes are enabled; BeeSolo independently determines platform routing, permission and suppression enforcement, security, abuse prevention, billing, reconciliation, complaints, and statutory evidence. Provider roles are classified from their actual processing and executed terms rather than by a blanket processor or subprocessor label.
_Avoid_: BeeSolo is always the Merchant's processor, every provider is a subprocessor, one role for the entire message lifecycle

**Messaging Operator Permission**:
An explicit platform-wide authorization for one Operations messaging capability: `messaging:read`, `messaging:control`, `messaging:finance`, `messaging:reconcile`, or `messaging:incident`. Operations App access and Merchant impersonation grant none of them.
_Avoid_: Admin access, implicit Operations authority, impersonated Merchant authority

**Messaging Operator Role**:
One independently assignable System Operator role granting exactly one Messaging Operator Permission. The five roles are **Messaging Reader**, **Messaging Controller**, **Messaging Finance**, **Messaging Reconciler**, and **Messaging Incident Responder**; a System Operator receives multiple messaging capabilities only by holding multiple roles.
_Avoid_: Messaging administrator, bundled messaging role, implicit permission

**Protected Messaging Destination**:
The immutable E.164 recipient snapshot held by a Notification Intent as application-encrypted delivery material plus a keyed fingerprint for exact comparison. Routine surfaces expose only a masked value; decryption is limited to authorized provider submission or incident investigation.
_Avoid_: Appointment phone reference, plaintext destination copy, provider-formatted phone record, customer identity

**Outbound SMS Segment**:
One provider-accepted segment sent through the platform's outbound SMS router for an Operational Notification. It is a provider-cost unit rather than a Merchant charging unit; rejected attempts are not segments, while one long message may contain multiple segments.
_Avoid_: Chargeable Delivery, Notification Intent, logical message, Merchant charge

**Messaging Rate Card**:
The effective-dated, VAT-exclusive Merchant price for transactional Operational Messaging: €0.045 for one Chargeable Delivery through either WhatsApp or SMS. Provider costs, SMS segment counts, and applicable VAT do not change the net Merchant-facing price.
_Avoid_: Provider price list, cost-plus formula, SMS segment price, marketing-message price

**Messaging Balance**:
Prepaid, Merchant-owned net service credit consumed by a Chargeable Delivery under the effective Messaging Rate Card. VAT paid on funding is not spendable balance; a delivery is rejected before provider submission when the balance cannot cover the snapshotted charge, with provider costs recorded separately.
_Avoid_: SMS Balance, Customer wallet, subscription allowance, appointment Payment

**Messaging Balance Unit**:
One thousandth of a euro, the exact storage and statement unit that represents the €0.045 Messaging Rate without floating-point arithmetic. Card payments, VAT, invoices, and refunds follow accountant-approved currency-rounding rules independently.
_Avoid_: Euro cent, floating-point euro, provider-cost precision

**Messaging Balance Top-Up**:
A confirmed Merchant card purchase that adds €10, €25, or €50 of net service credit plus applicable VAT to one Messaging Balance. Automatic top-up is outside launch scope.
_Avoid_: Subscription payment, appointment Payment, pending card authorization, automatic refill

**Low Messaging Balance Notice**:
The Owner email and persistent in-app notice emitted once when available Messaging Balance crosses below €2. It is re-armed only after confirmed funding restores available balance to at least €2.
_Avoid_: Per-message alert, automatic top-up, insufficient-balance result

**Messaging Balance Ledger Entry**:
An immutable posted credit or debit in EUR with a unique idempotency key, stable source, effective Rate Card when applicable, actor provenance, and an optional link to the entry it reverses. The Messaging Balance is projected from these entries; corrections append compensating entries rather than editing history.
_Avoid_: Mutable balance row, reservation, provider cost, deleted transaction

**Messaging Balance Refund**:
An exceptional, Operator-authorized return of confirmed top-up funds for a documented legal, duplicate-payment, service-termination, or platform reason. It cannot exceed unreserved available credit and links the balance debit, payment-provider refund, fiscal correction, actor, and reason without permitting cash withdrawal on demand.
_Avoid_: Cash-out, self-service withdrawal, subscription refund, balance adjustment

**Messaging Balance Adjustment**:
An authorized System Operator's non-cash credit or debit with mandatory reason, reference, and actor provenance. It is separately typed as correction, goodwill, or another approved accounting reason, and a debit cannot exceed unreserved available credit.
_Avoid_: Top-up, cash refund, silent balance edit, negative balance

**Messaging Financial Reconciliation**:
The recurring comparison of payment-provider facts, Messaging Balance Ledger Entries, reservations, charges, provider costs, refunds, invoices, and the displayed balance. A discrepancy creates an auditable case and is resolved through idempotent evidence or compensating entries rather than silent mutation.
_Avoid_: Balance recalculation, automatic write-off, provider status polling alone

**Messaging Reconciliation Case**:
The durable investigation of contradictory, missing, or mismatched messaging evidence. It progresses through **Open**, **Investigating**, **Resolved**, or **Waived** without rewriting Provider Evidence; a waiver records accountable acceptance of the discrepancy rather than pretending it was reconciled.
_Avoid_: Mutable provider status, silent correction, support note, deleted discrepancy

**Messaging Incident**:
A declared security, privacy, delivery-integrity, or financial-correctness event requiring scoped containment, protected evidence, recovery approval, and a recorded outcome. An incident may stop one Merchant, provider, or channel without implying a platform-wide outage.
_Avoid_: Reconciliation Case, provider error, ordinary failed delivery, unstructured support thread

**Core Production Gate**:
The non-waivable evidence boundary that must pass for one immutable beesolo release candidate before that candidate may receive production traffic. It covers every launch-critical product journey and the authorization, Merchant isolation, data integrity, migration, rollback, accessibility, privacy, required-provider, observability, and recovery properties on which the core product depends; evidence from another candidate or undocumented manual judgment does not satisfy it.
_Avoid_: release checklist, best-effort sign-off, reusable prior-release result, risk waiver

**Production Ingress**:
Any externally reachable HTTP route, provider callback, Queue consumer, or scheduled trigger that can read or affect production state. Every Production Ingress has one owning product surface or capability and maps to automated contract coverage; an unowned or unmapped ingress blocks production release.
_Avoid_: browser page only, undocumented webhook, internal-enough endpoint

**Release Journey**:
A named, automated, production-shaped path through one or more critical Production Ingresses, executed against one immutable release candidate with deterministic assertions and retained evidence. Browser Release Journeys cover representative customer, Merchant, and System Operator outcomes, while lower-level contracts cover remaining mapped ingress without requiring one browser test per route.
_Avoid_: route inventory, manual happy-path check, unit test, exploratory session

**Feature Activation Gate**:
The evidence boundary that must pass before one optional provider-backed capability is enabled in production for an otherwise Core-ready release candidate. A failed or unavailable Feature Activation Gate keeps that capability safely disabled without permitting partial activation or, unless the capability has become launch-critical, blocking the core release.
_Avoid_: Core Production Gate, silent provider fallback, partially verified feature, permanent feature flag

**Release Readiness Record**:
The immutable evidence manifest for one beesolo release candidate. It binds the candidate's code, deployable artifacts, schema, required configuration, Core Production Gate results, Feature Activation Gate states, manual attestations, provider qualifications, parity revision, operational exercises, known non-gating issues, and accountable promotion approval; a material candidate change invalidates the affected evidence, and no human approval can override a failed non-waivable gate.
_Avoid_: mutable launch checklist, release notes, verbal approval, evidence from another candidate

**Messaging Launch Gate**:
The evidence boundary that must pass before Operational Messaging is made available to every eligible Romanian Merchant with the BeeSolo launch. Security, privacy, delivery-integrity, and financial-integrity blockers cannot be waived or hidden by aggregate performance; post-launch safety relies on scoped containment rather than an allowlisted rollout.
_Avoid_: Post-launch pilot, calendar deadline, average-only service metric, discretionary approval

**Messaging Balance Reservation**:
A temporary, atomic claim on one Merchant's available Messaging Balance for one Notification Intent's snapshotted Rate Card charge, €0.045 at launch. Retries and fallback reuse it; a Chargeable Delivery converts it once, while a terminal intent without delivery releases it in full. An ambiguous provider outcome may hold it for no more than seven days, after which it releases without a retroactive Merchant charge.
_Avoid_: Appointment Payment, provider cost, final Merchant charge, per-attempt debit

**Reminder**:
A required scheduled Notification Intent tied to a specific Appointment Revision under one Shop policy: two, twenty-four, or forty-eight hours before the Appointment, defaulting to twenty-four, shared by email and eligible mobile messaging and delivered only from 08:00 through 20:00 Shop time. An out-of-window target shifts earlier to the latest 20:00 boundary so it never loses the configured lead time; later revisions supersede obsolete reminders, schedule a replacement only while its target remains future, and never create a catch-up reminder.
_Avoid_: Calendar event, marketing campaign, client-side timer

**Pay Now**:
A checkout path that collects payment during booking.
_Avoid_: Stripe payment, book and pay

**Pay In Person**:
A checkout path that confirms the appointment without immediate platform payment or a payment credential. Any later External Collection is recorded independently.
_Avoid_: Book no pay, unpaid order

**Payment Intent**:
A provider-specific object used by payment integrations.
_Avoid_: Canonical first-slice entity

**Legacy Source**:
The `ssqu/recreate` codebase used as the behavior and product reference for the recreation.
_Avoid_: Code to copy wholesale, target architecture

### Superseded Starter Vocabulary

The following terms describe residual generic-starter code and historical documentation. They are retained only to interpret or contract that legacy surface; they are not BeeSolo product language and must not drive new implementation.

**Starter**:
A reusable repository foundation for building B2B SaaS products.
_Avoid_: Template, boilerplate

**Reference Application**:
The working SaaS app included in the starter to demonstrate real product patterns.
_Avoid_: Demo app, fictional product

**Showcase Site**:
The public-facing pages that explain the starter, its architecture, and its technology choices.
_Avoid_: Marketing site for a fake SaaS

**Integration Surface**:
A real extension point for connecting external providers without requiring those providers for local development.
_Avoid_: Placeholder, mock integration, mandatory provider

**Workspace**:
A team-owned area where users configure and evaluate their use of the starter.
_Avoid_: Account, organization, tenant

**Starter Module**:
A reusable capability included in the starter, such as auth, email, REST API, MCP, billing, catalog updates, or integrations.
_Avoid_: Feature, plugin, package

**Module State**:
The enablement and configuration state of a starter module within a workspace.
_Avoid_: Feature flag, readiness score

**Adoption Readiness**:
The visible state of how completely a workspace has configured and understood the starter modules it plans to use.
_Avoid_: Health score, setup progress

**Cloudflare-First**:
The starter's deployment and persistence model is designed around Cloudflare Workers, D1, and related platform services.
_Avoid_: Multi-cloud, platform-agnostic

**Implementation Report**:
A workspace-facing summary of starter module configuration, readiness, and operational status.
_Avoid_: Developer productivity report, DORA report

**Report Schedule**:
A workspace setting that controls recurring implementation report generation and delivery.
_Avoid_: Cron job, email schedule

**Local Auth Path**:
The email-and-password sign-in path that works without external provider configuration.
_Avoid_: Fallback auth, demo auth

**Example OAuth Provider**:
The OAuth provider included to demonstrate production OAuth setup without implying every provider is configured.
_Avoid_: Required OAuth provider, placeholder provider

**Optional Provider Module**:
A starter module that has production wiring but remains inactive until its required external provider configuration exists.
_Avoid_: Stub, fake module, required service

**Capability Interface**:
An external interface that exposes starter capabilities without owning separate business behavior.
_Avoid_: Separate API domain, duplicate service

**Catalog Refresh**:
A recurring operation that updates starter module metadata and dependency catalog information.
_Avoid_: One-off script, manual maintenance task

**Public Knowledge Content**:
Versioned MDX content that explains the starter, its modules, and its technology choices.
_Avoid_: CMS content, database-backed docs

**Member**:
A user who belongs to a workspace with a role.
_Avoid_: Seat, teammate, collaborator

**Invitation**:
A request for a user to join a workspace with a specific role.
_Avoid_: Invite link, onboarding email

**Workspace Role**:
The permission level a member has within a workspace: owner, admin, or member.
_Avoid_: Permission group, access tier

**Audit Event**:
A recorded security, admin, workspace, billing, integration, API, or catalog action.
_Avoid_: Log line, activity item, notification

**Notification**:
A user-facing message about workspace, module, report, billing, integration, or API token activity.
_Avoid_: Audit event, log line, email

**API Token**:
A credential belonging to exactly one **Merchant** and granting scoped access to the Platform API.
_Avoid_: Workspace token, personal access token, integration secret, session token

**API Token Status**:
The credential lifecycle of an API Token: **Active**, **Expired**, or **Revoked**.
_Avoid_: User session status, scope

**Webhook Endpoint**:
A deferred **Merchant**-owned outbound event delivery target for the Platform API. It is not a first-party **Notification**.
_Avoid_: Provider webhook, callback URL, launch integration, Notification

**Webhook Endpoint Status**:
The delivery lifecycle of a Webhook Endpoint: **Active** or **Disabled**.
_Avoid_: Delivery health, webhook delivery status

**Webhook Event**:
A **Merchant**-scoped notification that a subscribed domain change occurred. It identifies the changed resource without carrying Customer Details.
_Avoid_: Audit event, webhook delivery attempt, full resource snapshot

**Webhook Delivery Attempt**:
One signed attempt to send a Webhook Event to a Webhook Endpoint. Retries are separate delivery attempts for the same event.
_Avoid_: Webhook event, audit event, manual replay

**Seed Booking Scenario**:
A deterministic, connected Merchant booking story used by local development, tests, and product screenshots.
_Avoid_: Seed Workspace, unrelated demo fixtures, sample tenant

## Relationships

- A **Booking Product** has one **Public Site**, one **Merchant App**, one **Booking App**, one **Platform API**, and background operations.
- The **Booking App**, not the **Platform API**, owns customer Booking Sessions, availability search, checkout, and Appointment confirmation.
- A **Booking Vertical Slice** is the first scoped recreation of the **Legacy Source** inside the **Booking Product**.
- A **Merchant** owns a **Public Booking Page**.
- **Merchant**, not **Workspace**, is the tenant and authorization boundary for Booking Product data.
- At BeeSolo launch, a **Merchant** has exactly one Active **Merchant Member**, its **Merchant Owner**.
- At BeeSolo launch, the **Merchant Owner** is automatically the sole Active **Provider**. The separate membership/bookability model is retained only as a future Team seam.
- A **Public Booking Page** has one **Public Page Status**.
- A **Public Booking Page** can become **Published** only when it satisfies **Booking Readiness**.
- Team, Brand-management, and multi-Shop growth are deferred beyond BeeSolo launch.
- A **Public Booking Page** is the customer entry point into the **Booking App**.
- The **Merchant App** owns business configuration and operations, while the **Booking App** owns the customer booking journey.
- **Merchant Catalog**, **Scheduling**, **Booking**, **Payments**, **Gift Cards**, **Waiting List**, and **Walk-ins** are separate bounded contexts for full booking parity.
- **Booking** consumes bookable configuration from **Merchant Catalog** and candidate times from **Scheduling**.
- A **Merchant** owns its public identity directly in the Solo first slice.
- BeeSolo persists one hidden default **Brand** without exposing Brand management.
- BeeSolo has exactly one **Shop**.
- A **Shop** has one **Shop Address**.
- BeeSolo has exactly one Active **Provider**, its Owner-Provider.
- A **Merchant** offers one or more **Services**.
- A **Provider** has one **Provider Status**.
- A **Service** has one **Service Status**.
- The Owner-Provider and every launch **Service** belong to BeeSolo's single Shop; multi-Brand or multi-Shop assignment is deferred.
- Booking configuration resolves from **Merchant** to **Brand** to **Shop**, and resolved values are snapshotted downstream.
- A **Provider** is eligible to perform one or more **Services**.
- "Location" is customer-facing copy for choosing a **Shop**, not a canonical first-slice entity.
- "Professional" and "Barber" can appear as customer-facing or vertical-specific copy, but **Provider** is the canonical first-slice entity.
- A **Booking Session** owns exactly one **Booking Party** and governs only access, locale, expiry, and continuation.
- A **Booking Party** contains one or more ordered **Booking Requests** and has one **Booking Party Status**.
- A **Booking Request** resolves to a concrete **Provider** before coordinated holds are acquired.
- Lower-level **Any Provider** resolution may remain as regression-tested engine behavior, but BeeSolo hides Provider Preference and resolves every launch booking to the sole Owner-Provider.
- A **Booking Party** atomically creates one **Appointment** per **Booking Request** or creates none.
- After confirmation, each **Appointment** has an independent lifecycle; explicit whole-party changes remain atomic.
- An **Appointment** has one **Appointment Status**.
- A **Booking Request** captures **Customer Details** for its **Customer** and may reference a verified **Customer Account**.
- A **Booking Party** may reference a verified coordinating **Customer Account** without requiring sign-in.
- A **Customer Directory** contains durable, Merchant-scoped **Customer Records**; linked **Appointments** retain their immutable **Customer Details** snapshots.
- **Scheduling** produces **Availability** for a **Booking Session**.
- **Availability** contains one or more **Time Slots**.
- A **Time Slot** can carry the **Providers** eligible for that time.
- A **Booking Party** acquires all required **Time Slot Holds** atomically or acquires none.
- A **Pricing Quote** is bound to the exact selections, holds, policies, promotions, tips, and gift-card reservations that produced it.
- A **Booking Party** can confirm only its latest accepted **Pricing Quote** version.
- **Settlement Allocations** divide an accepted quote total across Gift Card value and external Payment without changing the price.
- An **Appointment** can have one **Primary Service** and zero or more **Additional Services**.
- An **Appointment** belongs to one **Customer**.
- A **Confirmation** presents the atomic outcome of a **Booking Party** and its resulting **Appointments**.
- A **Confirmation** is derived from committed Appointments and Payments facts rather than maintained as a separate business record.
- A **Confirmation Access Token** grants limited customer access to one **Confirmation** without creating a customer account.
- **Browser Active Bookings** uses browser-retained Appointment capabilities to reopen active **Confirmations** on that Merchant's Public Booking Page without requesting another notification.
- **Paying Customer** is only used when payment behavior needs to differ from the **Customer**.
- A **Booking Party** has one **Checkout Path** permitted by its snapshotted **Checkout Policy**.
- One **Policy Acceptance** covers the party transaction; **Marketing Consent** remains person-specific.
- **Operational Messaging Permission** authorizes mobile Operational Notifications without exposing or selecting their internal Delivery Route; it never implies Marketing Consent.
- **Pay Now** or deposit collection creates a **Payment**; **Pay In Person** creates none.
- A **Payment** has one derived **Payment Status** and one or more **Payment Attempts**.
- A **Gift Card Sale** issues exactly one **Gift Card** after captured payment.
- A **Gift Card Redemption** reserves value for one **Booking Party** before atomic commit or release.
- A **Waiting List Application** may receive multiple sequential **Availability Offers**, but at most one may be Pending.
- Accepting an **Availability Offer** creates a **Booking Session** with a **Time Slot Hold**, not an **Appointment**.
- A **Walk-in Queue** contains ordered **Walk-in Entries** and does not require scheduled holds.
- Each **Walk-in Entry** is its own aggregate; the **Walk-in Queue** is an ordered Shop-scoped view and configuration boundary.
- A **Reschedule Session** preserves the original **Appointment** until an atomic replacement commits.
- **Cancellation Policy** governs cancellation eligibility; **Refund Policy** separately governs monetary consequences.
- Domain changes append **Notification Intents** atomically; a **Reminder** is a scheduled, version-bound intent.
- **Payment Intent** remains a provider-adapter object rather than a canonical entity.
- "Cart", "Sale Order", and legacy "Reservation" are **Legacy Source** terms divided among **Booking Session**, **Booking Party**, **Appointment**, **Payment**, and **Confirmation** in the target model.
- "Add-on" is customer-facing copy for an **Additional Service**, not a separate first-slice entity.

### Superseded Starter Relationships

The remaining relationships in this subsection document residual starter capabilities only and are not BeeSolo requirements.

- A **Starter** includes exactly one **Reference Application**
- A **Reference Application** proves the reusable patterns promoted by the **Showcase Site**
- A **Showcase Site** describes the **Starter**, not a fictional SaaS product
- A **Reference Application** exposes **Integration Surfaces** that become active when provider configuration exists
- A **Workspace** tracks one or more **Starter Modules**
- A **Starter Module** has one **Module State** per **Workspace**
- **Adoption Readiness** belongs to a **Workspace** and is derived from its **Starter Modules**
- The **Starter** is **Cloudflare-First**
- An **Implementation Report** summarizes **Adoption Readiness** for a **Workspace**
- A **Report Schedule** can produce recurring **Implementation Reports** for a **Workspace**
- The **Reference Application** supports a **Local Auth Path** and one or more **Example OAuth Providers**
- Billing is an **Optional Provider Module**
- REST and MCP are **Capability Interfaces** over the same workspace and starter module behavior
- A **Catalog Refresh** can run from production background infrastructure or from CI automation
- **Public Knowledge Content** is searched from generated indexes, while **Workspace** state comes from D1-backed capabilities
- A changelog is **Public Knowledge Content** for release notes, upgrade notes, and catalog changes
- A **Workspace** has one or more **Members**
- An **Invitation** targets one **Workspace Role** in one **Workspace**
- A **Member** has exactly one **Workspace Role** per **Workspace**
- A **System Operator** holds platform-wide Operations authority and is distinct from a **Workspace Role**
- An **Audit Event** can be associated with a user, workspace, System Operator action, or provider action
- A **Notification** can be created from workspace, module, report, billing, integration, or API token activity
- An **API Token** belongs to exactly one **Merchant** and can create **Audit Events**
- An **API Token** has one **API Token Status**.
- A **Webhook Endpoint** belongs to exactly one **Merchant** and receives selected outbound events
- A **Webhook Endpoint** has one **Webhook Endpoint Status**.
- A **Webhook Endpoint** subscribes to selected **Webhook Events**.
- A **Webhook Event** can have one or more **Webhook Delivery Attempts**.
- A **Notification** is first-party product messaging; a deferred **Webhook Event** is an external integration message.
- A confirmed **Appointment** may have an **Appointment Calendar Export** generated from its authorized Confirmation view; the export has no synchronization lifecycle.
- A **Seed Booking Scenario** demonstrates one complete **Booking Vertical Slice** through a coherent Merchant data graph.

## Historical Starter Dialogue

This dialogue is superseded product context retained only to explain residual starter code and checked-in MDX. It must not guide BeeSolo product decisions.

> **Dev:** "Should the landing page sell a made-up analytics product?"
> **Domain expert:** "No. The **Showcase Site** should explain why this **Starter** is a strong foundation, and the **Reference Application** should prove those claims with working SaaS features."
>
> **Dev:** "Should GitHub or Slack setup be required before the app boots?"
> **Domain expert:** "No. Those are **Integration Surfaces**: the routes, models, settings, and OAuth flow should exist, but local development should work before provider secrets are configured."
>
> **Dev:** "What does a user do after creating a workspace?"
> **Domain expert:** "They review their **Starter Modules**, configure the ones they need, and use **Adoption Readiness** to understand what remains."
>
> **Dev:** "Can readiness be edited directly?"
> **Domain expert:** "No. **Adoption Readiness** is derived from each **Starter Module** and its **Module State**."
>
> **Dev:** "Should we document deployment paths for Vercel, Node servers, and Postgres?"
> **Domain expert:** "No. The **Starter** is **Cloudflare-First**, so the production path should stay coherent around Workers, D1, Alchemy, and Wrangler."
>
> **Dev:** "Can we keep Contributor's dashboard and reports?"
> **Domain expert:** "Yes, but only as interaction patterns. In this context they become adoption overviews and **Implementation Reports**, not developer productivity analytics."
>
> **Dev:** "Are implementation reports only generated manually?"
> **Domain expert:** "No. A **Workspace** can generate reports manually and define a **Report Schedule** for recurring delivery."
>
> **Dev:** "Should OAuth be required for local development?"
> **Domain expert:** "No. The **Local Auth Path** must work by default, and GitHub can be the first **Example OAuth Provider** when secrets are configured."
>
> **Dev:** "Should Stripe be required before someone can try the starter?"
> **Domain expert:** "No. Billing should be an **Optional Provider Module** with real checkout, portal, webhook, and settings surfaces that activate when Stripe configuration exists."
>
> **Dev:** "Should Sentry and PostHog be part of the starter?"
> **Domain expert:** "Yes. They should be **Optional Provider Modules** with env-gated initialization so local development does not require either service."
>
> **Dev:** "Should the REST API and MCP server demonstrate different domains?"
> **Domain expert:** "No. They should be **Capability Interfaces** over the same workspace, starter module, readiness, and integration behavior."
>
> **Dev:** "Is catalog updating just a local maintenance command?"
> **Domain expert:** "No. A **Catalog Refresh** should be represented as recurring operational work, with production background infrastructure and CI automation where appropriate."
>
> **Dev:** "Should docs and blog posts live in the database?"
> **Domain expert:** "No. **Public Knowledge Content** is checked-in MDX with generated search, while workspace-specific readiness and settings come from D1."
>
> **Dev:** "Where do release notes and dependency catalog changes belong?"
> **Domain expert:** "In a changelog as **Public Knowledge Content**, not as workspace data."
>
> **Dev:** "Can workspaces be single-user until later?"
> **Domain expert:** "No. A B2B **Workspace** needs **Members**, **Invitations**, and simple **Workspace Roles** from the start."
>
> **Dev:** "Is a workspace owner the same as a platform operator?"
> **Domain expert:** "No. A **Workspace Role** controls access within one workspace, while a **System Operator** uses explicitly permissioned Operations capabilities."
>
> **Dev:** "Are admin changes just normal logs?"
> **Domain expert:** "No. Security-sensitive and governance actions should create **Audit Events** that can be inspected in the app."
>
> **Dev:** "Should catalog refresh failures only show up in logs?"
> **Domain expert:** "No. They can create **Notifications** for users and **Audit Events** when governance-sensitive."
>
> **Dev:** "Should REST and MCP only use browser sessions?"
> **Domain expert:** "No. External clients should use merchant-scoped **API Tokens** with scopes and revocation."
>
> **Dev:** "Are billing webhooks and customer webhooks the same thing?"
> **Domain expert:** "No. Provider callbacks are integration-specific routes, while a **Webhook Endpoint** is a merchant-owned outbound event target."
>
> **Dev:** "Should the app start empty after local setup?"
> **Domain expert:** "No. It should include a **Seed Booking Scenario** so local development, tests, and product screenshots exercise the same booking story."

## Flagged Ambiguities

Entries about Starter, Workspace, Adoption Readiness, and Reference Application are historical. BeeSolo terms and booking-domain entries remain current unless explicitly marked deferred.

- "B2B SaaS Starter" could mean either a product template or a fictional SaaS app. Resolved: it is a **Starter**, and the included SaaS experience is a **Reference Application**.
- "Integration" could mean a fake placeholder or a mandatory configured provider. Resolved: it means an **Integration Surface** that is real in structure and opt-in at runtime.
- "Feature" is too generic for this repository's core units. Resolved: reusable SaaS capabilities are **Starter Modules**.
- "Feature flag" is too broad for the starter's module workflow. Resolved: per-workspace configuration is **Module State**.
- "Cloudflare support" understates the platform decision. Resolved: the starter is **Cloudflare-First**, not platform-agnostic.
- Contributor's analytics terms should not become this repo's domain language. Resolved: copy UX patterns, but express them through **Starter Modules**, **Adoption Readiness**, and **Implementation Reports**.
- "Report schedule" is a workspace setting, not just infrastructure cron. Resolved: use **Report Schedule**.
- "OAuth support" should not make local setup depend on an external provider. Resolved: Merchant email/password remains local-first, while optional Customer Account providers are isolated from Merchant and Operations authority.
- "Billing included" means billing is an **Optional Provider Module**, not that Stripe setup is mandatory for local development.
- Sentry and PostHog are included but should not become required setup steps. Resolved: both are **Optional Provider Modules**.
- REST and MCP should not drift into separate demos. Resolved: both are **Capability Interfaces** for the same underlying behavior.
- "Catalog updater" should not mean only a developer-run script. Resolved: **Catalog Refresh** covers both runtime background work and dependency catalog automation.
- Public docs, FAQ, help, and blog content should not be modeled as workspace data. Resolved: they are **Public Knowledge Content**.
- "Team", "seat", and "collaborator" should not compete with the workspace model. Resolved: use **Member**, **Invitation**, and **Workspace Role**.
- "Admin" is ambiguous. Resolved: use **System Operator** for platform staff and **Workspace Role** for workspace-level permissions.
- "Audit log" should not be confused with operational logs. Resolved: persisted governance records are **Audit Events**.
- "Notification" should not be used for persisted governance history. Resolved: **Notifications** are user-facing messages, while **Audit Events** are inspectable governance records.
- Platform API credentials should not be modeled as user sessions or provider secrets. Resolved: use merchant-scoped **API Tokens**.
- "Webhook" is ambiguous. Resolved: use **Webhook Endpoint** for outbound merchant event delivery; provider callbacks are integration routes.
- "Demo data" should be deterministic and part of the Booking Product's local experience. Resolved: use a **Seed Booking Scenario**.
- "Location" looks like a separate entity in the **Legacy Source**, but it is shop-shaped in the first booking flow. Resolved: use **Shop** plus **Shop Address**, and reserve "location" for customer-facing copy.
- "Barber" and "professional" both appear in the **Legacy Source** for the person being booked. Resolved: use **Provider** as the canonical entity, with "Professional" and "Barber" reserved for copy or legacy translation.
- "Add-on" appears in the **Legacy Source**, but the first booking flow treats other compatible services as add-ons. Resolved: use **Additional Service** canonically and reserve "add-on" for customer-facing copy.
- "Cart", "reservation", and "sale order" overlap in the **Legacy Source** booking flow. Resolved: use **Booking Session** for the in-progress attempt, **Appointment** for the confirmed booking, and **Confirmation** for the customer-visible result.
- "Customer" can mean a platform identity, an Appointment participant, or a Merchant-owned reusable record. Resolved: use **Customer Account** for optional platform identity, **Customer** and **Customer Details** for the Appointment participant and snapshot, and **Customer Record** for the durable Merchant-scoped directory identity.
- "Availability" could mean schedule configuration or customer-visible slots. Resolved: use **Availability** for candidate **Time Slots** in a **Booking Session**, and reserve **Schedule Rules** for future merchant calendar configuration.
- "Any Barber" is represented in the **Legacy Source** as a synthetic barber plus a separate `bookedWithAnyBarber` flag. Resolved: use **Provider Preference** with **Specific Provider** and **Any Provider**, preserving whether a booking used the any-provider path even after assignment.
- "Payment Intent" appears in provider-specific legacy payment flows. Resolved: use **Checkout Path**, **Pay Now**, and **Pay In Person** canonically, and keep **Payment Intent** behind payment integration behavior.
