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
The bounded context for merchant-owned bookable configuration: merchants, brands, shops, shop addresses, providers, and services.
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
A short-lived exclusive claim on a Provider and time interval held by an active Booking Session while the customer completes booking.
_Avoid_: Appointment, reservation, persisted availability

**Schedule Rules**:
Merchant-side configuration that produces availability.
_Avoid_: Availability

**Booking**:
The bounded context for the customer journey from booking session through confirmed appointment.
_Avoid_: Cart, sale order

**Booking Session**:
An in-progress customer booking attempt before confirmation.
_Avoid_: Cart, reservation

**Booking Session Capability**:
A secret held by the customer's browser that, together with its Booking Session ID, grants limited access to one active Booking Session.
_Avoid_: Customer session, customer login, booking URL

**Booking Quote**:
The Service, price, duration, currency, and assigned Provider facts accepted for the lifetime of a Booking Session's Time Slot Hold. Its total is the exact customer-facing sum of its Service prices rather than an estimate or payment balance.
_Avoid_: Payment intent, Appointment snapshot, live catalog data

**Appointment**:
A confirmed booking for a customer, with selected services, scheduled time, and assigned provider or any-provider assignment. It preserves the customer-visible facts accepted at confirmation so later catalog changes do not rewrite booking history.
_Avoid_: Reservation, sale order

**Appointment Status**:
The operational state of an appointment: **Scheduled**, **Completed**, **Cancelled**, or **No Show**. Confirmation creates a scheduled appointment; rescheduling changes its time rather than introducing another status.
_Avoid_: Booking session status, payment status, rescheduled

**Confirmation**:
The customer-visible booking summary and status view derived from an Appointment after a Booking Session is confirmed. It does not infer or display a payment status.
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
A future bounded context for online-payment policy, provider integration, and payment lifecycle behavior during booking.
_Avoid_: Billing, sales ledger

**Checkout Path**:
The payment timing and collection path applied to a Booking Session. A customer may select it when more than one path is available, but the first slice applies Pay In Person automatically.
_Avoid_: Checkout Choice, Payment Intent, checkout type

**Checkout Policy**:
The Checkout Paths a Merchant permits for new Booking Sessions.
_Avoid_: Customer selection, payment-provider configuration

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

**System Admin**:
A user with global Better Auth user-management permissions but no implicit authority over a Merchant or its data.
_Avoid_: Merchant Owner, Merchant support agent, operator

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
- **Merchant Catalog**, **Scheduling**, and **Booking** are separate bounded contexts for the first **Booking Vertical Slice**; **Payments** is reserved for a future **Pay Now** path.
- **Booking** consumes bookable configuration from **Merchant Catalog** and candidate times from **Scheduling**.
- A **Merchant** owns its public identity directly in the Solo first slice.
- A **Merchant** can later have one or more **Brands**.
- A **Brand** can later have one or more **Shops**.
- A **Shop** has one **Shop Address**.
- A **Merchant** has one or more **Providers**.
- A **Merchant** offers one or more **Services**.
- A **Provider** has one **Provider Status**.
- A **Service** has one **Service Status**.
- A **Provider** can later be assigned to one or more **Shops** when multi-location booking is enabled.
- A **Service** can later be assigned to one or more **Shops** when multi-location booking is enabled.
- A **Provider** is eligible to perform one or more **Services**.
- "Location" is customer-facing copy for choosing a **Shop**, not a canonical first-slice entity.
- "Professional" and "Barber" can appear as customer-facing or vertical-specific copy, but **Provider** is the canonical first-slice entity.
- A **Booking Session** has one **Provider Preference** when provider choice is visible.
- **Any Provider** resolves to a concrete **Provider** when the Booking Session acquires its Time Slot Hold, while preserving that the customer booked through the any-provider path.
- A **Booking Session** can become one **Appointment** after checkout succeeds.
- An **Appointment** has one **Appointment Status**.
- A **Booking Session** captures **Customer Details** for the **Customer**.
- A **Customer Directory** is derived from Appointment history rather than durable Customer profiles.
- **Scheduling** produces **Availability** for a **Booking Session**.
- **Availability** contains one or more **Time Slots**.
- A **Time Slot** can carry the **Providers** eligible for that time.
- A **Booking Session** can hold one **Time Slot** temporarily while booking is in progress.
- A **Time Slot Hold** carries one **Booking Quote** until the hold expires or is confirmed.
- An **Appointment** can have one **Primary Service** and zero or more **Additional Services**.
- An **Appointment** belongs to one **Customer**.
- A **Confirmation** presents the outcome of one **Appointment**.
- A **Confirmation** is derived from its **Appointment** rather than maintained as a separate business record.
- A **Confirmation Access Token** grants limited customer access to one **Confirmation** without creating a customer account.
- **Paying Customer** is only used when payment behavior needs to differ from the **Customer**.
- A **Booking Session** has one **Checkout Path** before confirmation.
- **Pay In Person** is the fixed first-slice checkout path rather than a Merchant setting; **Checkout Policy** and **Pay Now** are deferred.
- **Payment Intent** belongs behind payment-provider integration behavior, not the first-slice domain model.
- "Cart" and "Sale Order" are **Legacy Source** terms translated into **Booking Session**, **Appointment**, and **Confirmation** in the target model.
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
- A **System Admin** manages users globally and is distinct from a **Workspace Role**
- An **Audit Event** can be associated with a user, workspace, system admin action, or provider action
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
> **Dev:** "Is a workspace owner the same as a global admin?"
> **Domain expert:** "No. A **Workspace Role** controls access within one workspace, while a **System Admin** manages users globally through Better Auth admin capabilities."
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
- "OAuth support" should not make local setup dependent on GitHub or any other provider. Resolved: email/password is the **Local Auth Path**, and GitHub OAuth is an **Example OAuth Provider**.
- "Billing included" means billing is an **Optional Provider Module**, not that Stripe setup is mandatory for local development.
- Sentry and PostHog are included but should not become required setup steps. Resolved: both are **Optional Provider Modules**.
- REST and MCP should not drift into separate demos. Resolved: both are **Capability Interfaces** for the same underlying behavior.
- "Catalog updater" should not mean only a developer-run script. Resolved: **Catalog Refresh** covers both runtime background work and dependency catalog automation.
- Public docs, FAQ, help, and blog content should not be modeled as workspace data. Resolved: they are **Public Knowledge Content**.
- "Team", "seat", and "collaborator" should not compete with the workspace model. Resolved: use **Member**, **Invitation**, and **Workspace Role**.
- "Admin" is ambiguous. Resolved: use **System Admin** for global Better Auth admin users and **Workspace Role** for workspace-level permissions.
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
