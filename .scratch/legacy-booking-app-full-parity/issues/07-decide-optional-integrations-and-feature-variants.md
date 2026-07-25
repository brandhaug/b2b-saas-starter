# Decide Optional Integrations and Feature Variants

Type: grilling
Status: resolved
Blocked by: 01, 04, 05, 14

## Question

Which payment, social authentication, analytics, monitoring, experimentation, wallet, BNPL, gift-card, waiting-list, and walk-in variants are active parity requirements, which require provider-neutral adapters or needs-configuration states, and which are obsolete experiments that should be documented but excluded?

## Answer

The parity rule is conservative: every source-backed customer journey is required unless concrete evidence or an explicit product decision classifies it as an obsolete experiment. Provider availability is not journey availability; optional integrations sit behind provider-neutral boundaries and deterministic disabled or needs-configuration states, while provider-free paths continue to work.

### Active customer-facing parity

- Payments retain Pay In Person, new and saved cards, Apple Pay, Google Pay, Cash App Pay, and BNPL/Klarna. Stripe is the first optional adapter, never a local-startup requirement. Provider intents and SDK objects remain inside the Payments adapter; Pay In Person remains provider-free.
- Google and Apple sign-in remain optional Better Auth provider variants. Anonymous booking remains complete. Dormant identity artwork or provider code such as Yahoo is excluded unless a reachable source branch is proven.
- Gift Cards retain assigned and unassigned purchase, permitted fixed/custom amounts, purchaser and recipient details, online settlement and exactly-once issuance, lookup/receipt states, full or partial redemption, mixed settlement, and deterministic invalid, expired, suspended, insufficient-balance, configuration, payment-failure, and issuance-retry states. Gift Cards remains a bounded context rather than a payment method or promotion.
- Waiting Lists retain application creation and withdrawal, preferences, sequential offers, accept/decline/expiry, offer-driven rescheduling, and all empty, unavailable, invalid, fulfilled, and expired states. An accepted offer creates a purpose-limited Booking Session and Time Slot Hold, not an Appointment.
- Walk-ins retain Shop-specific landing and availability, service/provider preference, contact collection, enrollment, real position/wait information, lifecycle outcomes, and closed/unavailable/invalid/duplicate/failure states. Hard-coded legacy drawer data is a defect to replace with deterministic fixtures and real Walk-in Entry data. Queue enrollment does not itself create an Appointment.

### Consent, analytics, monitoring, and configuration

- c15t is the consent-management boundary. It owns consent UI, policy resolution, durable consent where configured, and consent-sensitive integration loading; it is not an analytics provider.
- PostHog is the sole product-analytics adapter and receives the provider-neutral booking funnel vocabulary. It is optional, defaults to no-op, prefers the EU region, and loads only after c15t grants `measurement` consent. Its initial scope excludes session replay, autocapture, surveys, and person profiles.
- Sentry remains an optional operational-monitoring adapter. Monitoring and analytics delivery or failure can never affect booking behavior.
- Typed merchant, deployment, or provider configuration replaces LaunchDarkly and any required remote experimentation service. Domain behavior and parity fixtures never depend on PostHog feature flags.
- Retained configuration covers branding, bot protection, deposits, localization, Apple Pay visibility, group appointments, Cash App, BNPL provider selection, flexible tipping, Reviews V2, walk-ins, and the one-time group-appointment announcement.

### Explicitly retired or excluded

- RudderStack, GTM, Microsoft Clarity, FullStory, Datadog RUM, the coupled Sentry–FullStory bridge, Fluent Ads, Reserve with Google token tracking, Stylz, BarberCo, UpprMgmt, Meta/TikTok pixels, and executable brand/shop analytics-script injection are excluded.
- Checkout V2 and Reviews V2 are the canonical targets. Legacy checkout, Reviews V1, their A/B flags, and environment/device-specific rollout flags are documented as retired experiments rather than rebuilt as parallel presentations.
- The legacy `cookieConsent` flag is replaced by c15t policy resolution. Analytics-provider flags are replaced by optional PostHog configuration governed by c15t.
- Provider SDKs, credentials, failures, and vendor-specific identities do not enter Booking, Gift Cards, Waiting List, or Walk-ins domain models.

This resolution sharpens existing canonical concepts without adding a new business term to `CONTEXT.md`: **Optional Provider Module**, **Checkout Path**, **Payment**, **Gift Card**, **Waiting List Application**, and **Walk-in Entry** already name the relevant domain boundaries. The downstream module/package-boundary decision now has a complete integration disposition and no new Wayfinder ticket is required.
