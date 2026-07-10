# Decide Checkout Payment Boundary

Type: grilling
Status: done
Blocked by: 01, 02, 05

## Question

What checkout and payment boundary should the first Booking Vertical Slice support?

Decide whether the initial path uses pay-in-person only, a simple Stripe setup or payment intent, or a provider-light abstraction, and which source payment behaviors stay out of scope until later.

## Decision

- The first Booking Vertical Slice supports **Pay In Person** only. It does not collect online payment during booking, and **Pay Now** is deferred.
- Confirming with **Pay In Person** creates no payment obligation, payment record, or payment status. The Appointment preserves its accepted Booking Quote and `checkoutPath`, while later collection and reconciliation remain outside the Booking Product.
- The first slice introduces no payment-provider runtime or abstraction: no Stripe SDK, Payment Intent endpoint, provider port, fake payment adapter, payment webhook, or reuse of the Starter's SaaS Billing module. Those integration boundaries are deferred until **Pay Now** has concrete requirements.
- **Pay In Person** is the fixed product default for every first-slice Merchant, not a persisted Merchant setting or opt-in. Booking Readiness does not require checkout configuration, and each Booking Session receives `checkoutPath: pay_in_person` automatically.
- The first slice does not implement a separate **Payments** capability. **Booking** owns the fixed `checkoutPath: pay_in_person` fact; **Payments** is a reserved future bounded context to introduce when **Pay Now** adds independent policy, provider, and lifecycle behavior.
- The Booking App does not render Pay In Person as a selectable control. Its final review shows the accepted price and appointment facts, discloses **Pay In Person** non-interactively, and asks the customer to confirm the booking.
- The canonical term and contract field are **Checkout Path** and `checkoutPath`, not Checkout Choice or `checkoutChoice`, because the first-slice path is applied automatically rather than selected by the customer.
- The Booking Quote total is the exact amount the customer should expect to pay in person: the sum of its snapshotted Service prices. The first slice adds no tax calculation, tips, fees, deposits, discounts, gift cards, or memberships; Merchants configure customer-facing Service prices accordingly.
- Every first-slice Service has a positive price. Zero-priced Services and a future **No Payment Required** Checkout Path are deferred; **Pay In Person** never means that nothing is owed.
- Appointment and Confirmation views show the quoted total and **Pay In Person**, but no Paid, Unpaid, or Pending Payment badge. Appointment Status does not imply payment state, and the product makes no claim about later collection.
- `checkoutPath` is persisted on both the Booking Session and the immutable Appointment snapshot even though its only first-slice value is `pay_in_person`. It is an accepted booking fact, not derived from a current default or stored as Merchant configuration.
- **Pay In Person** requires no card on file, deposit, authorization, or payment credential. The first slice follows the Legacy Source's no-card path; the Merchant accepts no-show and collection risk outside the Booking Product.
- The private session route remains `/:merchantSlug/booking/session/:bookingSessionId/checkout`. **Checkout** is the stable workflow boundary for reviewing the Booking Quote, disclosing Pay In Person, and confirming, even when no online payment is collected. Preserve the Legacy Source's customer copy: the screen heading is **Confirm booking**, the primary action is **Book**, and the preceding entry action is **Go to checkout**.
- Beneath **Book**, preserve the Legacy Source's non-checkbox disclosure that booking agrees to the Terms of Service and Privacy Policy, linked to `/terms` and `/privacy`. The first slice creates no Consent entity, acceptance timestamp, or policy-version snapshot.
- Omit the Legacy Source's cancellation-window, late-cancellation fee, and no-show charge copy from Checkout and Confirmation. The first slice has no payment credential with which to enforce those claims, and customer cancellation behavior is deferred.
- The optional Appointment confirmation email repeats the immutable quoted total and **Pay In Person**, but is not called a receipt and contains no payment status or cancellation-fee claim. Email delivery failure never rolls back or hides the confirmed Appointment.
- The server assigns and persists `checkoutPath: pay_in_person` when it creates the Booking Session and returns it read-only for display. Browser confirmation commands do not accept a Checkout Path, so a caller cannot inject an unsupported or future path.
- All other Legacy Source payment behavior is deferred: cards, bank accounts, wallets, Cash App, BNPL, saved cards, card-on-file, Setup Intents, Payment Intents, deposits, authorizations, payment redirects, taxes, tips, fees, promotions, gift cards, memberships, payment statuses, receipts, refunds, disputes, payouts, reconciliation, payment events, and payment webhooks.
