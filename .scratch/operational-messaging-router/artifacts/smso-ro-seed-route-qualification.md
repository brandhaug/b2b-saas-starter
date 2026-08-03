# SMSO.ro Seed Route Qualification

Issue: [Provision and Qualify the SMSO.ro Seed Route](../issues/13-provision-and-qualify-smso-ro-seed-route.md)

Observed: 2026-07-27

Timing decision: keep this record as the pre-production qualification plan. Development uses a console/fake provider and deterministic fixtures; do not continue live setup or sends until the real adapter, callback receiver, reconciliation path, and production-like environment are ready.

## Provisioning record

| Control                | Observed state                                                                                                   | Qualification implication                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal account          | Account created; legal billing profile not yet completed                                                         | Production use remains blocked until the account owner supplies and verifies the legal entity details                                       |
| Team                   | One owner/administrator; team name is unfinished; no separate operator member                                    | Least-access operation is not proven; SMSO's UI does not expose a role choice while inviting a member                                       |
| Test balance           | Initial credit shown as €3.50 / 100 test SMS                                                                     | This is the capped seed balance; do not buy more credit until the matrix demonstrates a need                                                |
| API credential         | One 40-character API credential exists                                                                           | Treat as production-capable and reusable; rotation, parallel-key, scope, expiry, and revocation behavior still require written confirmation |
| Sender                 | Common `1XXX`, numeric sender ID `4`, send-only, €0/year, shown as purchased                                     | Use this as the seed Romania route; a personalized label and dedicated two-way short number are not needed for the launch qualification     |
| Callback configuration | Team settings expose delivery and response webhook URLs plus JSON, query-string, and compatibility payload modes | Use delivery callbacks only; leave response/inbound callbacks disabled because inbound messaging is out of scope                            |
| Billing profile        | Empty                                                                                                            | Requires legal representative, company/CUI/registration, bank/IBAN, and Romanian address details before invoiced production funding         |

Do not record the API key, account password, unmasked test numbers, legal identifiers, or bank details in this artifact.

## Provider questionnaire

Send the following through SMSO's authenticated support/contact channel and retain the written reply as evidence:

> We are qualifying SMSO as the Romanian transactional SMS fallback for a booking platform. Our launch route uses the common 1XXX sender (sender ID 4) and appointment confirmations, reminders, cancellations, and reschedules only—no marketing or inbound messaging. Please answer the following for our production/security review:
>
> 1. Which Romanian mobile networks support this sender, and are any KYC, ownership, content, throughput, or approval steps still required before production?
> 2. Is the API key team-wide or user-owned? Can two active keys be used for zero-downtime rotation? What scopes, expiry, revocation, IP allowlisting, and audit controls exist?
> 3. What exact GSM-7, extension-table, Unicode/UCS-2, concatenation, maximum-length, transliteration, and rounding algorithm determines physical segments and `transaction_cost`?
> 4. What are the exact units of `credit_value`, `pricePerMessage`, and `transaction_cost`? When is credit debited; which rejection or terminal-failure states are refunded; and how are VAT, FX, invoices, and rounding handled?
> 5. Is there an idempotency key, client reference, duplicate-detection window, or submission lookup? For network timeouts, HTTP 409, and 5xx responses, which responses guarantee that no SMS was accepted?
> 6. What numeric send, burst, concurrency, and daily limits apply? Which rate-limit headers and `Retry-After`/backoff rules are contractual?
> 7. Can delivery callbacks be authenticated by signature, customer-supplied authorization header/query secret, mTLS, or published egress IP ranges? What are the acknowledgement, timeout, retry, duplicate, ordering, and replay rules?
> 8. How long can `dispatched` and `sent` remain non-terminal? How long is `/status` queryable? Can a terminal status change, and is any reconciliation export/API available?
> 9. Is there a supported sandbox, dry-run, simulated receipt, magic recipient, or other non-delivering test mode?
> 10. Please provide the current DPA, GDPR role, subprocessor and processing-location list, retention/deletion schedule (including backups), encryption and staff-access controls, breach-notification SLA, availability/support SLA, security-contact process, and termination/export/deletion terms.
> 11. Please confirm supported TLS versions, API payload/body limits, recommended connection/request timeouts, endpoint/DNS change notice, and whether Cloudflare Workers egress is supported without fixed source IPs.

## Controlled test data rules

- Use only numbers whose owners explicitly agreed to receive the qualification SMS.
- Store numbers as named aliases in the evidence (`NET-A`, `NET-B`, `NET-C`), never unmasked values.
- Use synthetic content with a test case ID; no appointment, merchant, customer, or health-adjacent data.
- Send during Romanian daytime and cap the entire first pass at €3.50.
- Record the provider token only in restricted operational evidence; the issue/map records only a redacted suffix if correlation is necessary.
- Stop immediately on unexpected multi-segment cost, duplicate delivery, provider suppression, unknown debit, or a missing terminal state.

