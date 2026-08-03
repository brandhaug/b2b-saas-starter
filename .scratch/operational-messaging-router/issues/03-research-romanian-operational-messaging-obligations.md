# Research Romanian Operational Messaging Obligations

Type: research
Status: resolved
Blocked by:

## Question

Which current Romanian and applicable EU primary-source legal, regulatory, privacy, consumer, telecom, and accounting obligations govern platform-sent WhatsApp and SMS booking confirmations, reminders, cancellations, and reschedules, including lawful basis, disclosure, channel choice, suppression and blocking, sender identification, quiet hours, data minimization, cross-border processing, retention, complaint handling, prepaid credit, invoices, taxes, and financial-record retention?

## Comments

### Resolution — 2026-07-27

Research: [Romanian Operational Messaging Obligations](../research/romanian-operational-messaging-obligations.md)

Strictly factual booking confirmations, reminders, cancellations, and reschedules can defensibly remain operational rather than direct marketing, provided controlled templates exclude offers, cross-sells, review requests, re-engagement, and other promotional content. Their personal-data processing still requires a purpose-specific GDPR basis: contractual necessity only where objectively necessary, and a documented legitimate-interest assessment for optional reminders or operational evidence where that test fits. Meta separately requires demonstrable WhatsApp permission and immediate honoring of stop/block requests.

No reviewed Romanian or EU primary source requires customer channel choice or prescribes quiet hours for ordinary transactional messages. Automatic WhatsApp-first routing with disclosed SMS fallback may therefore remain a product decision, while channel-specific suppression, truthful shared-sender identification, a monitored complaint route, and a Shop-timezone reminder window remain required provider controls or prudent privacy safeguards.

The Merchant/platform/provider controller allocation must be decided per processing stage; the platform cannot assume processor status for its own billing, security, abuse, provider-governance, and accounting purposes. Provider and subprocessor locations require a documented GDPR Chapter V transfer mechanism. Payloads and logs must be minimized, particularly where a service name could reveal special-category data, and operational retention must be purpose-specific rather than copied from financial retention.

A closed-loop, non-transferable, no-cash-out Messaging Balance accepted only by the platform likely falls outside Romanian electronic money because it lacks third-party acceptance, but Romanian payments counsel must validate the final terms. An accountant must settle advance-versus-voucher treatment, VAT point, invoice and credit-note flow, RO e-Factura, refunds, and revenue recognition. Accounting registers and supporting evidence have a five-year statutory archive period calculated from 1 July following the relevant financial year; that does not justify keeping message bodies or unmasked phone numbers for five years.

The resulting questions are already owned by **Prototype Controlled Templates and Booking Disclosure**, **Define the Rate Card and Messaging Balance Ledger**, **Define Security, Privacy, and Provider Reconciliation**, and the two provider-contract research tickets. No new ticket or fog graduation is required yet because exact retention periods, provider transfers, and fiscal mechanics still depend on those open decisions and production terms.
