# Operational Messaging Governance and Fiscal Readiness Approval Packet

Status: **BLOCKED — professional approvals and executed evidence not yet supplied**  
Prepared: 2026-07-29  
Owner ticket: [Finalize Messaging Governance and Fiscal Readiness](../../issues/30-finalize-messaging-governance-and-fiscal-readiness.md)

This packet is a controlled approval checklist, not legal, privacy, payments, tax, or accounting advice. It distinguishes implemented product facts from decisions that must be made by the named Romanian professionals and authorized BeeSolo signatories. Empty approval fields are not approval.

## Completion rule

The owner ticket may be resolved only when all of the following are true:

1. The stage-specific role matrix is approved against executed Meta and SMSO.ro terms and the real production processing chain.
2. Required privacy notice, processing record, contract/DPA or joint-controller text, transfer assessment, and provider/subprocessor register updates are executed and effective-dated.
3. Lawful-basis records and every required legitimate-interest assessment are signed.
4. Retention, complaint, suppression, incident, deletion, and legal-hold procedures are approved, owned, and linked to operational runbooks.
5. Romanian payments counsel approves the closed-loop Messaging Balance terms and regulatory treatment.
6. A Romanian accountant signs a memo settling every fiscal decision in this packet.
7. Redacted evidence is stored in the evidence register below and independently checked against the implemented behavior.
8. Every mismatch is either corrected in product/ledger behavior through an explicit blocker or causes launch to remain blocked. The approval record must never be weakened to fit the code.

## Approval roster

| Authority                           | Named approver | Organization / capacity | Approval date | Evidence reference | State   |
| ----------------------------------- | -------------- | ----------------------- | ------------- | ------------------ | ------- |
| Romanian privacy counsel or DPO     | Required       | Required                | —             | —                  | Missing |
| Romanian payments counsel           | Required       | Required                | —             | —                  | Missing |
| Romanian accountant / tax adviser   | Required       | Required                | —             | —                  | Missing |
| BeeSolo privacy owner               | Required       | Required                | —             | —                  | Missing |
| BeeSolo finance owner               | Required       | Required                | —             | —                  | Missing |
| BeeSolo incident owner              | Required       | Required                | —             | —                  | Missing |
| BeeSolo authorized launch signatory | Required       | Required                | —             | —                  | Missing |

## Implemented facts supplied for review

These are inputs to professional review, not conclusions about legal or fiscal treatment.

- Launch events are appointment confirmation, one reminder, cancellation, and reschedule. Controlled templates prohibit marketing, offers, cross-sells, review requests, and arbitrary Merchant-authored content.
- The booking flow records provider-neutral Operational Messaging Permission for the supplied mobile number. Routing is WhatsApp first with SMS fallback under fixed eligibility and terminal-failure rules.
- The Merchant controls whether supported events are enabled. BeeSolo controls shared senders, templates, routing, eligibility, suppression enforcement, security, abuse prevention, billing, reconciliation, complaints, and statutory evidence.
- Destinations are protected and routine projections are masked. Rendered message bodies are not persisted. Provider Evidence is allowlisted and provider references are protected.
- The ordinary Merchant price is EUR 0.045 excluding VAT for one verified Chargeable Delivery. Retries, fallback, failed attempts, and extra provider deliveries do not create additional ordinary Merchant charges.
- The ledger uses exact milli-euros. Top-up credit amounts accepted by the finance capability are EUR 10, EUR 25, or EUR 50. A top-up requires confirmed provider-payment evidence and a fiscal reference.
- The ledger distinguishes top-up, delivery charge, Operator adjustment, refund, correction, and promotional credit. Cash refunds require provider-refund evidence and a fiscal reference; refund failure restores credit with an idempotent compensating correction.
- Financial external facts distinguish provider payment, provider refund, invoice, credit note, and RO e-Factura evidence. The capability stores evidence and exposes reconciliation inputs; it does not decide VAT, invoice issuance, revenue recognition, or general-ledger postings.
- The implementation currently expects at least 30 days' notice before an effective-dated price change.

