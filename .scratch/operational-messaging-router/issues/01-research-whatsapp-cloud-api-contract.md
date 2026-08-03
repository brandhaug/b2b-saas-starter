# Research the WhatsApp Cloud API Delivery Contract

Type: research
Status: resolved
Blocked by:

## Question

What current primary-source WhatsApp Cloud API requirements and capabilities govern a platform-owned shared Business identity for Romanian and English Booking Product Operational Notifications, including template approval and variables, utility-message classification, pricing, phone-number and business verification, recipient eligibility, submission idempotency, delivery statuses, terminal failures, retries, rate limits, quality controls, webhooks, signatures, test resources, secrets, data handling, and Cloudflare Workers compatibility?

## Comments

### Resolution — 2026-07-27

Research: [WhatsApp Cloud API Delivery Contract](../research/whatsapp-cloud-api-delivery-contract.md)

A platform-owned shared WhatsApp sender is technically viable only as a truthful platform identity: the platform profile must not impersonate a Merchant, each controlled message must identify the relevant Merchant, and the platform must retain Merchant authorization plus customer WhatsApp opt-in and suppression evidence. Launch should use separately approved Romanian and English Utility templates for confirmation, reminder, cancellation, and reschedule, with typed controlled variables and no promotional content.

An HTTP success and returned `wamid` prove provider acceptance, not delivery. Signed, potentially duplicate or out-of-order webhooks provide `sent`, `delivered`, `read`, and `failed` evidence. Meta documents neither an outbound idempotency key nor a consent/reachability preflight, so the router must own semantic deduplication, a durable `submission_unknown` state, monotonic timestamp-based projection, and an effective-dated failure classifier. Only explicit rejection or a terminal `failed` outcome may activate SMS fallback; delayed or unknown delivery cannot.

WhatsApp currently charges per delivered message, with recipient-market, category, service-window, and volume-tier rules. The Romania Utility first-tier rate observed on 2026-07-27 was EUR 0.0239, but pricing and classification must remain effective-dated configuration and be revalidated before the Booking Product launches with Operational Messaging enabled. Provider cost must be reconciled from delivery and billing evidence rather than inferred from submission.

Cloudflare Workers can implement the adapter and signed webhook ingress directly with native Fetch, Web Crypto HMAC-SHA256 over the raw body, and secret bindings; the provider contract does not require another Worker or Meta SDK. Account-specific verification, display-name and template approval, limits, exact error guidance, retry behavior, processing terms, and live cost behavior now belong to [Provision and Qualify the WhatsApp Production Route](./15-provision-and-qualify-whatsapp-production-route.md).
