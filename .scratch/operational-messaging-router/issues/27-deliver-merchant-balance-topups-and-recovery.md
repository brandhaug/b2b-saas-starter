# Deliver Merchant Balance, Top-Ups, and Delivery Recovery

Type: task
Status:
Blocked by: 19, 20, 21, 30

## Question

Implement the BeeSolo Merchant App Billing → Messaging Balance surface, exact three-decimal balance and append-only transaction statement, €10/€25/€50 Stripe top-ups with VAT and fiscal-reference separation, idempotent payment-webhook crediting, downloadable records, and the Owner low-balance email plus persistent in-app notice with €2 re-arming. Add safe Appointment timeline delivery summaries and Owner-only fresh-send recovery after insufficient balance, including top-up return navigation, current-facts confirmation, Appointment authorization, audit and abuse limits, and immutable prior outcomes. Prove Stripe failure leaves existing credit and the app healthy, no pending/failed payment creates credit, no provider state leaks, funding never automatically replays an old intent, and no deferred Manager or Employee surface is introduced.
