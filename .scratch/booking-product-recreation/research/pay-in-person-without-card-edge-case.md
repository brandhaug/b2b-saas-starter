# Pay In Person without a card: confirmation-copy edge case

Date: 2026-07-18
Scope: local `b2b-saas-starter` implementation compared with the primary-source legacy implementation at `/Users/hassan/Desktop/ssqu/recreate/apps/booking-app`. No product code was changed.

## Executive finding

The current Booking App displays **Pending payment** and the no-show/late-cancellation charging statement because it treats every `checkoutPath === 'pay_in_person'` confirmation as if it were the Legacy Source's **card-backed reservation** variant. That equivalence is false.

The Legacy Source has two distinct pay-in-person outcomes:

1. `bookNoCard` / `isBookNoPay`: pay in person with **no card required**. Confirmation shows only **Pay in person**.
2. `bookProvideCard` / `isReservation`: pay in person with a **card provided for a later policy charge**. Confirmation adds **Pending payment** and the no-show/late-cancellation disclaimer.

The target product deliberately chose the first variant. Its settled decision says Pay In Person creates no Payment or payment status, needs no card or authorization, and must omit cancellation/no-show charge copy ([issue 09](../issues/09-decide-checkout-payment-boundary.md#decision), especially lines 15–31). Therefore the screenshot copy is not supportable for the target's no-card flow.

## Why the target currently renders the text

The confirmation presentation schema carries `checkoutPath` and an optional cancellation policy, but no fact saying a card/payment credential was collected or a later charge was authorized ([booking-confirmation-presentation.ts](../../../apps/booking/src/lib/booking-confirmation-presentation.ts:14), lines 14–43).

Despite that, the route renders the payment block for every `checkoutPath === 'pay_in_person'` confirmation ([booking-confirmation-flow.tsx](../../../apps/booking/src/components/booking-confirmation-flow.tsx:352), lines 352–359). Inside that block:

- every non-cancelled confirmation gets `reservation.pending_payment`, without checking for a Payment, card, authorization, or card-backed reservation fact ([booking-confirmation-flow.tsx](../../../apps/booking/src/components/booking-confirmation-flow.tsx:713), lines 713–725);
- the charging disclaimer is built whenever `cancellableUntilMinutesBeforeStart` is truthy ([booking-confirmation-flow.tsx](../../../apps/booking/src/components/booking-confirmation-flow.tsx:689), lines 689–712) and then rendered ([booking-confirmation-flow.tsx](../../../apps/booking/src/components/booking-confirmation-flow.tsx:727), lines 727–735);
- the English localization makes the unsupported charging claim explicit ([booking-localization.ts](../../../apps/booking/src/localization/booking-localization.ts:278), lines 278–287).

So the immediate cause is not that a card exists but is hidden. It is that `pay_in_person` plus a cancellation window is being used as a proxy for a card-backed, chargeable reservation.

This contradicts the repository's canonical language: Pay In Person confirms without immediate payment **or a payment credential** and does not track later collection ([CONTEXT.md](../../../CONTEXT.md:331), lines 331–337); Pay In Person creates no Payment and implies no payment status ([CONTEXT.md](../../../CONTEXT.md:243), lines 243–249; [CONTEXT.md](../../../CONTEXT.md:520), lines 520–523).

## How the Legacy Source handles the edge case

### 1. It models two capabilities separately

The Legacy Source contract comments are explicit:

- `canBookNoPay` means “Pay In Person, no card required”;
- `canReserve` means “Pay In Person, but with card provided.”

Source: `/Users/hassan/Desktop/ssqu/recreate/packages/types/src/models/validated_cart.ts:202-209`.

`useAvailableBookingTypes` preserves that distinction as `bookNoPay` and `bookNoPayAndProvideCard`: `/Users/hassan/Desktop/ssqu/recreate/packages/view/src/hooks/useAvailableBookingTypes/useAvailableBookingTypes.ts:20-43`.

### 2. Selection records the correct checkout mode

When the customer chooses Pay in person, `usePaymentType` selects:

- `CartPaymentMethod.cardEntry` + `CartCheckoutType.bookProvideCard` when the server says card-backed reservation is available;
- otherwise `CartPaymentMethod.noPayment` + `CartCheckoutType.bookNoCard` for the no-card path.

Source: `/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/sources/components/molecules/Popup/popups/CheckoutFormPopup/usePaymentType.ts:90-115`.

The outgoing cart contract then encodes `bookNoCard` as `isBookNoPay` and `bookProvideCard` as `isReservation`: `/Users/hassan/Desktop/ssqu/recreate/packages/repository/src/utils/validate_cart_dto_factory.ts:27-41`.

### 3. The card-backed branch is gated by actual card collection

In Payments V2, if Pay in person resolves to `bookNoPayAndProvideCard` and there is no memoized card, the booking does not proceed: it opens the card-entry popup instead (`/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/sources/components/molecules/Popup/popups/CheckoutFormPopup/CheckoutFormPopup.tsx:550-558`). The popup title is **Card on file required** (`/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/static/locales/en.json:493-507`).

The checkout flow proceeds with a new card token or a saved-card id; if neither exists, it transitions to card input (`/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/sources/contexts/CheckoutFlow/phases/utils.ts:66-87`). This establishes the intended invariant: `bookProvideCard` is the chargeable reservation branch, while `bookNoCard` is not.

### 4. Confirmation copy depends on `isReservation`, not generic Pay in person

The legacy confirmation renders `PayInPersonInfo` for either `saleOrder.isBookNoPay` or `saleOrder.isReservation`, but passes the `isReservation` fact into the component (`/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/sources/pages/reservation/Reservation.tsx:263-273`).

`PayInPersonInfo` always shows **Pay in person**, but it renders both the status badge and the cancellation/no-show disclaimer only when `props.isReservation` is true (`/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/sources/components/molecules/PayInPersonInfo/PayInPersonInfo.tsx:17-46`). The exact disclaimer comes from `/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/static/locales/en.json:684-699` through `/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/sources/components/molecules/PayInPersonInfo/PayInPersonDisclaimer.tsx:9-18`.

Therefore, for a genuine no-card booking (`isBookNoPay=true`, `isReservation=false`), the reference behavior is:

- show **Pay in person**;
- do not show **Pending payment**;
- do not claim the client can be charged for a no-show or late cancellation.

## Interpreting the screenshot

In the Legacy Source, the screenshot state means `saleOrder.isReservation === true`. A missing masked-card row does not change that rendering because card details and Pay in Person are rendered independently: the card row requires `cardInfo`, while the status/disclaimer requires `isReservation` (`/Users/hassan/Desktop/ssqu/recreate/apps/booking-app/sources/pages/reservation/Reservation.tsx:53-65` and `:263-273`).

Thus **Pay in person + Pending payment + charge warning, with no visible card evidence** is an inconsistent or partial read-model state if the customer truly supplied no card. Possible causes include an API response carrying `isReservation` without card details, or omitted/unreadable payment data. It is not the reference behavior for `bookNoCard`.

One warning: the local recreate API fixture is not reliable evidence for this invariant. It hard-codes `canBookNoPay=true` and `canReserve=false` (`/Users/hassan/Desktop/ssqu/recreate/apps/api/src/fixtures.ts:539-559`) but also inserts a succeeded Visa payment into every generated Sale Order (`/Users/hassan/Desktop/ssqu/recreate/apps/api/src/fixtures.ts:650-688`). The client source and typed contracts are the more coherent primary sources for this edge case.

## Test gap

The target confirmation test fixture combines `checkoutPath: 'pay_in_person'` with a 60-minute cancellation policy ([booking-confirmation-flow.test.tsx](../../../apps/booking/src/components/booking-confirmation-flow.test.tsx:12), lines 12–37), but there is no direct assertion that a no-card Pay In Person confirmation omits **Pending payment** and the charging claim. The hierarchy test's text query at lines 92–99 does not establish that contract and does not assert the status badge.

This allowed visually similar legacy copy to be ported without its prerequisite `isReservation` / card-backed-reservation state.

## Product implication

For the currently settled target semantics, the coherent behavior is to render the quoted total and **Pay in person** only. A cancellation deadline may justify neutral cancellation-policy copy, but it cannot justify “You will only be charged…” without an explicit, server-owned fact that a credential was collected and the customer authorized a later charge.

If card-backed pay-in-person is added later, it should be a distinct Checkout Policy/result fact—not inferred from `checkoutPath` or cancellation-window presence—and should be backed by confirmation tests for both branches.
