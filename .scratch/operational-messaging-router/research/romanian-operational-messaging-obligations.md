# Romanian Operational Messaging Obligations

Research date: 27 July 2026  
Scope: platform-sent WhatsApp and SMS appointment confirmations, one reminder, cancellations, and reschedules for a Romania-first launch. Marketing, inbound messaging, and payment messages are outside scope.  
Status: decision-support research, not legal or tax advice. Romanian counsel and an accountant should validate the marked items before production.

## Executive determinations

1. **Strictly operational booking messages are not, on the better reading, “commercial communications” merely because they concern a paid appointment.** Romanian Law 365/2002 defines a commercial communication by its promotional purpose, and Law 506/2004 applies prior-consent rules to unsolicited _commercial_ communications. A confirmation, reminder, cancellation, or reschedule that contains only information needed to administer an existing or requested appointment is not designed to promote goods, services, or image. Any offer, upsell, review request, loyalty copy, re-engagement, or promotional branding beyond source identification could change that classification and should be prohibited in operational templates. [Law 365/2002, art. 1(8), consolidated text](https://legislatie.just.ro/Public/DetaliiDocumentAfis/288595); [Law 506/2004, art. 12, consolidated through 8 October 2024](https://legislatie.just.ro/Public/DetaliiDocument/257056); [Directive 2000/31/EC, art. 2(f)](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32000L0031).

2. **Romanian law does not require prior electronic-marketing consent for those genuinely operational messages.** The personal-data processing still needs a GDPR legal basis. Contract necessity under GDPR art. 6(1)(b) is plausible only where the message and chosen processing are objectively necessary to perform or take requested pre-contract steps. Legitimate interests under art. 6(1)(f), supported by a documented necessity and balancing assessment, is the safer candidate for optional reminders and delivery evidence that is useful but not strictly necessary. Do not use consent as the GDPR basis unless the product can deliver genuine refusal and withdrawal without detriment. [GDPR, arts. 5-6](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/); [EDPB Guidelines 2/2019, version 2.0, 8 October 2019](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines-art-6-1-b-adopted_after_public_consultation_en.pdf); [EDPB Guidelines 1/2024 summary on legitimate interests](https://www.edpb.europa.eu/system/files/2024-10/edpb_summary_202401_legitimateinterest_en.pdf).

3. **WhatsApp nevertheless requires permission as a provider-policy condition.** Meta's current WhatsApp Business Messaging Policy says a business may contact a person only after receiving their number and opt-in permission, must honor requests made on or off WhatsApp to block/discontinue/opt out, must maintain accurate support contact information, and may initiate conversations only with approved templates. This is not evidence that Romanian law requires GDPR consent for an operational SMS; it is an independent platform-access rule. [WhatsApp Business Messaging Policy, accessed 27 July 2026, §§1-3](https://whatsappbusiness.com/policy/).

4. **No primary Romanian source reviewed imposes customer channel choice or a statutory quiet-hours interval for these transactional messages.** Channel selection may remain a platform decision if disclosed transparently. WhatsApp permission and suppression must still be respected. A delivery window for reminders is a defensible privacy/user-expectation control, not a discovered legal hour range. Immediate confirmations, cancellations, and reschedules may remain immediate when timing is material. This negative conclusion should be rechecked by Romanian counsel and against the final SMSO/operator contract; ANCOM's specific timing/information rules found in this review concern premium-rate/short-code services, which this ordinary outbound route is not. [ANCOM description of Decision 1131/2014 scope](https://www.ancom.ro/despre-noi/media/comunicate-de-presa/cod-de-conduita-pentru-furnizarea-serviciilor-cu-valoare-adaugata-prin-telefon/).

5. **The platform cannot assume it is only a processor.** The Merchant clearly determines the customer relationship and why appointment communications occur. The platform determines at least shared sender identities, eligible events, templates, channel order, provider selection, fallback, suppression implementation, logging, and retention defaults. Some of those may be non-essential technical means exercised by a processor; some platform purposes, such as its own billing, security, abuse prevention, provider governance, and accounting, make it an independent controller. Joint control is possible for a processing stage if both parties participate in determining its purposes and essential means. The roles must be mapped operation-by-operation before choosing an art. 28 data-processing agreement, an art. 26 joint-controller arrangement, or independent-controller disclosures. Labels in the SaaS contract do not decide the factual role. [GDPR, arts. 4(7)-(8), 26, 28](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/); [EDPB Guidelines 07/2020, final, 7 July 2021](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en); [CJEU C-683/21, paras. 39-46](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62021CJ0683).

6. **A closed-loop Messaging Balance is probably not electronic money if only the platform accepts it for its own messaging service.** Romanian Law 210/2019 defines electronic money as stored value issued on receipt of funds for payment transactions and accepted by a person other than the issuer. Prevent transfer between Merchants, cash withdrawal, person-to-person payments, and third-party acceptance. The result is fact-sensitive: counsel must validate the final terms, refundability, legal issuer, payment flow, and whether a payment-services limited-network analysis is also needed. [Law 210/2019, art. 4(1)(f), consolidated text](https://legislatie.just.ro/Public/DetaliiDocument/295423); [Law 209/2019, art. 4(1)(k)](https://legislatie.just.ro/public/DetaliiDocument/219736).

7. **Top-ups have accounting and VAT consequences before message delivery may occur.** If a top-up is an advance for a sufficiently identified taxable messaging service, VAT chargeability can arise on receipt and an advance invoice is generally due under Fiscal Code arts. 282 and 319. The standard Romanian VAT rate is 21% from 1 August 2025, but registration status, place-of-supply, customer status, refunds, and possible voucher characterization must be validated by the accountant. For Romanian B2B invoices, RO e-Factura transmission is mandatory and, from 1 January 2026, the deadline is five working days from issue, no later than five working days after the statutory issue deadline. [Fiscal Code, arts. 282 and 319, consolidated text](https://legislatie.just.ro/Public/DetaliiDocumentAfis/189763); [ANAF summary of 21% standard VAT](https://static.anaf.ro/static/10/Ploiesti/modificari_tva.pdf); [OUG 120/2021, arts. 10(7) and 10^1(2)-(2^1), consolidated in 2026](https://legislatie.just.ro/Public/DetaliiDocumentAfis/305980).

8. **There is no statutory “keep every delivery log for X years” rule identified.** GDPR requires storage limitation and a documented purpose-specific period. A platform-chosen operational window should be short and tiered; accounting records supporting charges/top-ups/refunds are different records and have a statutory five-year archive period calculated from 1 July of the year following the financial year in which they were created. The fiscal authority's ordinary assessment limitation is five years from 1 July of the following year and can be interrupted or suspended, so the accountant should align tax evidence retention with that exposure. [GDPR, art. 5(1)(e)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/); [Accounting Law 82/1991, art. 25, as amended by Law 36/2023](https://legislatie.just.ro/Public/DetaliiDocumentAfis/269379); [Fiscal Procedure Code, arts. 110-111](https://legislatie.just.ro/Public/DetaliiDocumentAfis/247074).

## Decision table

| Topic                      | Category                              | Decision-ready rule                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operational classification | Mandatory law boundary                | Allow only appointment state, time, Merchant identity, necessary instructions, and the approved confirmation link. Reject promotional or cross-sell content. Reassess any new event/template.                                                                                |
| SMS lawful basis           | Mandatory GDPR                        | Record art. 6(1)(b) only for objectively necessary appointment administration; use and document art. 6(1)(f) plus balancing for optional reminders/operational evidence where appropriate. Do not conflate this with marketing consent.                                      |
| WhatsApp permission        | Provider policy                       | Collect demonstrable, channel-specific WhatsApp permission before first platform-initiated message and retain proof. No inferred permission from merely supplying a phone number.                                                                                            |
| Channel choice             | Product control                       | Customer selection of WhatsApp versus SMS is not a discovered legal requirement. Platform routing may remain automatic, subject to disclosure and channel suppression.                                                                                                       |
| Stop/block                 | Provider policy + GDPR where relevant | Immediately suppress WhatsApp after any stop/block request. Suppress a number/provider route on provider hard blocks and wrong-recipient reports. For processing based on legitimate interests, provide and honor the GDPR right to object unless compelling grounds apply.  |
| Quiet hours                | Product control                       | Keep a configurable Shop-timezone delivery window for reminders. Do not claim a legally prescribed Romanian interval. Send time-critical confirmation/cancellation/reschedule events immediately.                                                                            |
| Sender identity            | Transparency/provider control         | Identify the Merchant in controlled content and the platform in disclosure/support surfaces. Use only a provider-approved platform sender; never spoof a Merchant.                                                                                                           |
| Roles and contracts        | Mandatory GDPR, fact-dependent        | Complete a processing-stage role matrix. Put processor stages under art. 28 terms; joint stages under art. 26; disclose independent-controller stages. Contract with Meta/SMSO only after their role, subprocessors, locations, deletion, and assistance terms are recorded. |
| International transfer     | Mandatory GDPR                        | Inventory every provider/subprocessor location. Use adequacy where applicable; otherwise an art. 46 transfer tool, transfer-impact assessment, and necessary supplementary measures. Disclose transfer and safeguard information.                                            |
| Retention                  | Mandatory principle + product control | Separate operational content, delivery metadata, suppression evidence, security/audit events, complaint files, and financial records. Set a justified period for each; do not inherit provider retention as the platform's own period.                                       |
| Messaging Balance          | Counsel validation                    | Keep closed-loop/non-transferable/no cash-out/no third-party acceptance. Obtain Romanian payments counsel sign-off before launch.                                                                                                                                            |
| Top-up tax/invoice         | Accountant validation                 | Determine advance versus voucher treatment, VAT point, refund/expiry treatment, revenue recognition, and invoice timing. Implement current RO e-Factura obligations.                                                                                                         |
| Financial archive          | Mandatory law                         | Preserve accounting registers and supporting documents for the statutory five-year period; legal hold overrides ordinary deletion.                                                                                                                                           |

## Detailed findings and product implications

### 1. Classification and lawful basis

Romanian Law 506/2004 art. 12 prohibits unsolicited commercial communications through automated calling, fax, email, or any other method using publicly available electronic communications services without prior express consent. Its text covers legal-person subscribers too. This is an e-marketing rule; it does not say all automated service messages require consent. The controlling definition in Law 365/2002 art. 1(8) is purpose-based: a communication designed to promote directly or indirectly products, services, image, name, trade name, or emblem. [Law 506/2004, art. 12](https://legislatie.just.ro/Public/DetaliiDocument/257056); [Law 365/2002, art. 1(8)](https://legislatie.just.ro/Public/DetaliiDocumentAfis/288595).

The operational classification therefore depends on content and context, not the internal `transactional` label. The following are within the defensible operational envelope:

- confirmation of an appointment the customer requested;
- one factual reminder of that appointment;
- notice that the Merchant/customer cancelled or rescheduled it;
- Merchant trading name, appointment time, location or necessary remote-attendance detail, support/contact route, and a narrowly scoped secure confirmation link.

The following should force a marketing classification and a separate consent/requirements path: discounts, “book again,” recommendations, review/referral requests, loyalty prompts, abandoned-booking re-engagement, broader availability, or brand-image copy unrelated to identifying the appointment source. Do not mix operational and promotional purposes in one template.

Under GDPR, every processing operation needs a basis. Article 6(1)(b) is not justified merely because the contract mentions messaging; the EDPB says necessity is assessed objectively against the contract's fundamental and mutually understood purpose. A confirmation or cancellation required to administer a customer-requested appointment is the strongest candidate. A reminder chosen by a Merchant or platform for no-show reduction may be useful without being objectively necessary; art. 6(1)(f), with a written legitimate-interest assessment, is the more defensible candidate. The assessment must identify a present lawful interest, necessity/no equally effective less intrusive means, expected impact, reasonable expectations, and safeguards. [EDPB Guidelines 2/2019](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines-art-6-1-b-adopted_after_public_consultation_en.pdf); [EDPB Guidelines 1/2024 overview](https://www.edpb.europa.eu/news/edpb-adopts-opinion-on-processors-guidelines-on-legitimate-interest-statement-on-draft_ga).

If appointment data reveals health, religion, union membership, or another GDPR art. 9 category, an art. 6 basis is not enough; a separate art. 9 condition is required. A generic scheduler should avoid transmitting service names or notes that reveal special-category data. [GDPR, art. 9](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/).

### 2. Notice, channel choice, and WhatsApp permission

At or before collection of the phone number, the customer-facing privacy information should identify the controller(s), purposes and lawful bases, recipients/categories (including messaging providers), any legitimate interests, transfer basis, retention period or criteria, rights, complaint route, and whether the number is contractually required and the consequences of not supplying it. If data arrives from the Merchant rather than directly from the customer, GDPR art. 14 timing and exceptions need assessment. [GDPR, arts. 13-14](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/).

Use a short booking-flow disclosure linked to the full privacy notice, for example in substance: “We use your number to send appointment confirmations, one reminder, cancellations and reschedules on WhatsApp, with SMS fallback. Messages are sent for [Merchant] through [Platform].” The exact controller wording must wait for the role analysis.

No reviewed Romanian/EU primary source requires offering the customer a WhatsApp/SMS chooser for non-marketing operational messages. But Meta requires affirmative permission to use WhatsApp. Implement a demonstrable WhatsApp permission that:

- names WhatsApp and the operational categories;
- identifies the Merchant/platform relationship without implying the Merchant owns the shared sender;
- is not bundled with marketing;
- records notice/version, timestamp, source, number, Merchant/workspace, categories, and language;
- explains SMS fallback in the adjacent disclosure; and
- can be withdrawn through an accessible route.

The Meta permission is safest as an unticked affirmative control. Whether it also qualifies as GDPR consent is irrelevant if the documented GDPR basis is contract or legitimate interests; keep those concepts separate in data and UI. Meta's policy states the business is responsible for choosing a compliant opt-in method and that opt-in should cover the categories sent. [WhatsApp Business Messaging Policy, §§1 and Best Practices](https://whatsappbusiness.com/policy/).

### 3. Suppression, blocking, sender identification, and quiet hours

Meta requires honoring all WhatsApp block/discontinue/opt-out requests, including those received off WhatsApp. A suppression record needs enough durable information to prevent recontact—normally normalized number/HMAC or another matchable identifier, channel, scope, reason/source, and effective time—but not the entire message thread. A later booking must not silently reactivate WhatsApp; require fresh permission. [WhatsApp Business Messaging Policy, §1](https://whatsappbusiness.com/policy/).

For SMSO, the API itself distinguishes `transactional` from `marketing`; its unsubscribe-link generator is marketing-only, and it can return `405` for an unsubscribed user. This supports treating provider suppression as a routing constraint but does not prove the legal classification of content. Honor a `405` and provider blacklist/terminal response; do not evade it by changing sender or retrying another SMS route. [SMSO API Reference, accessed 27 July 2026](https://api-docs.smso.ro/).

Law 506/2004's rule against hiding the real identity and its valid stop-address requirement expressly applies to commercial email communications. Even though these templates are operational, source clarity is independently required by GDPR fairness/transparency and reduces wrong-recipient harm. Meta also prohibits impersonation and requires support contact details. The shared sender should therefore be described truthfully: the sender/business profile is the platform, while the first line/content clearly states “Appointment update from [Merchant].” [Law 506/2004, art. 12(3)](https://legislatie.just.ro/Public/DetaliiDocument/257056); [GDPR, art. 5(1)(a)](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/); [WhatsApp Business Messaging Policy, §1](https://whatsappbusiness.com/policy/).

ANCOM's National Numbering Plan governs Romanian numbering resources, while the special ANCOM short-code code concerns premium-rate/value-added services. No official ANCOM source located in this research establishes a registration or character rule for an alphanumeric ordinary outbound sender ID. SMSO exposes account-approved sender IDs through its `/senders` API, so exact sender registration/format is a provider provisioning issue for the separate SMSO research ticket. [ANCOM National Numbering Plan](https://www.ancom.ro/reglementare-ro/numerotatie-ro/planul-national-de-numerotatie-2/); [ANCOM short-code scope](https://www.ancom.ro/en/reglementare-ro-10001/numerotatie-ro/null-20/); [SMSO API Reference](https://api-docs.smso.ro/).

No applicable statutory quiet-hours range was found for these ordinary transactional messages. Keep reminder quiet hours because late-night notification intrusion affects GDPR fairness and legitimate-interest balancing. Record the chosen Romania launch window as product policy, use the Shop timezone, and allow immediate time-sensitive state-change messages. Do not cite a specific hour range as law without provider/counsel confirmation.

### 4. Controller, processor, provider, and transfer boundaries

Create a data-flow/role matrix at least for:

| Processing stage                                                           | Likely role question                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Merchant creates appointment and supplies customer details                 | Merchant likely controller; platform may process on instructions for core booking.                                                         |
| Eligibility, event types, shared template and routing                      | Determine whether platform choices are non-essential means on Merchant instructions or joint/independent decisions.                        |
| Platform billing, fraud, security, abuse, reconciliation, legal compliance | Platform likely independent controller for its own purposes.                                                                               |
| Meta WhatsApp and SMSO transmission/status processing                      | Determine from the exact signed terms, not marketing pages; document whether processor, subprocessor, or independent controller per stage. |
| Merchant views appointment timeline                                        | Access under Merchant purpose; enforce workspace isolation and masking.                                                                    |
| Operations views cross-Merchant provider payload/cost                      | Platform purpose; strictly role-based, audited, and minimized.                                                                             |

If platform and Merchant jointly determine a processing stage, GDPR art. 26 requires a transparent allocation of responsibilities whose essence is available to customers. If the platform acts solely on behalf of the Merchant, art. 28 requires a binding processor contract covering instructions, confidentiality, security, subprocessors, assistance, deletion/return, and audits. The CJEU confirms that joint-controller status arises from actual participation, not from the existence or wording of an agreement. [GDPR, arts. 26 and 28](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/); [CJEU C-683/21](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62021CJ0683).

Meta's generic Business Tools terms are not enough to establish the WhatsApp Cloud API allocation. Before production, download/archive the actually accepted WhatsApp Business Terms, Data Processing Terms, transfer addendum, subprocessor list, and product-specific terms. Meta's current processor terms say a Global Data Transfer Addendum applies where its applicable product terms make Meta a processor. [Meta Data Processing Terms, accessed 27 July 2026](https://www.facebook.com/legal/terms/dataprocessing); [Meta Global Data Transfer terms](https://www.facebook.com/legal/terms/Privacy/Transfers).

For any disclosure or remote access outside the EEA, GDPR Chapter V requires an adequacy decision or another valid transfer basis. When relying on the 2021 SCCs, document the destination laws/practices and technical/contractual/organizational safeguards; SCCs are not a box-tick by themselves. Inform customers of the transfer and how to obtain safeguard information. [GDPR, arts. 44-49](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/); [Commission Implementing Decision (EU) 2021/914, 4 June 2021](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32021D0914); [EDPB Recommendations 01/2020, final 18 June 2021](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_ro).

### 5. Minimization, security, retention, and complaints

Data minimization applies to payloads and observability. Operational templates should normally carry only Merchant identity, appointment date/time, necessary location/instruction, a non-sensitive booking reference, and the approved confirmation link. Do not include free-text appointment notes, customer full name unless demonstrably needed, service name where it may reveal sensitive data, employee notes, price/payment detail, or other appointments. Logs and timeline UI should mask phone numbers and avoid message bodies by default. [GDPR, arts. 5(1)(c), 25 and 32](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/).

Use a retention schedule by record class, not one global deletion period:

| Record class                                                                | Rule                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message body/personalized provider request and response                     | Keep only as long as needed to submit, diagnose near-term delivery, and resolve an active complaint; redact/delete before metadata where feasible. No statutory period found. |
| Delivery/routing metadata                                                   | Product-chosen period justified by reconciliation, complaint, reliability, and security purposes; review for shorter aggregated/anonymized retention.                         |
| WhatsApp permission and suppression proof                                   | Retain while it controls sending and for a documented period needed to demonstrate compliance/defend a dispute; minimize identifier and separate from message content.        |
| Complaint/correction case                                                   | Retain through resolution and a documented claims/accountability period; legal hold where a dispute is pending.                                                               |
| Provider cost, Merchant charge, top-up, refund, adjustment, invoice linkage | Financial records; preserve under the five-year accounting rule and longer only where tax suspension/interruption, litigation, or another law requires.                       |
| Aggregated reliability/cost metrics                                         | Anonymize so they cease to be personal data when individual-level data is unnecessary.                                                                                        |

The statute supplies the financial floor, not a product period for message logs. The product team should choose exact operational periods only after the lifecycle and security tickets identify reconciliation/complaint needs, document them in the retention schedule and privacy notice, implement automatic deletion/redaction, and test deletion in providers/backups where contractually available.

Customers must have an accessible privacy contact and may exercise GDPR rights. Under art. 12, the controller normally must respond without undue delay and within one month, extendable by two months for complexity/volume with timely notice. A customer may complain to ANSPDCP under art. 77. Treat “wrong number,” “stop,” “I did not book,” “why did I receive this,” and suspected disclosure as typed incidents; immediately suppress where appropriate, preserve a minimal case record, investigate Merchant/source accuracy, and route potential personal-data breaches into the GDPR arts. 33-34 assessment. [GDPR, arts. 12, 33-34 and 77](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/); [ANSPDCP complaint page](https://www.dataprotection.ro/?page=Plangeri_pagina_principala).

Meta requires prompt, clear human escalation paths for automation, such as phone, email, web support, or in-store support. Because inbound messaging is out of launch scope, the template/profile must point to a monitored support route and clearly state that replies may not be monitored. [WhatsApp Business Messaging Policy, §2](https://whatsappbusiness.com/policy/).

### 6. Messaging Balance, VAT, invoices, and records

The balance design should remain a contractual prepayment/credit ledger for the platform's own messaging service:

- accepted only by the platform;
- usable only by the purchasing Merchant/workspace for platform messaging;
- non-transferable and not a person-to-person payment mechanism;
- no cash withdrawal; refunds only under documented contractual/error/termination rules;
- denomination and tax-inclusive/exclusive presentation unambiguous;
- immutable ledger entries for top-up, charge, refund, expiry (if counsel permits expiry), and audited operator adjustment.

This design does not satisfy the “accepted by a person other than the issuer” element in Law 210/2019's electronic-money definition. That is a strong but not definitive reason the ledger is outside e-money regulation. If a downstream provider ever accepts the balance directly, Merchants can transfer it, or it can buy third-party services, re-open the analysis before launch. [Law 210/2019, art. 4(1)(f)](https://legislatie.just.ro/Public/DetaliiDocument/295423).

Fiscal implementation cannot safely wait until first delivery. The Romanian Fiscal Code defines advances as partial or full payment before supply and makes VAT chargeable on receipt for advances in the relevant cases; art. 319 addresses invoice issuance for advances. Because exact treatment may depend on whether the balance is an advance for identified services or a voucher, the accountant must produce a written memo covering:

- whether top-up receipt, message delivery, or both create invoice/VAT events;
- whether the balance is an advance, single-purpose voucher, multi-purpose voucher, or another contractual liability;
- 21% standard VAT applicability, Merchant VAT status, and place-of-supply for any non-Romanian Merchant;
- top-up and consumption invoice/credit-note mechanics without double taxation;
- refunds, promotional credits, operator adjustments, expired balances, and breakage;
- revenue recognition separately from VAT chargeability; and
- invoice content, numbering, currency/FX, and RO e-Factura transmission.

The standard VAT rate is 21% as of this research date, but it must be configuration rather than hard-coded business logic because rates change. [Fiscal Code, arts. 282, 291 and 319](https://legislatie.just.ro/Public/DetaliiDocumentAfis/189763); [ANAF 2025 VAT change summary](https://static.anaf.ro/static/10/Ploiesti/modificari_tva.pdf).

For established Romanian operators, RO e-Factura covers domestic B2B invoices. As of 1 January 2026, OUG 120/2021 sets a five-working-day transmission deadline from issue, capped by five working days after the statutory invoice deadline. The implementation should store the e-Factura submission identifier/status and reconcile rejections; sending a PDF alone does not discharge the system obligation. [OUG 120/2021, consolidated through 2026](https://legislatie.just.ro/Public/DetaliiDocumentAfis/305980); [OUG 89/2025, art. X](https://legislatie.just.ro/Public/DetaliiDocument/307057).

Accounting registers and supporting documents must be kept five years, calculated from 1 July of the year following the financial year in which they were prepared. Preserve invoice, e-Factura acknowledgement, top-up payment reference, balance ledger, Merchant charge, refund/adjustment approvals, provider-cost evidence, and reconciliations to the extent each supports the books. This does **not** require preserving full message bodies or unmasked phone numbers for five years when a pseudonymous message/transaction identifier proves the charge. [Accounting Law 82/1991, art. 25](https://legislatie.just.ro/Public/DetaliiDocumentAfis/269379); [Finance Order 1139/2025 on supporting-document content](https://legislatie.just.ro/Public/DetaliiDocument/299963).

## Required controls before the pilot

1. Freeze a controlled-template policy with an automated/manual “no promotional content” review gate.
2. Add explicit, versioned WhatsApp permission and evidence; disclose automatic SMS fallback.
3. Implement channel-specific suppression that survives Merchant configuration changes and prevents retry/evasion.
4. Publish truthful shared-sender identity and a monitored support/complaint route.
5. Complete the Merchant/platform/Meta/SMSO role-and-transfer matrix; execute applicable art. 26/28 and Chapter V documents.
6. Inventory provider/subprocessor locations, retention, deletion, security, breach assistance, and government-access terms.
7. Minimize templates and logs; keep special-category/free-text data out of provider payloads.
8. Approve a record-class retention schedule with automated redaction/deletion and legal-hold behavior.
9. Obtain Romanian payments counsel sign-off on the closed-loop balance terms and prohibited capabilities.
10. Obtain accountant sign-off on advance/voucher treatment, VAT, invoices, RO e-Factura, refunds, ledger entries, and revenue recognition.
11. Exercise wrong-number, opt-out, provider-block, privacy request, complaint, and breach runbooks before real recipients.

## Uncertainties requiring validation

- **Operational versus marketing edge:** no Romanian authority decision specific to appointment WhatsApp/SMS was located. The classification follows the statutory promotional-purpose definition; counsel should approve final templates and prohibited-copy rules.
- **Quiet hours:** no binding interval applicable to ordinary operational messages was found. Check the signed SMSO/carrier terms and counsel's local-practice view before selecting the product window.
- **Controller allocation:** cannot be resolved from architecture notes alone. It depends on Merchant instructions, contractual promises, platform reuse of data, actual provider terms, and who fixes essential means.
- **Meta legal terms:** public generic Meta terms do not conclusively establish the Cloud API stage roles or transfer chain. Archive and review the terms accepted by the actual business account.
- **SMSO privacy/processing terms:** API documentation proves technical fields/statuses but not GDPR role, hosting/subprocessors, retention, or international routing. Obtain a signed DPA and current subprocessor/location answers.
- **Balance regulation:** closed-loop/no-third-party-acceptance strongly points away from electronic money, but final legal/financial flows require Romanian payments counsel.
- **VAT treatment:** advance versus voucher treatment, refunds, non-Romanian Merchants, and invoice timing require the launch entity's accountant/tax adviser.
- **Retention:** exact operational periods are not supplied by statute. They must be justified by the final complaint, reconciliation, provider, and litigation requirements rather than copied from the five-year accounting period.

## Newly specifiable follow-up questions

1. What exact booking-flow WhatsApp permission and operational disclosure copy gives provable Meta permission while accurately presenting shared platform senders and automatic SMS fallback?
2. For each processing stage, are Merchant and platform controller/processor, joint controllers, or independent controllers, and what contracts/notices follow?
3. What record-class retention/redaction periods meet the lifecycle's reconciliation and complaint needs, and how are they enforced across D1, logs, backups, Meta, and SMSO?
4. What signed Meta and SMSO terms, subprocessors, locations, deletion commitments, security measures, and transfer mechanisms apply to the production accounts?
5. Does Romanian payments counsel approve the proposed closed-loop Messaging Balance, including refund, expiry, adjustment, insolvency, and non-transferability terms?
6. What written accounting policy governs top-ups and consumption: advance or voucher characterization, VAT point, invoice/credit-note flow, RO e-Factura, provider-cost matching, and revenue recognition?

## Primary source index

- [GDPR, Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/)
- [Romanian Law 506/2004 on privacy in electronic communications, consolidated](https://legislatie.just.ro/Public/DetaliiDocument/257056)
- [Romanian Law 365/2002 on electronic commerce, consolidated](https://legislatie.just.ro/Public/DetaliiDocumentAfis/288595)
- [EDPB Guidelines 2/2019 on art. 6(1)(b), final](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines-art-6-1-b-adopted_after_public_consultation_en.pdf)
- [EDPB Guidelines 07/2020 on controller/processor, final](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en)
- [Commission SCC Decision (EU) 2021/914](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32021D0914)
- [EDPB Recommendations 01/2020 on transfer supplementary measures, final](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_ro)
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
- [SMSO API Reference](https://api-docs.smso.ro/)
- [Romanian Law 210/2019 on electronic money](https://legislatie.just.ro/Public/DetaliiDocument/295423)
- [Romanian Law 209/2019 on payment services](https://legislatie.just.ro/public/DetaliiDocument/219736)
- [Romanian Fiscal Code, Law 227/2015](https://legislatie.just.ro/Public/DetaliiDocumentAfis/189763)
- [OUG 120/2021 on RO e-Factura, current consolidated text](https://legislatie.just.ro/Public/DetaliiDocumentAfis/305980)
- [Romanian Accounting Law 82/1991, current art. 25](https://legislatie.just.ro/Public/DetaliiDocumentAfis/269379)
- [Romanian Fiscal Procedure Code, Law 207/2015](https://legislatie.just.ro/Public/DetaliiDocumentAfis/247074)
