# Messaging Finance

This module owns Messaging Rate Cards, exact milli-euro Messaging Balance effects,
reservations, Chargeable Deliveries, Provider Messaging Costs, and financial
reconciliation inputs. Keep Merchant charges independent from provider cost.

All mutations are source-idempotent and D1-atomic. Never use floating-point euros,
rewrite ledger history, create more than one ordinary charge per Notification Intent,
or permit available balance to become negative. Retries and channel fallback share
one reservation; failed or additional provider deliveries remain platform costs.
