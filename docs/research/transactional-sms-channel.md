# Transactional SMS Channel Research

Status: complete  
Research date: 30 July 2026  
Scope: BeeSolo's outbound, transactional appointment and queue SMS for its Romania-first launch. Marketing, conversational SMS, and general two-way messaging are outside scope.

## Executive answer

BeeSolo should integrate the Booking Product with the existing provider-neutral Notifications capability, not with SMSO.ro or any other carrier API directly. Booking commits a durable notification intent containing controlled facts, a protected E.164 destination, the applicable Operational Messaging Permission evidence, a maximum segment/cost authorization, and a stable idempotency identity. The Background Worker owns provider selection and submission; the API Worker owns provider-specific callback ingress; provider responses, queries, and callbacks become normalized, immutable Provider Evidence. This is already the repository's architectural direction in [the provider contracts](../../packages/capabilities/src/notifications/provider-contracts.ts), [the SMSO adapter](../../packages/capabilities/src/notifications/smso-adapter.ts), and [the operational-messaging architecture decision](../../.scratch/operational-messaging-router/issues/07-decide-capability-data-and-worker-architecture.md).

There is **no commercially qualified production SMS route for the settled €0.03-per-accepted-segment Merchant price today**. SMSO's current public Romania prices begin at €0.035 per 160-character message excluding VAT; postpay reaches €0.030 only at 20,000–49,999 messages/month, leaving no provider-cost margin, while the prepaid rate below €0.03 requires buying 20,000 messages for €560. The public API does not establish how long messages are segmented or billed. BeeSolo must therefore launch the optional SMS module as `needs_configuration` unless it first obtains a written route price and segment contract at or below €0.03 (preferably below it by an explicit operating-margin threshold), or changes the Merchant price. Email remains available and SMS does not block Merchant Activation. [SMSO 2026 pricing and packages](https://www.smso.ro/preturi-si-pachete-sms/)

If that commercial gate is cleared, the lowest-complexity seed route is SMSO's **Romania-only shared short number**, restricted at launch to one controlled GSM-7 segment. It is free, outbound-only, and immediately avoids the monthly cost and provisioning lead time of a two-way number; every body must identify the Merchant because the sender itself is shared. A dedicated short number is €210/month, supports sending and receiving, and is advertised with a 3–4 week lead time. A personalized label is outbound-only, costs €290 at purchase, allows up to 11 alphanumeric characters, and is advertised at about one month for all Romanian operators. [SMSO sender products and lead times](https://www.smso.ro/preturi-si-pachete-sms/)

This recommendation is deliberately a gated route, not approval to enable production SMS. Account, DPA/security, quota, callback, ambiguity, pricing, segmentation, and live cross-network qualification remain launch prerequisites.

## Evidence boundary

Current provider facts below were checked against SMSO-owned pages on 30 July 2026. Where SMSO publishes no contract, this note says so instead of filling the gap with a generic SMS convention. The deeper [SMSO.ro Delivery Contract Research](./smso-ro-delivery-contract.md) and [Romanian Operational Messaging Obligations](../../.scratch/operational-messaging-router/research/romanian-operational-messaging-obligations.md) remain useful first-party-researched background, but changing commercial and API facts were independently rechecked for this ticket.

## Recommended Booking-to-router contract

The public Booking application boundary should be a business capability such as `planOutboundSms` / `enqueueOutboundSms`, not the lower-level provider adapter. The contract needs these semantics:

```ts
type OutboundSmsIntent = {
  intentId: string // stable across queue redelivery
  operationId: string // idempotent originating command
  merchantId: string
  shopId: string
  purpose: TransactionalPurpose
  locale: 'ro' | 'en'
  templateVersion: number
  controlledFacts: ControlledFacts // no arbitrary Merchant-authored body
  destination: ProtectedE164
  destinationFingerprint: string
  permissionEvidence: {
    evidenceId: string
    policyVersion: string
    recordedAt: string
    destinationFingerprint: string
  }
  availableAt: string
  usefulUntil: string
  maxSegments: number
  maxChargeMilliEuro: number
}

type OutboundSmsResult =
  | { tag: 'planned' | 'captured' }
  | { tag: 'ineligible'; reason: string }
  | { tag: 'needs_configuration' }
  | { tag: 'insufficient_balance' }
  | { tag: 'accepted'; attemptId: string; segments: number; chargeMilliEuro: number }
  | { tag: 'rejected'; classification: 'terminal' | 'retryable' }
  | { tag: 'throttled'; retryAt: string }
  | { tag: 'submission_unknown'; attemptId: string }
```