Implementation evidence:

- [`messaging-finance.ts`](../../../../packages/capabilities/src/notifications/messaging-finance.ts)
- [`messaging-finance.live.test.ts`](../../../../packages/capabilities/src/notifications/messaging-finance.live.test.ts)
- [`schema.ts`](../../../../packages/db/src/schema.ts)
- [`20260729140000_messaging_financial_invariants/migration.sql`](../../../../packages/db/migrations/20260729140000_messaging_financial_invariants/migration.sql)
- [Implement Messaging Balance and the Rate Card — resolution](../../issues/19-implement-messaging-balance-and-rate-card.md#comments)

## Messaging Processing Role Matrix

The “working allocation” column records product facts to be reviewed. Counsel must replace every `Pending` cell with the applicable factual role and required instrument; blanket labels for the entire lifecycle are not acceptable.

| Processing stage / purpose                                               | Working allocation to validate                                                                                           | Meta role and instrument     | SMSO.ro role and instrument   | BeeSolo–Merchant instrument / notice | Counsel approval |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------- | ------------------------------------ | ---------------- | ------- |
| Appointment relationship and enabled event purposes                      | Merchant determines customer relationship and enabled supported events; BeeSolo supplies the bounded platform capability | Pending executed-term review | Pending executed-term review  | Pending                              | Missing          |
| Permission capture and proof                                             | BeeSolo defines the platform control and proof schema; Merchant enables the capability                                   | Pending                      | N/A or Pending, to be decided | Pending                              | Missing          |
| Template content and operational classification                          | BeeSolo fixes controlled templates; Merchant identity and appointment facts populate approved fields                     | Pending                      | Pending                       | Pending                              | Missing          |
| Eligibility, channel order, routing, and fallback                        | BeeSolo independently fixes enforcement and route logic                                                                  | Pending                      | Pending                       | Pending                              | Missing          |
| Provider submission and delivery evidence                                | BeeSolo operates platform-owned provider accounts and shared senders                                                     | Pending                      | Pending                       | Pending                              | Missing          |
| Suppression, objections, blocks, wrong-recipient reports, and complaints | BeeSolo enforces platform/provider suppression and complaint controls; Merchant must honor applicable customer rights    | Pending                      | Pending                       | Pending                              | Pending          | Missing |
| Security, abuse prevention, reconciliation, and incidents                | BeeSolo determines platform security, integrity, containment, and statutory response                                     | Pending                      | Pending                       | Pending                              | Pending          | Missing |
| Messaging Balance, provider costs, invoices, and accounting evidence     | BeeSolo determines its billing, reconciliation, and accounting purposes                                                  | Pending                      | Pending                       | Pending                              | Pending          | Missing |
| Retention, deletion, and legal holds                                     | BeeSolo applies purpose-specific platform retention; Merchant obligations and request handling require allocation        | Pending                      | Pending                       | Pending                              | Pending          | Missing |

Counsel must record for each stage whether the parties act as controller, joint controllers, processor/subprocessor, or outside the relevant processing; identify GDPR articles 26/28 arrangements where applicable; and verify that the contract, privacy notice, processing record, rights workflow, and transfer documentation agree.

## Lawful-basis and legitimate-interest record

Counsel must approve a separate row for each purpose and actor. Provider permission rules must not be represented as the GDPR lawful basis.

| Purpose / operation                                      | Candidate requiring validation                                                | Necessity and less-intrusive-alternative record | Reasonable expectations / impact | Safeguards and right handling                               | Signed record |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------- | ----------------------------------------------------------- | ------------- |
| Appointment confirmation                                 | Contract necessity may be available only if objectively necessary             | Required                                        | Required                         | Controlled content, minimization, suppression               | Missing       |
| Cancellation notice                                      | Contract necessity may be available only if objectively necessary             | Required                                        | Required                         | Controlled content, minimization, suppression               | Missing       |
| Reschedule notice                                        | Contract necessity may be available only if objectively necessary             | Required                                        | Required                         | Controlled content, minimization, suppression               | Missing       |
| Optional reminder                                        | Legitimate interests is the candidate identified by decision-support research | Required LIA                                    | Required LIA                     | One reminder, Shop-time window, objection/suppression       | Missing       |
| Permission and suppression evidence                      | Purpose-specific basis must be selected                                       | Required                                        | Required                         | Minimal proof, scoped fingerprint, rights handling          | Missing       |
| Delivery integrity and reconciliation evidence           | Legitimate interests and/or legal obligation must be allocated per fact       | Required where applicable                       | Required                         | Pseudonymization, narrow access, expiry                     | Missing       |
| Billing, invoice, tax, and statutory accounting evidence | Legal obligation / contract allocation must be specified by actor and record  | Required                                        | Required                         | No message body or decryptable number in financial evidence | Missing       |
| Security, abuse, complaint, and incident evidence        | Legitimate interests / legal obligation must be specified per purpose         | Required where applicable                       | Required                         | Masking, narrow access, holds, incident procedure           | Missing       |

The signed record must also decide Article 9 handling. The product should not transmit service names or notes capable of revealing special-category data unless an approved condition and bounded template exist.

## Provider, subprocessor, and transfer assessment

Complete from executed, effective terms—not public marketing pages alone.

| Provider / subprocessor                        | Legal entity and service | Processing locations and support access | Role by stage | Transfer mechanism | TIA / supplementary measures | Retention / deletion | Breach and assistance terms | Change notice | Evidence |
| ---------------------------------------------- | ------------------------ | --------------------------------------- | ------------- | ------------------ | ---------------------------- | -------------------- | --------------------------- | ------------- | -------- |
| Meta / WhatsApp Cloud API                      | Missing                  | Missing                                 | Missing       | Missing            | Missing                      | Missing              | Missing                     | Missing       | Missing  |
| Meta-listed subprocessors                      | Missing                  | Missing                                 | Missing       | Missing            | Missing                      | Missing              | Missing                     | Missing       | Missing  |
| SMSO.ro                                        | Missing                  | Missing                                 | Missing       | Missing            | Missing                      | Missing              | Missing                     | Missing       | Missing  |
| SMSO.ro subprocessors / carriers               | Missing                  | Missing                                 | Missing       | Missing            | Missing                      | Missing              | Missing                     | Missing       | Missing  |
| Cloudflare services used by the messaging path | Missing                  | Missing                                 | Missing       | Missing            | Missing                      | Missing              | Missing                     | Missing       | Missing  |

The final register must reconcile every production region, onward transfer, support-access location, deletion commitment, and provider-retained record with the privacy notice and processing record.

## Operational procedures requiring approval

| Procedure                                 | Minimum approved content                                                                                                                                                                                                                                                                                                                                            | Named owner / backup | Runbook evidence | Exercise or acceptance evidence | State   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ------------------------------- | ------- |
| Retention and deletion                    | Destinations actionable/reconciling plus 30 days after terminal, never beyond 90 days after last submission without narrow hold; controlled facts and normalized evidence 180 days; logs 30 days; malformed quarantine 7 days; security/audit/incident/closed reconciliation 2 years; financial evidence statutory archive; retryable tombstones and crypto-erasure | Missing              | Missing          | Missing                         | Missing |
| Suppression and objections                | Provider blocks/opt-outs, wrong-recipient reports, applicable GDPR objections, exact scope, proof, no blind replay, deletion interaction                                                                                                                                                                                                                            | Missing              | Missing          | Missing                         | Missing |
| Complaint handling                        | Monitored intake, identity/scope validation, containment, Merchant coordination, evidence preservation, response deadlines, trend thresholds, closure                                                                                                                                                                                                               | Missing              | Missing          | Missing                         | Missing |
| Incident response                         | Unauthorized messaging, continued-after-suppression, personal-data exposure, credential/key compromise, forged callback, ambiguity, duplicate delivery, incorrect charging; narrow containment; GDPR 72-hour decision workflow                                                                                                                                      | Missing              | Missing          | Missing                         | Missing |
| Legal holds                               | Authorized requester, exact records and purpose, start/end, review cadence, release, audit, deletion resumption; no whole-Merchant hold by default                                                                                                                                                                                                                  | Missing              | Missing          | Missing                         | Missing |
| Data-subject rights and Merchant requests | Controller allocation, intake route, search/export/correction/deletion limits, provider assistance, statutory exceptions, audit                                                                                                                                                                                                                                     | Missing              | Missing          | Missing                         | Missing |
| Financial reconciliation and correction   | Daily evidence comparison, untrusted-balance Merchant freeze, immutable correction, two-person recovery where required, no silent mutation                                                                                                                                                                                                                          | Missing              | Missing          | Missing                         | Missing |

Counsel must explicitly accept or replace every proposed retention period. A period appearing in a prior product decision is not professional approval.

## Closed-loop Messaging Balance terms approval

Romanian payments counsel must approve the final customer terms and record the exact basis for the regulatory conclusion. The final terms and product must agree on all of these points:

- credit is accepted only by BeeSolo for BeeSolo Operational Messaging services;
- credit is Merchant-specific, non-transferable, and never usable for person-to-person or third-party payment;
- there is no ordinary cash withdrawal or cash redemption on demand;
- purchased credit does not expire while the Merchant is retained;
- refunds are limited to documented legal requirement, duplicate/erroneous payment, service termination, or explicit platform decision;
- promotional credit is separately identified and may be non-refundable only under approved terms;
- permanent deletion triggers review of unused purchased credit before deletion;
- pricing, VAT presentation, statements, correction rights, suspension/freeze behavior, termination, complaints, and applicable law are disclosed;
- counsel has considered electronic-money and payment-services treatment, including any limited-network issue, against the actual issuer, payment flow, refundability, and acceptance model.

Payments-counsel decision: **Missing**  
Approved terms version / effective date: **Missing**  
Redacted opinion evidence: **Missing**

## Romanian accountant memo — mandatory decisions

The accountant must provide a signed, dated memo tied to the actual BeeSolo legal entity, VAT registration, customer population, payment flow, chart of accounts, and launch date. “Current product expectation” is not a tax conclusion.

| Question the memo must settle                                                                                           | Current product / ledger expectation to validate                                                                                 | Accountant decision and implementation instruction |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Is each top-up an advance payment, single-purpose voucher, multi-purpose voucher, or another instrument?                | Net service credit is posted only after confirmed provider payment                                                               | Missing                                            |
| What is the VAT chargeability point and applicable rate for each supported Merchant/customer case?                      | VAT is outside the milli-euro Messaging Balance; the code does not select rate or tax point                                      | Missing                                            |
| Are EUR 10/25/50 presented as net credit plus VAT or VAT-inclusive receipts?                                            | Finance capability credits exactly EUR 10/25/50 net value                                                                        | Missing                                            |
| What invoice is issued, by when, and for which amount/currency/customer identity?                                       | One invoice evidence record per confirmed top-up; no per-delivery invoice                                                        | Missing                                            |
| What rounding method and precision apply to net, VAT, invoice totals, refunds, and ledger-to-invoice reconciliation?    | Delivery consumption is exact to EUR 0.001; invoice/VAT rounding is not encoded                                                  | Missing                                            |
| What RO e-Factura population, transmission deadline, acknowledgement, rejection, correction, and outage behavior apply? | External facts can record e-Factura state; no issuance workflow is inferred                                                      | Missing                                            |
| What document and ledger treatment applies to a full or partial cash refund?                                            | Debit available credit, request provider refund, link credit note/fiscal evidence, compensate on provider failure                | Missing                                            |
| When is a credit note required and how does it link to the original invoice/e-Factura?                                  | Credit-note evidence type exists and a refund requires a fiscal reference                                                        | Missing                                            |
| How are Operator adjustments classified and documented?                                                                 | `messaging:finance`, actor, reason, source, idempotency, and immutable entry are required                                        | Missing                                            |
| How is promotional credit taxed, invoiced, valued, expired/removed, refunded, and recognized?                           | Separate promotional-credit ledger kind; no tax/accounting behavior is inferred                                                  | Missing                                            |
| When is revenue recognized: top-up, delivery, breakage, expiry/termination, or another point?                           | Product charges balance only on verified delivery; general-ledger recognition is not implemented                                 | Missing                                            |
| How are unused balances, deferred revenue / contract liabilities, provider costs, FX, and margin posted?                | Provider costs retain provider-native currency/precision separately from EUR Merchant charges                                    | Missing                                            |
| What happens to purchased and promotional credit at termination or permanent deletion?                                  | Purchased credit receives refund review; promotional removal requires approved terms                                             | Missing                                            |
| Which records must be kept, in what form, and for what exact statutory period?                                          | Financial evidence is planned for five-year statutory archive calculated from 1 July after the financial year, plus narrow holds | Missing                                            |
| What accounting-period close, reconciliation, correction, and audit evidence is required?                               | Daily reconciliation and append-only compensating corrections; no silent mutation                                                | Missing                                            |

Accountant approval: **Missing**  
Memo version / date: **Missing**  
Redacted memo evidence: **Missing**

## Product and ledger conformance review

After approvals arrive, an engineer and finance owner must compare every instruction against code, migrations, tests, UI copy, provider/payment integration, invoices, e-Factura workflow, accounting exports, terms, and runbooks.

| Approved instruction | Current behavior evidence | Match?  | Required correction ticket | Launch blocker cleared by |
| -------------------- | ------------------------- | ------- | -------------------------- | ------------------------- |
| Pending              | Pending                   | Pending | Pending                    | Pending                   |

Any `No` creates a new explicit blocking ticket, which must block both the affected implementation ticket and [Prove the Messaging Launch Gate and Enable Operational Messaging](../../issues/31-prove-launch-gate-and-enable-operational-messaging.md). Do not edit this packet to manufacture a match.

## Redacted evidence register

Store only launch-review-safe copies. Remove credentials, account numbers, phone numbers, signatures not needed for proof, raw provider identifiers, message bodies, and personal data while retaining issuer, authority, document version, effective date, scope, approval, and integrity reference.

| Evidence ID | Required artifact                                                 | Version / effective date | Redacted repository path or controlled-system reference | Integrity hash / immutable ID | Verified by | State   |
| ----------- | ----------------------------------------------------------------- | ------------------------ | ------------------------------------------------------- | ----------------------------- | ----------- | ------- |
| GOV-01      | Approved Messaging Processing Role Matrix                         | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-02      | Executed BeeSolo–Merchant privacy/processing terms                | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-03      | Effective privacy notice and processing record                    | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-04      | Signed lawful-basis records / LIAs                                | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-05      | Executed Meta terms/DPA and provider/subprocessor snapshot        | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-06      | Executed SMSO.ro terms/DPA and provider/subprocessor snapshot     | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-07      | Transfer inventory, TIA, and safeguards                           | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-08      | Approved retention/deletion/legal-hold schedule and procedures    | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-09      | Approved complaint/suppression/rights procedures                  | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-10      | Approved incident procedure and response ownership                | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| GOV-11      | Approved closed-loop Messaging Balance terms and payments opinion | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| FIS-01      | Signed Romanian accountant memo                                   | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| FIS-02      | Approved invoice, credit-note, and RO e-Factura workflow evidence | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| CON-01      | Product/ledger conformance report with tests and fiscal samples   | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |
| CON-02      | Closure evidence for every correction blocker                     | Missing                  | Missing                                                 | Missing                       | Missing     | Missing |

## Final sign-off

Privacy/DPO sign-off: **Missing**  
Payments-counsel sign-off: **Missing**  
Accountant sign-off: **Missing**  
Finance-owner sign-off: **Missing**  
Incident-owner sign-off: **Missing**  
Engineering conformance sign-off: **Missing**  
Authorized launch sign-off: **Missing**

Final outcome: **NOT READY — launch remains blocked**
