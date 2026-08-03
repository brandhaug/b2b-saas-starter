# SMSO.ro Delivery Contract Research

Status: complete
Issue: [Research the SMSO.ro Delivery Contract](../../.scratch/operational-messaging-router/issues/02-research-smso-ro-delivery-contract.md)
Researched: 2026-07-27

## Scope and method

This note records the public delivery contract that can be established from current, SMSO-owned primary sources for the Romania launch fallback route. It separates published facts from implementation implications and from facts that still require written provider confirmation. Public documentation was inspected on 2026-07-27; no account was created and no real SMS was sent.

The live [SMSO API reference](https://api-docs.smso.ro/) is the authority for the HTTP surface. Current commercial facts come from the [2026 pricing and packages page](https://www.smso.ro/preturi-si-pachete-sms/), with account facts from the [registration page](https://app.smso.ro/register). SMSO's [terms](https://www.smso.ro/termene-si-conditii/) and [privacy policy](https://www.smso.ro/politica-de-confidentialitate/) provide only broad data-handling language; the privacy policy itself says it was last revised in May 2018, so it is not a substitute for a current DPA, subprocessor list, or security schedule.

## Executive answer

SMSO is technically usable from Cloudflare Workers as a plain server-to-server HTTPS/form API. A successful submission returns a provider `responseToken` and a reported `transaction_cost`; delivery is then learned through polling or form-encoded callbacks. The provider publishes four terminal delivery states and a low-credit error, and its current public Romania price card covers common short-number, dedicated short-number, and personalized-label routes ([API reference](https://api-docs.smso.ro/), [pricing](https://www.smso.ro/preturi-si-pachete-sms/)).

The public contract is not sufficient for production reliability or financial reconciliation without provider confirmation. It does **not** publish submission idempotency, callback authentication, callback retry/ordering rules, a numeric send-rate limit, `Retry-After`, complete GSM/Unicode segmentation rules, the balance debit/refund moment, a sandbox, API-key scopes/rotation, or precise message and recipient-data retention. An ambiguous `POST /send` timeout therefore cannot be retried safely on current evidence.

## Account, team, API key, and sender provisioning

### Documented facts

- A free account can be created with email and a password containing uppercase, lowercase, a number, and at least eight characters; registration requires acceptance of the terms and privacy policy. SMSO says a newly registered account receives initial credit for testing SMS transmission ([registration](https://app.smso.ro/register)).
- SMSO says the API key and documentation are available after account creation, and the API reference points authenticated users to the developer page at `https://app.smso.ro/developers/api` to create or retrieve a key ([SMS API overview](https://www.smso.ro/blog/ce-este-sms-api-si-cum-functioneaza), [API authentication](https://api-docs.smso.ro/#authentication)).
- `GET https://app.smso.ro/api/v1/senders` returns the senders available to the authenticated team as objects shaped like `{ id, name, pricePerMessage }`. `POST /send` requires the numeric sender `id`; it does not accept an arbitrary sender label as the documented contract ([senders and send request](https://api-docs.smso.ro/#senders)).
- Current Romania sender products are: common short number, free and send-only; dedicated short number, EUR 210/month and send/receive, available on request with a stated 3–4 week implementation; and personalized label, EUR 290 at purchase, send-only, maximum 11 alphanumeric characters, available after operator agreements with about one month stated for all Romanian operators ([pricing, sender options](https://www.smso.ro/preturi-si-pachete-sms/)).

### Implications for this router

- The platform-owned route must persist the provider sender `id` returned for the production team, not infer it from a display name or hard-code an example id.
- A common short number is the fastest public launch option, while a brand-like platform sender requires a personalized-label provisioning lead time. A dedicated short number is unnecessary for the launch's outbound-only scope unless SMSO requires it for transactional delivery or the product later adopts inbound messaging.
- "Initial credit for testing" means funded real service, not a non-delivering sandbox; test recipients must be controlled and consented.

### Provider confirmation required

- Company/KYC checks; team creation and membership model; whether a common short-number sender appears immediately; API-key owner versus team semantics; and invoice/account prerequisites.
- Sender application workflow and required trademark/company evidence; allowed character case and reserved words; operator-by-operator activation; approval fees and renewal; and whether all Romanian networks expose the same sender identity.
- Whether the quoted sender fees exclude VAT and whether they are charged before approval, after approval, or per operator activation.

## Authentication and request contract

### Documented facts

- The base API is `https://app.smso.ro/api/v1`. Authenticated endpoints accept `X-Authorization: API-KEY`. SMSO also permits `apiKey=API-KEY` in the query string for GET or POST requests ([API authentication](https://api-docs.smso.ro/#authentication)).
- SMSO inconsistently calls the credential both the team's API key and a personal API key. It publishes no scopes, expiry, rotation, revocation, multiple-key, IP-allowlist, or separate-environment contract ([API authentication](https://api-docs.smso.ro/#authentication)).
- Optional source attribution can be supplied as `X-Source-App: <name/version>` or the `source_app` body field; the header wins. This is attribution, not an authentication control ([API authentication](https://api-docs.smso.ro/#authentication)).
- The documented send request is `POST /send` with form fields. Required fields are `to` in E.164 format (the plus is optional), `sender`, and `body`. Optional fields are `type` (`marketing`, `transactional`, or `otp`), `source_app`, `webhook_status` (legacy alias `webhook`), `webhook_responses`, `generate_unsubscribe_link`, and `remove_special_chars`. JSON request bodies are not documented ([send request](https://api-docs.smso.ro/#messages)).
- `type=marketing` activates SMSO's unsubscribed-user filtering. The launch messages are operational, so `transactional` is the directly matching published type; this classification should still be confirmed contractually for appointment notifications ([send request](https://api-docs.smso.ro/#messages)).
- The successful example is `{ "status": 200, "responseToken": "<uuid>", "transaction_cost": 3.5 }`, with `transaction_cost` described as eurocents ([send response](https://api-docs.smso.ro/#messages)).

### Implications for this router

- Store the key only as a Cloudflare server-side secret and send it in `X-Authorization`. Do not use the supported query-string form, because URLs are routinely retained in logs, traces, and intermediary metadata.
- Submit `application/x-www-form-urlencoded` with `URLSearchParams`; schema-validate the JSON response and preserve the provider token and reported transaction cost verbatim alongside the local attempt.
- Treat `responseToken` as capability-sensitive data. Status lookup is unauthenticated and exposes the receiver number and carrier codes to anyone holding the token.

## Encoding, Unicode, GSM length, and billable segments

### Documented facts

- The price page says its per-SMS prices apply to messages of 160 characters, excluding diacritics and special characters ([pricing notes](https://www.smso.ro/preturi-si-pachete-sms/)).
- `remove_special_chars=1` asks SMSO to replace special characters such as Romanian diacritics with ASCII equivalents; the complete replacement map is not published ([send request](https://api-docs.smso.ro/#messages)).
- SMSO's official `sms-helpers` source exposes `smsLength`, `smsEncoding`, and `smsCleaner`; it names the possible encodings `GSM_7BIT`, `GSM_7BIT_EX`, and `UTF16`, but delegates counting and sanitization to a third-party PHP package and ships no tests. The repository was last updated in 2020, so it is useful evidence of historical intent, not a current billing contract ([official helper README](https://github.com/smso/sms-helpers), [helper source](https://github.com/smso/sms-helpers/blob/master/src/helpers.php), [dependency declaration](https://github.com/smso/sms-helpers/blob/master/composer.json)).

### What is not documented

SMSO does not publish a complete GSM-7 alphabet, extension-table escape counting, Unicode/UCS-2 segment size, concatenated-message sizes, grapheme/code-point/UTF-16 counting rule, maximum body or segment count, long-message reject/truncate/concatenate behavior, or whether `transaction_cost` covers one logical message or every physical segment. Generic industry values such as 70, 153, or 67 characters are therefore **not** an SMSO-specific contractual fact.

### Implications for this router

- Do not use a local segment estimator as the financial source of truth at launch. It may be used only as a conservative UI warning after it is verified against live SMSO outcomes.
- Prefer controlled ASCII Romanian/English templates or explicitly set `remove_special_chars=1`, then validate what SMSO actually delivered. The product decision must weigh predictable cost against loss of Romanian orthography.
- Reconcile the provider-returned `transaction_cost` against the account balance and invoice. Do not charge a merchant from predicted segment count until the provider confirms the charging unit and tests cover boundary characters and lengths.

## Pricing, VAT, and provider balance

### Current public Romania prices

The public price card states that prices apply in Romania, are based on 160-character messages excluding diacritics and special characters, and exclude VAT ([2026 pricing](https://www.smso.ro/preturi-si-pachete-sms/)).

| Plan                         | Published price                           |
| ---------------------------- | ----------------------------------------- |
| Prepay Startup               | EUR 10 / 286 SMS / EUR 0.0350 per SMS     |
| Prepay Enterprise            | EUR 320 / 10,000 SMS / EUR 0.0320 per SMS |
| Prepay Corporate             | EUR 560 / 20,000 SMS / EUR 0.0280 per SMS |
| Postpay, 1–9,999/month       | EUR 0.0350 per SMS                        |
| Postpay, 10,000–19,999/month | EUR 0.0320 per SMS                        |
| Postpay, 20,000–49,999/month | EUR 0.0300 per SMS                        |
| Postpay, 50,000+/month       | Contact SMSO                              |
| Pay as you go                | From EUR 0.0350 per SMS                   |

- Prepaid SMS are paid in advance and have unlimited validity. The page separately advertises postpay and pay-as-you-go arrangements ([pricing notes](https://www.smso.ro/preturi-si-pachete-sms/)).
- SMSO's terms say displayed prices may be RON or EUR, but the reference currency for calculation, payment, and invoicing is local RON; invoicing is exclusively in RON ([terms, payment](https://www.smso.ro/termene-si-conditii/)).
- `GET /credit-check` returns the remaining team credit as `{ "status": 200, "credit_value": 4847.72 }`. The unit of `credit_value` is not stated. A send can return error `402` for insufficient credit ([credit endpoint and errors](https://api-docs.smso.ro/#credit)).

### Unknowns with financial impact

- The unit and precision of `credit_value` and `senders[].pricePerMessage`; FX rate and effective date; rounding; invoice line-item units; and whether account balances represent eurocents, SMS units, or another internal credit.
- Whether balance is reserved/debited at submission, dispatch, or delivery; behavior under concurrent sends; refunds/credits for `undelivered`, `expired`, or `error`; and whether a multi-segment body consumes multiple credits.
- Whether `transaction_cost` is authoritative final provider cost or merely a submission estimate, and whether it includes sender fees or VAT.
- Exact prepay loading latency, low-balance alerting, postpay credit limits, suspension threshold, and contract-specific volume pricing.

These gaps block using SMSO's balance as the merchant-facing Messaging Balance. The platform ledger must remain authoritative, record provider cost separately, and reconcile to provider balance/invoices.

## Submission idempotency and ambiguous outcomes

SMSO publishes no idempotency key, client reference, duplicate-detection window, lookup by client reference, or batch endpoint. The `responseToken` exists only after a successful response, so it cannot deduplicate the first submission ([send request and response](https://api-docs.smso.ro/#messages)).

Consequently, a timeout or connection reset after the Worker transmits `POST /send` is an ambiguous outcome: retrying may create a duplicate customer SMS, while not retrying may omit the fallback. The safe launch design is a durable local attempt with one submission lease, a distinct `submission_unknown` outcome, no automatic replay of that same logical SMS, and an operator reconciliation path. SMSO must confirm whether it has undocumented deduplication or can accept a client idempotency reference before this policy can be relaxed.

## Receipts, polling, and terminal statuses

### Documented facts

- `GET` or `POST https://app.smso.ro/api/v1/status` accepts `responseToken` and explicitly requires no authentication. The example returns `status`, `sent_at`, `delivered_at`, and receiver `number`, MCC, and MNC ([status lookup](https://api-docs.smso.ro/#checking-the-message-status)).
- The published state machine is:

| Status        | Terminal | Provider description                     |
| ------------- | -------- | ---------------------------------------- |
| `dispatched`  | No       | In the process of sending to the network |
| `sent`        | No       | Sent to the network                      |
| `delivered`   | Yes      | Delivered to the phone                   |
| `undelivered` | Yes      | Undelivered                              |
| `expired`     | Yes      | Expired                                  |
| `error`       | Yes      | Error sending                            |

SMSO says a final status permits later updates to be discarded ([status descriptions](https://api-docs.smso.ro/#message-statuses)).

- Status callbacks are form-encoded POSTs with `uuid`, `status`, `sent_at`, optional `delivered_at`, and receiver number/MCC/MNC. Dates are UTC. A callback can be configured at team level or per message via `webhook_status`; `webhook` is a legacy alias ([status webhook](https://api-docs.smso.ro/#webhooks)).
- Reply callbacks can be requested with `webhook_responses` and contain `body`, optional `replied_to`, `received_at`, and sender number/MCC/MNC. Inbound messaging is outside this launch, so this callback should not be enabled ([receiving messages](https://api-docs.smso.ro/#receiving-messages)).

### Implications and unknowns

- Ingest callbacks idempotently by provider UUID and normalized status, allow repeated/non-terminal updates, and refuse regression after the first accepted terminal status. Polling is a recovery mechanism for accepted messages whose callback is missing.
- SMSO does not publish callback ordering, duplicate behavior, retry schedule, timeout, acknowledgement requirement, replay window, or status retention. It also does not define a callback-event id distinct from the message UUID.
- The docs do not specify how long a message may remain `dispatched`/`sent`, when SMSO marks it `expired`, or whether a late terminal update can follow another terminal state. Reconciliation schedules and "unknown" cutoffs require provider confirmation or measured pilot evidence.

## Errors, rate limits, and retry policy

The live API reference publishes these outcomes ([errors](https://api-docs.smso.ro/#errors)):

| Code  | Published meaning                                          | Safe local classification on current evidence                     |
| ----- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `400` | Invalid request; attached errors                           | Terminal input/contract error                                     |
| `401` | Missing or invalid API key                                 | Terminal configuration incident                                   |
| `402` | Insufficient credit                                        | Terminal for this intent under the map's no-auto-replay policy    |
| `403` | Message contains blacklisted words                         | Terminal content/policy error                                     |
| `405` | User unsubscribed                                          | Terminal suppression                                              |
| `409` | Per-minute allowance exceeded; slow down and retry shortly | Potentially transient, but acceptance semantics need confirmation |
| `422` | International messages not allowed                         | Terminal route/configuration error                                |

A harmless unauthenticated status lookup on 2026-07-27 returned `X-RateLimit-Limit: 100` and `X-RateLimit-Remaining: 99`. This is first-party endpoint evidence, but the window and applicability to `/send` are unknown; it must not be treated as the send quota. The reference gives no numeric send limit, `Retry-After`, reset header, burst/concurrency rule, timeout SLA, or documented 5xx retry matrix ([status endpoint](https://app.smso.ro/api/v1/status), [errors](https://api-docs.smso.ro/#errors)).

Only retry a `409` after durable attempt recording and conservative exponential backoff with jitter, and only after SMSO confirms that a `409` response guarantees non-acceptance. Network errors and undocumented 5xx responses remain ambiguous submissions, not automatically retryable. Client-side admission control must be configurable from the contracted send limit.

## Callback authenticity and verification

SMSO's callback examples are plain form POSTs. The public reference provides no webhook signature, shared-secret header, certificate/mTLS scheme, source IP range, timestamp tolerance, or replay-proof nonce; it also specifies no acknowledgement response ([webhooks](https://api-docs.smso.ro/#webhooks)).

Therefore callback field shape alone cannot authenticate SMSO. Until a stronger private contract exists:

- expose a high-entropy, provider-specific callback URL and never display it;
- require a UUID that matches a locally accepted SMSO attempt;
- schema-check every field, compare the receiver to the locally stored masked/hashable identity, validate state transitions, and make duplicate delivery harmless;
- retain raw payloads only in restricted/redacted operational storage; and
- use polling to confirm consequential terminal results rather than treating an unauthenticated callback as independent proof.

A secret URL reduces unsolicited traffic but is not equivalent to a signature. SMSO must confirm whether it preserves callback query parameters, supports a customer-supplied authorization token, has stable egress IP ranges, or can sign callbacks.

## Test mode

SMSO promises initial signup credit for testing sends, but publishes no sandbox hostname, dry-run flag, test API key, magic recipients, simulated receipts, or non-delivering mode ([registration](https://app.smso.ro/register), [API reference](https://api-docs.smso.ro/)). The official documentation source contains a commented-out `/send/sim` section, and the live reference does not expose it; commented historical source is not a supported contract ([official docs source](https://github.com/smso/slate/blob/master/source/includes/_messages.md)).

All testing must therefore be assumed to use real billable/provider-routed SMS and real personal data. Provision controlled Romanian test numbers, cap the test account balance, and verify sender identity, Unicode boundaries, costs, errors, callbacks, polling, duplicates, and terminal states before pilot traffic.

## Secrets, recipient data, and provider security posture

### Published statements

- The terms characterize SMSO as acting under the client's authority for recipient information and say client-database information needed to provide the service is stored for evidentiary purposes for a limited period under internal procedures, then permanently deleted without retained copies or backups. They place responsibility for recipients and message content on the client ([terms, data processing](https://www.smso.ro/termene-si-conditii/)).
- The privacy policy says data may be processed, transferred, or stored in Romania or within the EEA; for other transfers SMSO says it will notify the client in advance and require adequate technical and organizational measures. It provides no current subprocessor or hosting-region list ([privacy policy](https://www.smso.ro/politica-de-confidentialitate/)).
- SMSO says it does not request or store payment-card information; its payment provider processes card data ([privacy policy](https://www.smso.ro/politica-de-confidentialitate/)).

### Gaps requiring a production contract

- Current DPA and precise controller/processor roles for recipient phone numbers and message bodies.
- Named subprocessors, hosting and support-access regions, international-transfer mechanism, and advance-change notice.
- Exact retention for message body, destination, status, API/access logs, callbacks, and backups; deletion/export procedure.
- Encryption at rest, key management, employee access controls, audit logs, vulnerability management, availability/SLA, breach-notification period, business continuity, and deletion on termination.
- API-key scopes, rotation/revocation and compromise response; `responseToken` entropy and status-record retention; and whether provider staff can view message bodies.

The May 2018 privacy revision and broad terms language are inadequate evidence for the launch security review. Do not send secrets, payment data, health data, or unnecessary appointment details in message bodies. Minimize content and retain only the provider fields needed for delivery, cost, suppression, and audit.

## Cloudflare Workers compatibility

Compatibility is a strong engineering inference, not an SMSO support guarantee:

- outbound calls use ordinary HTTPS, header authentication, form-encoded bodies, and JSON responses;
- a Worker can construct the send body with `URLSearchParams` and `fetch` without an SDK;
- callbacks are ordinary HTTPS form POSTs that a Worker can read with `request.formData()`; and
- the public contract does not require a persistent connection, client certificate, filesystem, PHP runtime, or fixed source IP ([API reference](https://api-docs.smso.ro/)).

The JavaScript examples in the API reference are placeholders ("soon"), while the official PHP client is also effectively a stub. Neither library is needed or mature enough to make it the integration boundary ([API reference](https://api-docs.smso.ro/), [official PHP client](https://github.com/smso/smso-php-api)). Use the repository's own Effect HTTP service and schemas.

Confirm with SMSO: supported TLS versions, DNS/endpoint stability, request and connection timeouts, payload limit, whether account security ever requires source-IP allowlisting, and whether Cloudflare egress is accepted. Browser CORS is irrelevant because the call is Worker-to-provider.

## Concrete launch and provisioning tasks

1. Create the SMSO legal/account owner, team, billing profile, and least-access operator users; accept the current contract only after legal/security review.
2. Select and order the sender route. For the fastest outbound pilot, confirm availability of the common short number; in parallel decide whether the platform brand needs the personalized 11-character label and start its operator agreements at least one month before launch.
3. Obtain a production API key, record owner and rotation procedure, store it as a Cloudflare secret, and verify that the team exposes the expected sender id through `GET /senders`.
4. Execute a written provider-confirmation checklist covering all unknowns in this note, especially idempotency, callback authentication/retry, send quotas, segmentation/cost units, debit/refund timing, and DPA/security terms.
5. Fund a tightly capped seed/test balance. Record the unit returned by `/credit-check`, submit controlled real messages across Romanian networks, and reconcile pre/post balance, `transaction_cost`, terminal state, and invoice outcome.
6. Run an encoding matrix: GSM basic characters, extension characters, Romanian diacritics, emoji, ASCII transliteration, and boundaries around single/concatenated segments. Record message body, provider cost, handset rendering, and receipt.
7. Register the high-entropy Worker callback URL at team level or per message as agreed; test duplicate, reordered, malformed, spoofed, and missing callbacks, then prove polling recovery.
8. Measure actual accepted request rate and callback pressure below the contracted quota; configure admission control and `409` backoff without using the observed status-endpoint header as the send limit.
9. Add provider-balance monitoring and reconciliation alerts, but keep the platform Messaging Balance and merchant charge ledger authoritative.
10. Complete a security/privacy launch review of the signed DPA, retention, subprocessors, breach terms, credentials, and message-content minimization before allowlisted pilot traffic.

## Provider confirmation checklist

The following questions should receive written answers or contract amendments before production:

1. What exact sender will the platform use, which Romanian networks support it, and what provisioning/KYC/ownership evidence and lead time apply?
2. Are API keys team-wide or user-owned; can two active scoped keys support zero-downtime rotation; what revocation, expiry, and IP controls exist?
3. What exact algorithm determines GSM-7, extension, Unicode, concatenation, maximum length, and `transaction_cost` for every body?
4. What are the units of `credit_value`, `pricePerMessage`, and `transaction_cost`; when is balance debited; which failed states are refunded; how are FX, VAT, and rounding handled?
5. Is there a supported idempotency/client-reference mechanism? If not, what outcome guarantee applies to timeouts, 409s, and 5xx responses?
6. What are the numeric send/burst/concurrency limits, headers, backoff rules, and non-acceptance guarantees for retriable responses?
7. How are callbacks authenticated; what are their timeout, acknowledgement, retry, duplicate, ordering, and replay rules; can SMSO sign them or publish egress IP ranges?
8. How long can non-terminal states last; how long is status queryable; can terminal states change; and what reconciliation export/API is available?
9. Is any sandbox or non-delivering test mode available, or must all tests use real numbers and paid traffic?
10. What DPA, processor role, subprocessor list, regions, retention/deletion, encryption, staff access, breach SLA, availability SLA, and termination-export terms apply?

## Source register

All sources were accessed on 2026-07-27.

| SMSO-owned source                                                                | Used for                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Live API reference](https://api-docs.smso.ro/)                                  | Authentication, send request/response, senders, status, callbacks, errors, credit |
| [Account registration](https://app.smso.ro/register)                             | Account fields, password rules, initial testing credit                            |
| [Developer/API-key page](https://app.smso.ro/developers/api)                     | Authenticated key-management location; content requires login                     |
| [2026 pricing and packages](https://www.smso.ro/preturi-si-pachete-sms/)         | Current Romania rates, VAT note, prepay validity, sender types/fees/lead times    |
| [Terms and conditions](https://www.smso.ro/termene-si-conditii/)                 | RON invoicing, service/payment terms, recipient-data role and retention language  |
| [Privacy policy](https://www.smso.ro/politica-de-confidentialitate/)             | Broad storage/transfer/payment-card statements; page says last revised May 2018   |
| [SMS API overview](https://www.smso.ro/blog/ce-este-sms-api-si-cum-functioneaza) | Post-registration API access and historical free-test-credit claim                |
| [2-Way SMS product page](https://www.smso.ro/produse/2-way-sms/)                 | Dedicated-number inbound capability context                                       |
| [Official SMS helper repository](https://github.com/smso/sms-helpers)            | Historical encoding helper names and implementation limits                        |
| [Official PHP API repository](https://github.com/smso/smso-php-api)              | Evidence that the published PHP client is a stub                                  |
| [Official API-doc source repository](https://github.com/smso/slate)              | Historical/commented `/send/sim` evidence; live docs remain authoritative         |
