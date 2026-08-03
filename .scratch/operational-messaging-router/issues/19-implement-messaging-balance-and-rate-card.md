# Implement Messaging Balance and the Rate Card

Type: task
Status: resolved
Blocked by: 17

## Question

Implement the Notifications Effect capabilities and D1 transactions for effective-dated Rate Cards, exact milli-euro Messaging Balances, maximum-charge reservations, delivery conversion, release, append-only credits and debits, compensating corrections, Provider Messaging Costs, low-balance re-arming, and financial reconciliation inputs. Prove non-negative available balance, one €0.045 excluding-VAT ordinary charge per delivered Notification Intent, source-scoped idempotency, retries and fallback sharing one reservation, platform absorption of failed or additional provider deliveries, and deterministic conservation under concurrent workers, callbacks, top-ups, refunds, adjustments, and late evidence. Expose typed Merchant and Operations-facing projections and errors without implementing Stripe checkout or UI in this slice.

## Comments

### Resolution — 2026-07-29

Implemented the Notifications-owned `MessagingFinance` Effect capability with Seed and D1 Live layers. Effective-dated immutable Rate Cards preserve the launch €0.045 excluding-VAT price in exact milli-euros; append-only balances, reservations, delivery conversion, release, corrections, provider-native costs, low-balance re-arming, and detailed reconciliation now share typed errors and Merchant-safe and Operations projections.

D1 constraints and transactional winner re-reads enforce non-negative available balance, one reservation and one ordinary charge per Notification Intent, source idempotency under concurrency, one credit or refund debit per external financial fact, verified-delivery-only conversion, immutable correction history, 30-day price notice, and authenticated finance-Operator provenance. Confirmed payment evidence is required for €10/€25/€50 top-ups. Refund debits link provider-refund and payment evidence plus fiscal references; failed provider refunds restore credit through an idempotent typed compensating correction. Invoice, credit-note, e-Factura, provider-cost, payment, refund, reservation, charge, and ledger facts are available to reconciliation without leaking protected provider account identities to routine projections.

Verification passed with both package typechecks, scoped `oxlint`/`oxfmt`, all 63 capability test files (351 tests, 83.08% line coverage), and all 7 database test files (14 tests). The final two-axis review found no Spec findings and no hard Standards violations. It retained one non-blocking P2 judgement that Seed and Live repeat adapter policy workflows; the module's leaf intent node deliberately keeps the financial aggregate together, so that broader extraction is deferred until another adapter or observed drift justifies a separate architecture slice.

Implementation commits: `1efb77c`, `704b900`, `009505c`, and `223de48`.
