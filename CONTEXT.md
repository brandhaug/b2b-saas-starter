# Booking Product Recreation

Booking Product Recreation is the effort to rebuild the `ssqu/recreate` product inside this repository's Cloudflare-first architecture. The repository is moving from a generic starter/reference application toward an actual booking product with separate public, merchant, booking, API, and background surfaces.

## Language

**Booking Product**:
The actual recreated product being built from `ssqu/recreate`.
_Avoid_: Starter demo, template showcase

**Public Site**:
The unauthenticated landing and product information surface.
_Avoid_: Merchant app, booking app

**Public Booking Page**:
The public customer-facing page for a merchant where customers can learn enough to start booking.
_Avoid_: Storefront, profile page, microsite

**Public Page Status**:
The visibility lifecycle of a public booking page: **Published** or **Unpublished**.
_Avoid_: Appointment status, merchant status

**Published**:
A public page status for a page that is available to customers.
_Avoid_: Cached version, immutable revision

**Unpublished**:
A public page status for a page that is not available to customers, including a newly created merchant or a page later removed from public access.
_Avoid_: Draft, deleted, suspended merchant

**Booking Readiness**:
The derived condition that determines whether a public booking page can be Published: it has a public name and slug, an active service, an eligible provider, and schedule rules.
_Avoid_: Adoption Readiness, current time-slot availability, team setup

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
The external server-to-server integration surface for merchant-owned data, appointment records, API tokens, and webhook configuration.
_Avoid_: Booking API, customer booking channel, first-party app data layer

**Booking Vertical Slice**:
The first recreated journey that proves the architecture end to end: merchant-managed booking data, public booking, checkout path, and appointment confirmation.
_Avoid_: Full port, demo flow

**Merchant**:
The Booking Product tenant and authorization boundary: a business or operator that owns a public booking presence and bookable configuration. In the first slice a merchant may be a solopreneur; later it can grow into a team, brand, or multi-shop operation.
_Avoid_: Account, workspace, tenant

**Merchant Member**:
An authenticated person authorized to operate a Merchant. A Merchant Member is not necessarily a bookable Provider.
_Avoid_: Workspace member, Provider, staff member

**Merchant Owner**:
The sole Merchant Member role in the first Booking Vertical Slice, with authority over the Merchant and all first-slice Merchant App operations. Each Merchant has one Merchant Owner, and each Merchant Owner owns one Merchant.
_Avoid_: Workspace owner, shop user, Provider

**Merchant Onboarding**:
The authenticated setup path through which a person creates a Merchant and becomes its Merchant Owner.
_Avoid_: Sign-up, merchant registration, workspace creation

**Merchant Catalog**:
The bounded context for merchant-owned bookable configuration: merchants, brands, shops, shop addresses, providers, and services. Booking configuration resolves by explicit precedence from Merchant to Brand to Shop, and downstream aggregates snapshot the resolved values.
_Avoid_: One generic booking bucket, product catalog

**Brand**:
A future customer-visible grouping under a merchant for multiple public identities, locations, or business lines.
_Avoid_: Account, workspace, chain

**Shop**:
An optional merchant business unit or location used when a merchant has multiple places or sub-businesses for booking.
_Avoid_: Location, store, branch

**Shop Address**:
The physical address details for a shop when location-specific booking is needed.
_Avoid_: Location

**Provider**:
The bookable person who performs services for a merchant. In a Solo plan the merchant is the default provider; in a Team plan the merchant can add more providers.
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
A bookable catalog item with duration, positive customer-facing price, category, and provider eligibility.
_Avoid_: Product, add-on

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
A short-lived exclusive claim on a Provider and time interval held by an active Booking Session while the customer completes booking. A coordinated Booking Party acquires its complete conflict-free hold set atomically or acquires none.
_Avoid_: Appointment, reservation, persisted availability

**Schedule Rules**:
Merchant-side configuration that produces availability.
_Avoid_: Availability

**Booking**:
The bounded context for the customer journey from booking session through confirmed appointment.
_Avoid_: Cart, sale order

**Booking Party**:
The single-currency aggregate owned by one Booking Session for either a single or composite booking, containing one or more ordered Booking Requests coordinated by one customer and payer. Confirmation and explicit whole-party changes are atomic; afterward each resulting Appointment has an independent lifecycle.
_Avoid_: Cart, sale order, group reservation

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
The supported presentation language selected for one Booking Session and reused for continuation and confirmation experiences. It is independent of the Shop timezone and the Booking Party currency and cannot change scheduling or monetary invariants.
_Avoid_: Browser locale, Shop locale, language route

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
A confirmed booking for a customer, with selected services, scheduled time, and assigned provider or any-provider assignment. It preserves the customer-visible facts accepted at confirmation so later catalog changes do not rewrite booking history.
_Avoid_: Reservation, sale order

