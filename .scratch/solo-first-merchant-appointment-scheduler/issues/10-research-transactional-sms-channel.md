# Research the Transactional SMS Channel

Type: research
Status: resolved
Blocked by:

## Question

Which Cloudflare-compatible integration contract should the Booking Product use with its outbound SMS router, and what current primary-source requirements of that router and its supported delivery routes govern sender identity and registration, country coverage, consent evidence, opt-out handling, inbound STOP processing, delivery callbacks, retries, rate limits, the €0.03-per-segment cost envelope, data retention, secrets, testing, and provider-light local development?

## Comments

### Resolution — 2026-07-30

Research: [Transactional SMS Channel Research](../../../docs/research/transactional-sms-channel.md)

Booking must use the provider-neutral Notifications capability rather than call an SMS provider directly. It commits a durable Notification Intent with controlled facts, protected destination and destination-bound Operational Messaging Permission evidence; the Background Worker selects and submits the route, while normalized immutable Provider Evidence records responses, callback hints, polling results, and costs. The boundary distinguishes captured, accepted, rejected, throttled, needs-configuration, and submission-unknown outcomes. A Submission Attempt is persisted before the provider call, and an ambiguous submission is never automatically replayed.

No production route is commercially qualified for the settled €0.03-per-accepted-segment Merchant price. SMSO.ro's current public low-volume Romania price starts at €0.035 per 160-character message excluding VAT, its public API does not establish long-message segmentation or billing, and even its €0.030 volume tier leaves no platform margin. SMS must therefore remain optional and `needs_configuration` until BeeSolo either qualifies a written all-in provider price below €0.03 by an explicit margin threshold or changes the Merchant price.

If that gate clears, the lowest-complexity seed route is Romania-only SMSO.ro through its shared outbound-only short number, one controlled GSM-7 segment, with the Merchant identified in the body. SMSO callbacks are unauthenticated hints and polling is authoritative; provider quotas, callback behavior, segmentation/cost, DPA, subprocessors, retention, security, and account/sender facts require written confirmation and capped live qualification. BeeSolo owns destination-bound permission and durable suppression. The shared route cannot receive replies, so the product must not advertise reply STOP; Confirmation, Merchant, and support opt-out surfaces must create the same idempotent SMS suppression. Literal inbound STOP remains outside this destination unless two-way messaging is separately added.
