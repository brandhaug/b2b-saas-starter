# Research the SMSO.ro Delivery Contract

Type: research
Status: resolved
Blocked by:

## Question

What current primary-source SMSO.ro requirements and capabilities govern the Romania launch fallback route, including account and sender registration, supported sender identity, API authentication, Unicode and GSM segment calculation, pricing and taxes, balance behavior, submission idempotency, delivery receipts and terminal statuses, retries, rate limits, callbacks and verification, test mode, secrets, data handling, and Cloudflare Workers compatibility?

## Comments

### Resolution — 2026-07-27

Research: [SMSO.ro Delivery Contract Research](../../../docs/research/smso-ro-delivery-contract.md)

SMSO.ro is technically compatible with Cloudflare Workers through its standard HTTPS, header-authenticated, form-encoded API and JSON responses. A send uses a team-owned numeric sender ID and returns a provider `responseToken` plus a reported `transaction_cost`; delivery can be recovered through polling or form callbacks. The documented nonterminal states are `dispatched` and `sent`, and the terminal states are `delivered`, `undelivered`, `expired`, and `error`.

The public contract does not document submission idempotency, authenticated callbacks, callback retry or ordering behavior, a numeric send quota, a complete GSM/Unicode segmentation algorithm, balance debit and refund semantics, a non-delivering sandbox, API-key rotation, or production-grade data-processing and security terms. A network timeout after `POST /send` is therefore an ambiguous submission and must not be automatically replayed; callbacks require correlation and polling confirmation rather than being trusted as independent proof.

Current public Romania prices exclude VAT and use a stated 160-character unit without diacritics or special characters. Prepaid credit has unlimited validity, but the units and finality of `credit_value`, `pricePerMessage`, and `transaction_cost` require live reconciliation. Production remains gated on provisioning the platform account and sender, obtaining written answers for the undocumented contract, executing controlled real-number tests across encoding/cost/status boundaries, and completing DPA/security review.