**Appointment Status**:
The operational state of an appointment: **Scheduled**, **Completed**, **Cancelled**, or **No Show**. Confirmation creates a scheduled appointment; rescheduling changes its time rather than introducing another status.
_Avoid_: Booking session status, payment status, rescheduled

**Confirmation**:
The customer-visible booking summary and status view derived only after a Booking Party atomically creates all of its Appointments. While external settlement or local commitment is unresolved, the customer sees Processing rather than partial Appointments; payment facts are shown only from Payments.
_Avoid_: Sale order, receipt-only page

**Confirmation Access Token**:
A secret issued for a confirmed appointment that grants a customer limited access to its confirmation without requiring a customer account.
_Avoid_: Booking session capability, customer login, appointment ID

**Customer**:
The person for whom an appointment is booked.
_Avoid_: User, account, customer profile

**Customer Details**:
The unverified name, email, and phone captured during a booking session. Customer Details do not establish a durable or authenticated customer identity.
_Avoid_: Customer account, identity profile

**Customer Account**:
An optional platform-wide verified identity that may be referenced by a Booking Party coordinator or guest without replacing snapshotted Customer Details or capability-based anonymous access. Merchants can access only facts arising from their own customer interactions.
_Avoid_: Customer Details, Customer Directory, Merchant Member, cross-merchant profile

**Customer Directory**:
An appointment-derived Merchant view of captured Customer Details. It is not a durable customer identity registry or CRM.
_Avoid_: Customer account, customer profile, CRM

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
The aggregate for value collected from or refunded to one payer against an accepted Pricing Quote, with explicit allocations and one or more Payment Attempts. Pay In Person creates no Payment and implies no payment status.
_Avoid_: Checkout, sale order, unpaid appointment, payment intent

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
A customer's durable request for a service, provider preference, and date window when no suitable Time Slot is selected. Its lifecycle is **Active**, **Fulfilled**, **Withdrawn**, or **Expired** and may span multiple Availability Offers.
_Avoid_: Booking Session, appointment, walk-in entry

**Availability Offer**:
A purpose-limited offer of one Time Slot to one Waiting List Application, with lifecycle **Pending**, **Accepted**, **Declined**, **Expired**, or **Superseded**. An application has at most one Pending offer; acceptance atomically creates a Booking Session with a Time Slot Hold rather than an Appointment.
_Avoid_: Availability, appointment, confirmation

**Walk-in Queue**:
The Shop-scoped ordered view and configuration boundary for active Walk-in Entries; it is not one contention-heavy aggregate.
_Avoid_: Waiting list, appointment calendar, booking session

**Walk-in Entry**:
An independently mutable aggregate representing a request to join a Walk-in Queue with selected services, provider preference, contact details, join time, and ordering facts. Its lifecycle is **Waiting**, **Called**, **Serving**, **Served**, **Removed**, or **Expired**; it becomes an Appointment only through an explicit merchant action.
_Avoid_: Appointment, waiting-list application, time-slot hold

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

**Operational Notification**:
A non-promotional message needed to fulfil or manage a booking lifecycle, such as a confirmation, reminder, cancellation, reschedule, or offer. Its delivery does not depend on Marketing Consent.
_Avoid_: Marketing message, policy acceptance

**Notification Intent**:
A durable request for an Operational Notification, appended atomically with the domain change that requires it and identified by a semantic deduplication key. Notifications owns channel delivery; provider failures do not roll back the originating domain transaction.
_Avoid_: Domain event, provider message, marketing consent

**Reminder**:
A scheduled Notification Intent tied to a specific version of a domain aggregate. A later reschedule, cancellation, or other superseding change invalidates obsolete pending reminders.
_Avoid_: Calendar event, marketing campaign, client-side timer

**Pay Now**:
A checkout path that collects payment during booking.
_Avoid_: Stripe payment, book and pay

**Pay In Person**:
A checkout path that confirms the appointment without immediate payment or a payment credential. It does not represent or track whether the merchant later collects payment.
_Avoid_: Book no pay, unpaid order