The exact type names are not material; the invariants are:

1. The originating Appointment, queue, or waiting-list command commits its domain change and Notification Intent atomically. Delivery never controls the originating transaction.
2. The router resolves the approved template, channel eligibility, current suppression, Merchant control, route, segment count, reservation, and provider configuration immediately before submission.
3. The complete Merchant charge is reserved before any provider call. At the current launch restriction, `maxSegments` is one and `maxChargeMilliEuro` is 30. Multi-segment support must not be inferred from SMSO's public 160-character price note.
4. A Submission Attempt is durably persisted before the destination is revealed or a provider is called. Queue redelivery resumes that attempt; it does not create a second provider submission.
5. Provider credentials, raw references, callback details, and route names stay behind Notifications. Booking receives safe lifecycle projections, not provider payloads.
6. `captured` in local/test is distinct from provider acceptance and delivery; missing production configuration is a visible `needs_configuration`, never a fake success.

Cloudflare Workers can call third-party HTTPS APIs with the standard Fetch API, and Cloudflare Queues are at-least-once: a message can be delivered more than once, so the application must deduplicate state-changing work with a unique identity. Individual acknowledgement avoids replaying an otherwise successful message when another item in a batch fails. [Cloudflare third-party API integration](https://developers.cloudflare.com/workers/configuration/integrations/apis/), [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Cloudflare queue acknowledgement and retry behavior](https://developers.cloudflare.com/queues/configuration/batching-retries/)

## Route and provider requirements

### Sender identity, registration, and country coverage

SMSO authenticates its API with an API key. `GET /senders` returns the sender IDs available to the authenticated team, and `POST /send` requires one of those numeric IDs; an adapter cannot submit an arbitrary display label. The request also requires an E.164 destination and body. The key should be sent in `X-Authorization`, not in the also-supported query-string field, because URLs are commonly retained by infrastructure. [SMSO API authentication, senders, and send request](https://api-docs.smso.ro/)

The public price card says these SMS are available in Romania, and the API documents `422` as “international messages not allowed.” The launch route must consequently accept only normalized `+40` destinations and expose Romania as an explicit route capability, not silently try other countries. Supporting another country requires a separately priced and qualified route. [SMSO Romania coverage and pricing](https://www.smso.ro/preturi-si-pachete-sms/), [SMSO errors](https://api-docs.smso.ro/#errors)

For the shared short-number launch route, the controlled body must begin with or clearly contain the Merchant's customer-facing name. BeeSolo must not imply that the shared number is owned by the Merchant. Account ownership, production sender availability, operator coverage, KYC, invoicing, and any content approval must be verified in the production account before enablement; they are not fully described by the public API.

### Content, segmentation, and the €0.03 envelope

SMSO's public price is for 160-character messages “excluding diacritics and special characters.” The send API can request ASCII replacement with `remove_special_chars=1`, but SMSO publishes neither the complete replacement map nor GSM extension-table counting, Unicode/UCS-2 boundaries, concatenated segment sizes, a body maximum, or the charge behavior for a long body. A successful send reports `transaction_cost` in eurocents, but this arrives after submission. [SMSO pricing notes](https://www.smso.ro/preturi-si-pachete-sms/), [SMSO send request and response](https://api-docs.smso.ro/#messages)

Therefore the safe seed contract is a controlled, nonempty GSM-7 body of at most 160 septets, with extension-table characters counting as two, and no Unicode or concatenation. This is a BeeSolo risk limit, not a claim that SMSO has published those complete segmentation rules. Romanian templates should be deliberately transliterated and human-reviewed. A future multi-segment route needs a provider-qualified `quote` result or a written segmentation algorithm plus boundary tests before BeeSolo can reserve and bill the complete message correctly.

At public rates, the unit economics are:

| SMSO route                                          | Provider price, excl. VAT | Margin against €0.03 Merchant charge |
| --------------------------------------------------- | ------------------------: | -----------------------------------: |
| Prepay Startup / low-volume postpay / pay as you go |                    €0.035 |     **-€0.005** before platform cost |
| Prepay Enterprise, 10,000 messages                  |                    €0.032 |     **-€0.002** before platform cost |
| Postpay, 20,000–49,999/month                        |                    €0.030 |          €0.000 before platform cost |
| Prepay Corporate, 20,000 messages                   |                    €0.028 |          €0.002 before platform cost |

The settled Merchant price is therefore not compatible with a low-volume SMSO launch. Provider-reported cost must remain separate from the Merchant's immutable €0.03 accepted-segment charge, and Operations must alert before a configured route reaches or exceeds that charge. [SMSO 2026 pricing](https://www.smso.ro/preturi-si-pachete-sms/)

### Permission, consent evidence, and opt-out

Romanian Law 506/2004 Article 12 requires prior express consent for unsolicited **commercial** electronic communications. A tightly controlled appointment confirmation, reminder, cancellation, reschedule, queue update, or waiting-list update is on the better reading operational rather than promotional; adding discounts, cross-sells, review requests, loyalty prompts, or re-engagement changes that analysis. The API's `type=transactional` flag does not determine the legal substance. Personal-data processing still needs an identified GDPR basis, transparency, data minimization, and storage limitation. [Romanian Law 506/2004, Article 12](https://legislatie.just.ro/Public/DetaliiDocument/257056), [GDPR Articles 5 and 6](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/)

BeeSolo should retain its stricter product control: no customer SMS without a current, destination-bound **Operational Messaging Permission**. Do not label this record “marketing consent” or rely on it automatically as the GDPR legal basis. The evidence should identify the booking/customer observation, normalized-destination fingerprint, channel and operational purposes, policy/disclosure version, affirmative or declined state, collection surface, locale, and server timestamp. A later change of destination requires fresh evidence. Merchant-created appointments without existing evidence remain email-only unless a later product decision supplies a valid collection/attestation flow.

Every opt-out or wrong-recipient report, whether received in the customer Confirmation surface, by the Merchant, through support, or as a provider suppression response, must create an idempotent SMS suppression before another route evaluation. A later appointment must not silently remove it. SMSO documents error `405` for an unsubscribed user, but says its automatic unsubscribed-user filtering and generated unsubscribe link are for `type=marketing`; the public contract does not promise equivalent opt-out handling for `transactional`. BeeSolo must keep its own authoritative suppression record. [SMSO send options and errors](https://api-docs.smso.ro/)

### Inbound STOP

The recommended shared short number is outbound-only. SMSO documents reply callbacks and advertises receiving only for a dedicated short number, but does not document automatic `STOP` recognition, keyword normalization, or a provider-managed transactional suppression contract. BeeSolo must **not** print “Reply STOP” on a route that cannot receive replies and must not enable `webhook_responses` for the shared-number seed route. Instead, the Confirmation/support surface must offer a simple SMS opt-out that writes the router suppression described above. [SMSO inbound callback shape](https://api-docs.smso.ro/#receiving-messages), [SMSO sender capabilities](https://www.smso.ro/preturi-si-pachete-sms/)

If literal inbound STOP becomes a requirement, that is a different delivery route: provision a dedicated two-way number, define a provider-specific inbound webhook, normalize STOP and Romanian equivalents case-insensitively, durably suppress before acknowledging, handle duplicates/replay/unknown numbers, and send at most one compliant confirmation if counsel and the provider approve. This would expand the map beyond its current “outbound only; two-way out of scope” boundary and needs a separate decision and qualification ticket.

### Submission, callbacks, polling, retry, and idempotency

`POST /send` is form-encoded and returns a `responseToken` plus `transaction_cost` on success. SMSO publishes no idempotency key, client reference, duplicate window, or lookup by client identity. A timeout, connection reset, or undocumented 5xx after transmitting the request is consequently `submission_unknown`: never automatically replay it. The provider token only exists after a successful response, so polling cannot resolve a submission whose response was lost. [SMSO send contract](https://api-docs.smso.ro/#messages)

SMSO documents `409` as exceeding a per-minute allowance and says to retry after a short delay, but publishes neither the numeric allowance, `Retry-After`, nor a guarantee that a `409` means the message was not accepted. Until live qualification or a written contract establishes that guarantee, BeeSolo should preserve the current conservative classification of `409` as ambiguous rather than automatically retrying. `400`, `401`, `402`, `403`, `405`, and `422` are terminal for the current attempt; configuration, funding, policy, suppression, and coverage must be surfaced distinctly. SMSO does not document `429`; an adapter may defensively recognize it but cannot treat it as the provider's contractual throttle response. [SMSO errors](https://api-docs.smso.ro/#errors)

SMSO status polling accepts the `responseToken` without authentication and returns the recipient number, carrier identifiers, timestamps, and one of `dispatched`, `sent`, `delivered`, `undelivered`, `expired`, or `error`; the latter four are documented as final. The raw token must therefore be encrypted as a confidential correlation key, with a keyed fingerprint for lookup and deduplication. It must never appear in a public URL, Merchant UI, log, trace, queue payload, or audit entry. [SMSO status lookup and statuses](https://api-docs.smso.ro/#checking-the-message-status)

Status callbacks are form POSTs containing the token, status, timestamps, number, MCC, and MNC. SMSO publishes no signature, authorization header, IP range, acknowledgement rule, retry schedule, ordering guarantee, or replay window. Treat a strictly size- and shape-limited callback behind a high-entropy path as an **untrusted wake-up hint** only; an authenticated poll establishes Provider Evidence. The callback edge must durably record the idempotent hint before returning success, and duplicate/out-of-order evidence must not regress a terminal projection or repeat a charge. [SMSO status webhook](https://api-docs.smso.ro/#webhooks)

### Rate limits and abuse controls

SMSO publishes only the qualitative per-minute `409`; there is no public numeric send, burst, concurrency, or daily quota. Account-wide provider admission control must be configuration supplied by the executed route contract and remain below that limit. BeeSolo's existing safer product limits—per Merchant, per destination, per Appointment, and global route kill switches—remain independent controls, not evidence of provider capacity. Provider throttling should delay a durable attempt with jitter only when non-acceptance is certain; it must not create a new attempt identity.

Cloudflare's queue defaults also must not be mistaken for provider limits. Queues default to three retries, can redeliver an entire unacknowledged batch, and discard exhausted messages unless a dead-letter queue is configured. SMS execution requires individual acknowledgement, a DLQ, D1 recovery scans as authority, and no blind coupling between queue retry count and provider submission count. [Cloudflare queue retry behavior](https://developers.cloudflare.com/queues/configuration/batching-retries/), [Cloudflare dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)

### Data protection, retention, and secrets

SMSO's public terms call it a third party/intermediary, place responsibility for recipients and content on its client, and describe storage for a limited evidentiary period under internal procedures followed by deletion without copies or backups. Its public privacy policy primarily addresses SMSO's own clients/site visitors and does not supply a precise message/recipient retention schedule, Article 28 terms, subprocessors, processing locations for the delivery chain, security schedule, breach SLA, or deletion verification. Those gaps cannot be cured by BeeSolo's own privacy notice. Production procurement requires executed role-appropriate terms/DPA, locations/subprocessors, retention and backup deletion, data-subject assistance, incident terms, access/encryption controls, and termination deletion. [SMSO terms, sections 12–13](https://www.smso.ro/termene-si-conditii/), [SMSO privacy policy](https://www.smso.ro/politica-de-confidentialitate/)

Internally, reuse the operational router's purpose-bound rules: never persist rendered bodies; keep approved facts and body fingerprints; crypto-erase encrypted destinations 30 days after terminal resolution and never later than 90 days after the last submission absent a narrow hold; keep normalized operational evidence 180 days; ordinary logs 30 days; malformed-input quarantine at most seven days; security/Operator/incident evidence two years; and financial evidence for the required statutory archive without message bodies or decryptable numbers. Active suppression retains a keyed destination fingerprint and scope only while needed. These are BeeSolo policy decisions documented in [Define Security, Privacy, and Reconciliation](../../.scratch/operational-messaging-router/issues/08-define-security-privacy-and-reconciliation.md), not claims about SMSO retention.

Provider credentials, callback path material, destination encryption/fingerprint keys, and provider-reference keys must be separate environment- and provider-scoped Cloudflare secret bindings available only to the Workers that need them. They never enter D1, source control, UI, queues, fixtures, errors, logs, or traces. Cloudflare explicitly says sensitive values belong in secrets rather than plaintext `vars`, and local `.dev.vars`/`.env` secret files must not be committed. [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

### Testing and provider-light development

SMSO advertises initial signup credit for testing, but publishes no sandbox, dry-run flag, magic destination, simulated receipt, or non-delivering API. Initial credit is real delivery and must use controlled, consenting Romanian test numbers. [SMSO account registration](https://app.smso.ro/register), [SMSO API reference](https://api-docs.smso.ro/)

Local and automated tests should therefore use deterministic router/provider fakes that capture masked destination, purpose, locale, template version, attempt identity, body fingerprint, and segment/cost plan. They must simulate acceptance, rejection, suppression, throttling, ambiguous submission, callback duplication/reordering, polling, insufficient balance, and missing configuration without reading production secrets. `captured` is its own result, never “sent” or “delivered.” Preview and production without all required bindings fail closed as `needs_configuration`.

Production enablement needs a small, capped live qualification across consenting numbers on the Romanian networks the provider says it supports. It must prove exact sender rendering; body/transliteration and single-segment cost; pre/post credit and invoice reconciliation; callback/poll agreement; terminal status timing; duplicate absence; account quota behavior; and the provider's written answers on ambiguity, callback security, retention, and DPA. The existing [SMSO seed-route qualification matrix](../../.scratch/operational-messaging-router/artifacts/smso-ro-seed-route-qualification.md) is the appropriate starting checklist.

## Launch decision

1. Reuse Notifications as the sole outbound SMS router boundary; do not add SMSO calls to Booking routes or components.
2. Keep SMS optional and `needs_configuration` for production until the commercial and procurement gates pass; email continues normally.
3. Resolve the €0.03 incompatibility by either obtaining a written, qualified all-in provider segment cost below the Merchant charge or changing the Merchant price. Public SMSO low-volume pricing is not viable.
4. If qualified, start Romania-only on SMSO's shared short number, one controlled GSM-7 segment, explicit Merchant identity in the body, no inbound replies, and no claim that reply STOP works.
5. Preserve explicit destination-bound Operational Messaging Permission and BeeSolo-owned suppression. Route all opt-out surfaces into the same idempotent suppression directive.
6. Treat SMSO callbacks as unauthenticated hints confirmed by polling; never automatically replay an ambiguous send.
7. Preserve the existing protected-data, retention, secret, fake-adapter, reconciliation, and kill-switch controls.

## Newly exposed decisions and tasks

These are sharp enough to become later Wayfinder work:

- **Resolve the €0.03 SMS Segment Unit Economics** — decide whether to reprice, negotiate a qualified sub-€0.03 route with an explicit margin floor, or omit production SMS at launch.
- **Provision and Qualify the BeeSolo SMS Seed Route** — if SMS remains in launch, execute the provider questionnaire, DPA/security review, account/sender provisioning, controlled cross-network matrix, quota measurement, segmentation/cost reconciliation, and secret handoff.
- **Define Transactional SMS Opt-out Surfaces** — in the later notification-workflow decision, specify the Confirmation/support interaction and Merchant handling that create SMS suppression without pretending the outbound-only route accepts STOP replies.

Literal inbound STOP remains out of scope unless the destination is redrawn to include a dedicated two-way number and inbound messaging lifecycle.