## Qualification matrix

| Case | Purpose                  | Body class                                                                                                | Recipients                                                                      | Submit path                  | Required evidence                                                              | Pass condition                                                                  |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| E1   | GSM basic baseline       | ASCII/GSM basic, comfortably below 160 characters                                                         | NET-A                                                                           | API                          | Pre/post credit, `transaction_cost`, handset rendering, callback, polling      | One intended message, matching content, terminal `delivered`, cost reconciles   |
| E2   | GSM extension counting   | Includes `^{}\\[~]                                                                                        | €`; test immediately below/above the provider-confirmed single-segment boundary | NET-A                        | API                                                                            | Same as E1 plus reported segment/cost explanation                               | Observed count and cost match provider's written algorithm |
| E3   | Romanian Unicode         | Includes `ăâîșț` immediately below/above the provider-confirmed Unicode boundary                          | NET-A                                                                           | API                          | Original body, handset rendering, cost                                         | Diacritics preserved and cost matches contract                                  |
| E4   | Transliteration          | Romanian diacritics with `remove_special_chars=1`                                                         | NET-A                                                                           | API                          | Submitted body, rendered body, cost                                            | Replacement map and cost are deterministic and documented                       |
| E5   | Emoji/surrogate handling | Includes one emoji near the provider-confirmed Unicode boundary                                           | NET-A                                                                           | API                          | Rendering, acceptance/rejection, cost                                          | Behavior is deterministic, documented, and within product policy                |
| N1   | Cross-network delivery   | E1 body                                                                                                   | NET-A, NET-B, NET-C on distinct observed MCC/MNC routes                         | API                          | Callback and poll status/timestamps/MCC/MNC                                    | Every supported route reaches a terminal result; supported-network set is known |
| C1   | Callback baseline        | E1 body                                                                                                   | NET-A                                                                           | API with delivery callback   | Raw callback envelope in restricted evidence, acknowledgement, poll comparison | Callback correlates to accepted token and polling agrees                        |
| C2   | Callback recovery        | Temporarily make callback unavailable for one test                                                        | NET-A                                                                           | API                          | Provider retry timing and polling result                                       | Polling recovers truth; retry behavior matches written contract                 |
| C3   | Callback trust           | Synthetic malformed, unknown-token, duplicate, and reordered callbacks against the qualification receiver | None                                                                            | Local/qualification receiver | Rejection/ignore logs                                                          | Unknown/malformed input cannot create or regress delivery state                 |
| P1   | Polling retention        | Poll E1/N1 tokens on the agreed schedule and once near the retention boundary                             | None                                                                            | Status API                   | HTTP/status/timestamp observations                                             | Status remains queryable for the contracted period                              |
| T1   | Conservative throughput  | Small stepped bursts below the written quota (for example 2, then 5, then 10 only if contracted)          | Consenting test pool                                                            | API                          | Acceptance rate, status, headers, latency, any 409/429                         | No unexpected rejection; configured admission rate stays below contract         |
| F1   | Terminal failure/refund  | Provider-approved non-delivering test or controlled inactive number only                                  | Provider-approved target                                                        | API                          | Terminal state, debit/refund timing, invoice effect                            | Failure is terminal and financial behavior matches written contract             |
| A1   | Ambiguous submission     | Provider-assisted fault injection only; do not induce blind production timeouts                           | Provider-approved target                                                        | API                          | Provider explanation and lookup outcome                                        | No automatic duplicate replay; operational reconciliation path is viable        |

## Evidence record per real send

| Field                               | Record |
| ----------------------------------- | ------ |
| Case ID / timestamp UTC             |        |
| Recipient alias / observed MCC-MNC  |        |
| Body hash and character class       |        |
| `remove_special_chars`              |        |
| Sender ID                           | `4`    |
| Pre-submit credit                   |        |
| HTTP outcome / latency              |        |
| Provider token suffix               |        |
| `transaction_cost` and stated unit  |        |
| Post-submit / post-terminal credit  |        |
| Callback status/timestamps          |        |
| Poll status/timestamps              |        |
| Handset rendering / duplicate count |        |
| Invoice/refund observation          |        |
| Pass/fail and anomaly               |        |

## Pre-production owner inputs

1. Legal billing details and authority to submit them to SMSO.
2. A platform/team display name.
3. An operational member email to invite, or an explicit decision to keep the owner as the only user during seed qualification.
4. Consenting Romanian test-number aliases covering at least three distinct networks, plus permission to send the capped matrix.
5. Permission to send the provider questionnaire above.
6. A production Cloudflare environment/Worker target for the API secret and high-entropy callback endpoint. The existing Background Worker is the current architectural default, but its remote config still contains placeholder infrastructure and the provider adapter is not implemented.