**Payment Intent**:
A provider-specific object used by payment integrations.
_Avoid_: Canonical first-slice entity

**Legacy Source**:
The `ssqu/recreate` codebase used as the behavior and product reference for the recreation.
_Avoid_: Code to copy wholesale, target architecture

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
A **Merchant**-owned outbound event delivery target.
_Avoid_: Provider webhook, callback URL, integration

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
- A **Merchant** has one or more **Merchant Members**.
- A **Merchant Member** and a **Provider** are separate roles; a person may be both, either, or neither.
- A **Public Booking Page** has one **Public Page Status**.
- A **Public Booking Page** can become **Published** only when it satisfies **Booking Readiness**.
- A **Merchant** can start as a solopreneur and later grow into a team, brand, or multi-shop operation.
- A **Public Booking Page** is the customer entry point into the **Booking App**.
- The **Merchant App** owns business configuration and operations, while the **Booking App** owns the customer booking journey.
- **Merchant Catalog**, **Scheduling**, **Booking**, **Payments**, **Gift Cards**, **Waiting List**, and **Walk-ins** are separate bounded contexts for full booking parity.
- **Booking** consumes bookable configuration from **Merchant Catalog** and candidate times from **Scheduling**.
- A **Merchant** owns its public identity directly in the Solo first slice.
- A **Merchant** can have one or more **Brands**.
- A **Brand** can have one or more **Shops**.
- A **Shop** has one **Shop Address**.
- A **Merchant** has one or more **Providers**.
- A **Merchant** offers one or more **Services**.
- A **Provider** has one **Provider Status**.
- A **Service** has one **Service Status**.
- A **Provider** can be assigned to one or more **Brands** or **Shops**.
- A **Service** can be assigned to one or more **Brands** or **Shops**.
- Booking configuration resolves from **Merchant** to **Brand** to **Shop**, and resolved values are snapshotted downstream.
- A **Provider** is eligible to perform one or more **Services**.
- "Location" is customer-facing copy for choosing a **Shop**, not a canonical first-slice entity.
- "Professional" and "Barber" can appear as customer-facing or vertical-specific copy, but **Provider** is the canonical first-slice entity.
- A **Booking Session** owns exactly one **Booking Party** and governs only access, locale, expiry, and continuation.
- A **Booking Party** contains one or more ordered **Booking Requests** and has one **Booking Party Status**.
- A **Booking Request** resolves to a concrete **Provider** before coordinated holds are acquired.
- **Any Provider** resolves to a concrete **Provider** when the Booking Session acquires its Time Slot Hold, while preserving that the customer booked through the any-provider path.
- A **Booking Party** atomically creates one **Appointment** per **Booking Request** or creates none.
- After confirmation, each **Appointment** has an independent lifecycle; explicit whole-party changes remain atomic.
- An **Appointment** has one **Appointment Status**.
- A **Booking Request** captures **Customer Details** for its **Customer** and may reference a verified **Customer Account**.
- A **Booking Party** may reference a verified coordinating **Customer Account** without requiring sign-in.
- A **Customer Directory** is derived from Appointment history rather than durable Customer profiles.
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
- **Paying Customer** is only used when payment behavior needs to differ from the **Customer**.
- A **Booking Party** has one **Checkout Path** permitted by its snapshotted **Checkout Policy**.
- One **Policy Acceptance** covers the party transaction; **Marketing Consent** remains person-specific.
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
- A **Seed Booking Scenario** demonstrates one complete **Booking Vertical Slice** through a coherent Merchant data graph.

## Example Dialogue

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
- "Customer" can mean a durable profile in the **Legacy Source**, but the first slice only needs appointment ownership and contact information. Resolved: use **Customer** and **Customer Details**, and defer customer accounts, saved cards, notification consents, and marketing profiles.
- "Availability" could mean schedule configuration or customer-visible slots. Resolved: use **Availability** for candidate **Time Slots** in a **Booking Session**, and reserve **Schedule Rules** for future merchant calendar configuration.
- "Any Barber" is represented in the **Legacy Source** as a synthetic barber plus a separate `bookedWithAnyBarber` flag. Resolved: use **Provider Preference** with **Specific Provider** and **Any Provider**, preserving whether a booking used the any-provider path even after assignment.
- "Payment Intent" appears in provider-specific legacy payment flows. Resolved: use **Checkout Path**, **Pay Now**, and **Pay In Person** canonically, and keep **Payment Intent** behind payment integration behavior.
