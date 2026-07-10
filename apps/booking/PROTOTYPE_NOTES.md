# Booking App Migration Spike

**Question:** How should the existing customer Booking App be moved into this repository's new application stack without redesigning a flow that already exists?

The fixture-backed flow lives at `/demo-shop/booking`. The `scenario` control exposes `no-services`, `no-times`, and `slot-lost` states.

## Legacy source evidence

This spike was built after reading and running `/Users/hassan/Desktop/ssqu/recreate/apps/booking-app` against `/Users/hassan/Desktop/ssqu/recreate/apps/api`.

- `sources/App.tsx`, `components/molecules/WidgetContainer/*`, and `styles/global/document.ts` establish a full-height booking widget with a `375px` centered desktop rail and full-width mobile behavior.
- `pages/shop/Shop.tsx` and `pages/shop/components/BarberCard/*` render the two-column professional grid, including the choose-service-first / Any Provider path.
- `pages/services/Services.tsx` and its child components render the category control, two-column Service cards, selected Primary Service, and **Anything you wish to add?** handoff.
- `contexts/CartController/modes.tsx`, `components/organisms/Cart/*`, and `components/organisms/CartControls/*` implement the persistent bottom summary and full-height dark drawer.
- `pages/schedule/components/CalendarAndTimetableUpdated/*`, `components/organisms/ScheduleCalendar/*`, and `pages/schedule/components/Timetable/*` provide the calendar strip and three-column time grid.
- `components/molecules/Popup/popups/CheckoutFormPopup/*`, `contexts/CheckoutFlow/phases/*`, and `components/organisms/UserInfoFormV2/*` define the checkout sheet.
- `pages/reservation/*` provides the detailed post-booking receipt.

The live flow was traversed through provider, service/add-on, collapsed and expanded order summary, calendar/time, and seeded confirmation. The source dropped its `?cart=cart_demo` query after slot selection and rendered blank—the refresh/hydration weakness already noted in its `Schedule.tsx`. The checkout surface was therefore cross-checked from its source phase machine and components.

## Migration decision

The existing flow is the executable product specification. This is one source-faithful migration spike, not three invented redesign variants.

Preserve:

- The `375px` widget rail, mobile behavior, card proportions, selected-Service handoff, calendar density, bottom summary, dark drawer, checkout progression, and detailed confirmation.
- Provider, Service, time, merchant, and confirmation fixture semantics.
- Customer-facing interaction order and information hierarchy.

Replace:

- React Router 5 with TanStack Start routes.
- Styled Components with compiled **StyleX** styles and local semantic style definitions.
- Legacy Cart/Sale Order concepts with Booking Session, Booking Quote, Time Slot Hold, and Appointment concepts at the capability boundary.
- Query-string cart authorization with server-backed Booking Session authorization.
- Source context/API coupling with Effect services and capability contracts.

## StyleX strategy

- `@stylexjs/unplugin` runs before the React plugin in Vite and emits build-time atomic CSS.
- Booking components use `stylex.create` and `stylex.props`; there is no Tailwind dependency or utility-class surface in `apps/booking`.
- Global CSS is limited to document/font/reset behavior. Layout, component states, responsive rules, and visual variants live in StyleX.
- Styles are named by booking UI intent (`providerCard`, `orderBar`, `drawer`, `receipt`) so the port retains the legacy component vocabulary without importing its styled-component implementation.

## Proposed production route shape

- `/:merchantSlug/booking` resolves the Published Public Booking Page and starts or resumes a Booking Session.
- Team flows use `/:merchantSlug/booking/providers/:providerPreference/services/:serviceSelection/schedule` through Provider, Service, and Availability selection.
- Additional Services remain a second visual state inside the Service route.
- Customer Details and Checkout Path stay under `/:merchantSlug/booking/session/:bookingSessionId/checkout`; Customer data never enters URLs.
- A committed Appointment redirects to `/:merchantSlug/booking/confirmations/:confirmationId`, authorized independently from the unfinished Booking Session.

## Boundary

All selections currently live in React memory. Booking Session persistence, Time Slot Holds, Appointment confirmation, payment collection, email, and webhooks remain explanatory stubs. This spike proves the UI migration seam; it does not duplicate the legacy API architecture.

Issue 09 narrows the production checkout to automatic `checkoutPath: pay_in_person`, no payment-status badge, and no payment-method selector. Preserve the Legacy Source's copy: **Confirm booking** for the checkout heading, **Book** for its primary action, and **Go to checkout** for the preceding entry action.

Beneath **Book**, retain the source's non-checkbox Terms of Service and Privacy Policy disclosure, linking to the Public Site's `/terms` and `/privacy` routes. No consent record or policy-version snapshot belongs to this slice.

Do not retain the source's cancellation-window, late-cancellation fee, or no-show charge copy: those promises depend on the deferred card-on-file and cancellation behaviors.
