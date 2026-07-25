# Reproducible Legacy Parity Baseline

## Scope and evidence

This report answers whether the checked-out legacy booking app can currently produce a deterministic, reviewable parity baseline for every journey in [Legacy Booking App Journey and Observable-State Inventory](./legacy-booking-journey-state-inventory.md). The legacy primary source is `/Users/hassan/Desktop/ssqu/recreate`; source citations below are relative to that directory. Commands were run on 2026-07-11 in the checked-out workspace.

“Bootable” means the Vite app and local API can serve requests. “Runnable” means a user can traverse a branch with the supplied local API. “Reproducible baseline” additionally requires fixed inputs, resettable state, controlled time and providers, a declared browser/viewport environment, and retained screenshots/recordings plus machine-readable state evidence.

## Decision

**A reproducible full-journey legacy parity baseline does not yet exist.** The checkout contains a useful local happy-path API and the app is development-bootable, but only a narrow demo subset is runnable, the build currently fails, fixture time and process state are nondeterministic, many inventoried branches have no selectable fixtures, external/provider behavior is not substituted end to end, and there is no browser automation or capture contract.

The current code is therefore an **implementation seed**, not an auditable parity baseline. It can support manual exploration of the standard booking spine, a generated receipt, an active waiting list, and the walk-in happy path. It cannot substantiate parity for group booking, promotions, passcodes, gift-card purchases and receipts, checkout/payment variants, reservation terminal/error variants, most waiting-list statuses, empty/failure/loading branches, locale/flag variants, or stable responsive rendering.

## What was verified now

- `pnpm --filter @ssqu/api dev` started the local API on port 5174 and `GET /v1/status` returned HTTP JSON successfully. The API defaults to `0.0.0.0:5174` (`apps/api/src/http.ts:3-5,16-21`; `apps/api/src/server.ts:6-10,27-30`).
- `pnpm --filter @ssqu/booking-app dev` started Vite on port 5173, and a deep-link request to `/brands/demo-brand` returned the SPA HTML. Vite proxies `/v1` and `/v2` to the local API by default (`apps/booking-app/vite.config.ts:55-66`). This makes development boot independent of a production API when requests use the default empty base URL (`apps/booking-app/sources/config/config.ts:8`; `apps/booking-app/sources/apiServices.ts:36-49`).
- A production build is **not currently reproducible**: `pnpm --filter @ssqu/booking-app build` failed before Vite with TypeScript 6 error TS5101 because `baseUrl` is deprecated and `ignoreDeprecations: "6.0"` is not configured (`apps/booking-app/package.json:7-11`; `apps/booking-app/tsconfig.json:20`). Because the command stops at the booking app, this run did not establish a complete workspace build.
- The only checked-in booking-app environment value is `VERSION="1.0.0"` (`apps/booking-app/.env.local:1`). Stripe, Google, Turnstile, LaunchDarkly, analytics, deployment, and static-assets values are unset although the app reads them (`apps/booking-app/sources/config/config.ts:3-18,30-52`).
- No Playwright/Cypress configuration, visual-test suite, journey manifest, screenshot directory, trace/video policy, or fixture-reset endpoint exists in the inspected workspace. The root scripts expose only `dev`, `build`, and `typecheck`; the booking app likewise exposes only `dev`, `build`, `preview`, and `typecheck` (`package.json:5-9`; `apps/booking-app/package.json:7-12`).

## Current fixture contract and its limits

The local API exposes stable symbolic IDs for one brand, one shop, two professionals, three services, one cart, one sale order, one waiting-list application, and one appointment (`apps/api/src/fixtures.ts:14-27`). It supplies:

- a single-location brand and a shop with any-professional booking, gift cards, no-pay booking, and walk-in enabled (`apps/api/src/fixtures.ts:105-178`);
- two enabled professionals with no passcode requirements (`apps/api/src/fixtures.ts:228-285`);
- three ordinary services, but no add-on relationships, deposits, or prepaid requirements (`apps/api/src/fixtures.ts:294-357`);
- five days of available times, all generated relative to `Date.now()` (`apps/api/src/fixtures.ts:58-68,844-878`);
- a generated paid-card sale order and active appointment (`apps/api/src/fixtures.ts:650-728`);
- one active waiting-list record and two offered slots (`apps/api/src/fixtures.ts:781-903`);
- one fixed feature-flag response, not named flag profiles (`apps/api/src/fixtures.ts:965-975`).

This contract has four reproducibility defects:

1. **Wall-clock dependence.** Availability, next-available labels/data, appointments, waiting-list dates, token expiry, and Cash App QR expiry are calculated from the clock (`apps/api/src/fixtures.ts:58-68,248-250,692-711,801,844-903,931-947`). The same scenario captured on different dates yields different calendar cells, labels, timestamps, and cancellation/expiry behavior.
2. **Mutable, non-addressable state.** Carts, sale orders, and waiting lists live in module-level `Map`s and mutate through checkout/cancel/tip/waiting-list routes (`apps/api/src/fixtures.ts:29-31,731-771,825-841`; `apps/api/src/routes.ts:66-111`). Restarting the process resets them, but there is no seed/reset/snapshot API, scenario namespace, test isolation, or deterministic ordering guarantee across concurrent runs.
3. **Unknown IDs mostly alias the happy path.** Shop, professional, and service handlers synthesize or fall back to ordinary successful data; they do not expose named empty, loading, malformed, forbidden, or failure cases (`apps/api/src/routes.ts:45-64`; `apps/api/src/fixtures.ts:267-285,353-360`). Only an unknown sale order produces a useful 404 branch (`apps/api/src/routes.ts:78-82`; `apps/api/src/fixtures.ts:745-755`).
4. **Remote visual assets remain live.** Shop cover/logo and Cash App QR imagery use Unsplash URLs (`apps/api/src/fixtures.ts:8-12,75-103,931-945`). Network availability, caching, upstream transformations, and image content therefore remain outside baseline control.

## Journey runnability matrix

| Inventoried journey                                                                  | Current deterministic runnability                                                            | Evidence and missing fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-location brand selection                                                       | **Not runnable as inventoried**                                                              | `createBrand` returns one shop/location, so search/nearby and selection can be opened but not compared across meaningful locations or partial-language/empty/error cases (`apps/api/src/fixtures.ts:151-178`). Need named multi-location, no-location, geolocation-denied, search-empty, partial-language, and brand-load-failure scenarios.                                                                                                                     |
| Standard appointment                                                                 | **Manually runnable happy path; not deterministic**                                          | Demo brand/shop, two professionals, services and future schedules exist (`apps/api/src/routes.ts:43-64`; `apps/api/src/fixtures.ts:275-357,844-866`). Dates float with the clock and there is no automated seed/reset/capture. Need named-professional and any-professional seeds, add-ons, no-services/no-professionals, unavailable/expanded timetable, API faults, and fixed clock.                                                                           |
| Group appointment                                                                    | **Not established**                                                                          | A group schedule endpoint exists (`apps/api/src/routes.ts:54`), but there is no explicit group cart/session seed or multi-appointment sale-order fixture; generated checkout merely converts submitted cart items (`apps/api/src/fixtures.ts:650-688`). Need a prepared first appointment, guest/additional-reservation state, group discount, complete/incomplete group carts, and multi-appointment receipt.                                                   |
| Assigned gift-card purchase                                                          | **Not established**                                                                          | The shop defaults `barberSpecificGC: false`; the API has no named assigned-gift-card scenario (`apps/api/src/fixtures.ts:133-148`). Need professional-specific enablement, preset/custom amounts, checkout result, and receipt fixture.                                                                                                                                                                                                                          |
| Unassigned gift-card purchase                                                        | **UI entry may be reachable; complete baseline not established**                             | Shop gift cards are enabled and a customer-gift-card mutation exists (`apps/api/src/fixtures.ts:139-148`; `apps/api/src/routes.ts:190-197`), but no gift-card sale-order item/receipt fixture or deterministic payment provider exists.                                                                                                                                                                                                                          |
| Checkout: no payment                                                                 | **Potentially runnable happy path only**                                                     | Shop has `bookNoPay: true`, and checkout returns a generated sale order (`apps/api/src/fixtures.ts:137`; `apps/api/src/routes.ts:72-77`). The generated receipt nevertheless always records a successful card payment (`apps/api/src/fixtures.ts:659-688`), so it cannot evidence true no-pay parity.                                                                                                                                                            |
| Checkout: card/deposit/saved card/Apple Pay/Cash App/BNPL/gift-card redemption/promo | **Not reproducibly runnable**                                                                | A fake saved card, setup intent and BNPL intent exist (`apps/api/src/routes.ts:146-157,184-189`; `apps/api/src/fixtures.ts:931-963`), but Stripe keys are unset, setup secrets are synthetic, provider JS is not replaced, the only flag profile is fixed, services never require deposits, and no promo/failure scenario controls exist. Need UI-level provider doubles with selectable success/cancel/failure/3DS states and corresponding cart/receipt seeds. |
| Reservation receipt/management                                                       | **Default generated receipt and cancel mutation partly runnable; variants not reproducible** | `sale_demo` is synthesized on first read, while other unknown IDs 404 (`apps/api/src/fixtures.ts:745-759`). Default is a future, paid, cancellable appointment; cancel/reschedule endpoints exist (`apps/api/src/routes.ts:78-110`). Need fixed single/group/cancelled/pending/business-error/malformed/card/no-pay/ad/app-link scenarios plus mutation success/failure profiles.                                                                                |
| Gift-card receipt                                                                    | **Not established**                                                                          | The API never creates a sale order containing the receipt shape’s first gift card. The inventory already identifies that the UI assumes one. Need assigned/unassigned, brand-wide/shop-only, payment/no-payment, and malformed-sale fixtures.                                                                                                                                                                                                                    |
| Waiting-list offer/reschedule                                                        | **Active record and offered slots partly runnable; status matrix not runnable**              | Every arbitrary application ID becomes the same active record; slot endpoints always succeed, and attempt-specific 400 recovery is absent (`apps/api/src/routes.ts:112-126`; `apps/api/src/fixtures.ts:781-903`). Need addressable `active`, `available`, `selected`, `expired`, `rescheduleSelected`, `removed`, `used`, and `rescheduled`, plus expired-attempt 400 and accept/reschedule failures.                                                            |
| Walk-in                                                                              | **Happy path likely runnable; branches not deterministic**                                   | Feature, shop setting, and enrollment response all enable success (`apps/api/src/fixtures.ts:121-125,965-975`; `apps/api/src/routes.ts:128-138`). There is no closed/disabled/cannot-enroll/error profile, and the app’s hard-coded landing selections are distinct from repository services (inventory citation). Need all three gate combinations, validation/errors, mutation delay/failure, and success data presence/absence.                               |
| Deliberate error and unmatched route                                                 | **Runnable, but uncaptured**                                                                 | Both are source-defined shell behaviors in the inventory. No harness records console exception, Sentry suppression, screenshot, or route-level state.                                                                                                                                                                                                                                                                                                            |

## Required deterministic baseline architecture

### 1. Scenario-addressable fixture server

Keep the local API, but make the scenario an explicit immutable input, for example `X-Parity-Scenario` or a test-only query/cookie selected before navigation. Each scenario must define the complete response graph rather than relying on “unknown ID means default.” At minimum it needs:

- `brand`: multi-location, single-location, empty, failure, partial localization;
- `shop`: normal, empty professionals, passcode professional, rental/group, assigned/unassigned gift-card, walk-in open/closed/disabled, load failure;
- `services/schedule`: categories, add-ons, empty, prepaid, deposit, unavailable date, no slots, any-professional, group, fetch failure;
- `cart/checkout`: standard, no-pay, group incomplete/complete, promo valid/invalid, gift-card redemption, gift-card purchase, loader/blocked, provider success/cancel/failure;
- `sale order`: single, group, cancelled, pending, business error, HTTP error, gift card, malformed;
- `waiting list`: every status, attempt valid/expired, accept/reschedule success/failure;
- `walk-in`: each gate off, success, enrollment failure, missing success shop.

Add test-only `POST /__parity/reset` and `GET /__parity/state` endpoints. Reset must restore a named scenario atomically and return its seed version/hash. State must return canonicalized carts, reservations, sale orders, waiting lists, request log, and mutation log. A new namespace/run ID should isolate parallel captures. The current `Map` storage proves this is feasible but is insufficient without addressability and reset (`apps/api/src/fixtures.ts:29-31,731-841`).

### 2. Fixed time, timezone, randomness, and network

Use one declared instant for all baseline runs (for example `2026-01-15T15:00:00.000Z`) and force browser timezone to `America/New_York`, matching the demo shop (`apps/api/src/fixtures.ts:118`). Generate fixture timestamps from that injected instant, not `Date.now()`. Browser automation must install its clock before app code executes so date-fns calendar, cancellation windows, wait-list countdowns, delayed popups, and animation waits observe the same clock. Record locale, timezone, browser/version, device scale factor, reduced-motion setting, color scheme, and commit SHA in a manifest.

All images/fonts needed for comparison must be local, content-addressed assets. Block unapproved network destinations. Analytics, Sentry, FullStory, Clarity, GTM, Rokt, Fluent, Google, OAuth, Turnstile, LaunchDarkly, Stripe, Apple Pay, Cash App, and BNPL must either be disabled explicitly or routed to deterministic doubles. Unset credentials are not a substitute because they exercise accidental fallback branches (`apps/booking-app/sources/config/config.ts:9-18,30-52`).

### 3. Feature, locale, embedding, and persisted-state profiles

Feature flags must be named, versioned snapshots covering both sides of each UI-affecting flag in the inventory. The API’s single fixed flag object cannot cover the matrix (`apps/api/src/fixtures.ts:965-975`). LaunchDarkly should be disabled for baseline runs and all consumed flags supplied by the local scenario layer.

Before every scenario, clear cookies, localStorage, sessionStorage, IndexedDB, Cache Storage, and service workers, then seed only declared values: locale, auth token/user, cart ID/content, view mode, promo, and consent. Capture both standalone and iframe modes because platform headers depend on `window.self === window.parent` (`apps/booking-app/sources/config/config.ts:25-28`; `apps/booking-app/sources/apiServices.ts:48-49`).

### 4. Minimum viewport/input matrix

The minimum screenshot matrix should be intentionally small but boundary-complete:

| Profile       | Viewport | Device scale | Pointer/embedding                    | Purpose                                                                                         |
| ------------- | -------: | -----------: | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| mobile-narrow |  375×812 |            1 | touch, standalone                    | Exact phone breakpoint and primary layout.                                                      |
| mobile-wide   |  376×812 |            1 | touch, standalone                    | Exercises document behavior immediately above the 375/376 boundary identified in the inventory. |
| tablet/widget |  768×900 |            1 | touch, iframe constrained to 375×700 | Embedding/platform behavior and bottom sheets.                                                  |
| laptop        | 1024×768 |            1 | mouse/hover, standalone              | Exact laptop breakpoint and hover affordances.                                                  |
| desktop       | 1440×900 |            1 | mouse/hover, standalone              | Maximum declared design breakpoint and wide chrome.                                             |

Run the full journey/state set at 375 mobile first. Run 376, iframe, 1024, and 1440 only for one representative of each distinct page architecture plus every state whose source has breakpoint/pointer-specific styling. This avoids a wasteful full Cartesian product while preserving boundary evidence. Run English across all state scenarios; add French and Spanish representatives for every unique text-heavy/date/currency surface, plus partial/missing-translation cases. Spanish must use the localization-enabled flag profile as specified by the inventory.

### 5. Screenshot, recording, and stability contract

Use a browser harness (Playwright is a suitable choice, but none is currently installed) with:

- navigation and interaction steps identified by stable semantic/test selectors;
- explicit API-idle plus application readiness assertions; never use a screenshot after a naked sleep;
- animation suppression for static state screenshots, while retaining separate video/trace cases for timing-dependent transitions;
- local font and image completion checks (`document.fonts.ready`, decoded images);
- full-page screenshot plus viewport screenshot where fixed cart/sheet behavior matters;
- Playwright trace for every failed run, and video for multi-step checkout, waiting-list countdown/acceptance, walk-in modal, delayed receipt popup, and route-transition behavior;
- screenshot naming `journey/scenario/locale/profile/step.png` and a sibling JSON manifest containing scenario hash, route, actions, clock, browser, viewport, flags, locale, embedding mode, screenshot SHA-256, API-state SHA-256, console errors, and failed requests.

Treat blank/null and perpetual-skeleton outcomes as positive assertions: assert the expected shell/absence and retain a screenshot plus state/response evidence. Otherwise a blank page is indistinguishable from an automation failure.

### 6. State-capture procedure

For every capture case:

1. Start the app/API from a clean checkout using locked dependencies; record commit SHA, lockfile hash, Node/pnpm versions, and build/dev command outcome.
2. Create an isolated browser context and API run namespace.
3. Call `POST /__parity/reset` with the named scenario and fixed instant; retain returned fixture version/hash.
4. Install browser clock/timezone, block undeclared network, then seed the declared persisted/auth/cart/locale state.
5. Navigate to the canonical route and execute the manifest actions.
6. Wait for a named readiness assertion: expected request set completed, fonts/images resolved, and the target semantic state present. Advance the fake clock deliberately for the 100 ms transition, 500 ms service skeleton, one-second preload, three-second errors, and five-second receipt popup described in the inventory.
7. Capture viewport/full-page screenshot as applicable, DOM accessibility snapshot, console/page errors, network HAR or trace, and video for designated flows.
8. Fetch `GET /__parity/state`; canonicalize and save state plus request/mutation log. Exclude only declared volatile headers/transport metadata.
9. Assert the final route, visible semantic state, and canonical API state. Hash all artifacts and write the case manifest.
10. Tear down the context and namespace, then rerun the case once. A baseline is accepted only when screenshots and canonical state hashes match on two clean runs.

## Acceptance gate for “baseline established”

The ticket should not be considered resolved by a few manual screenshots. The baseline is established only when:

- the app and fixture API install and build from the lockfile without source edits;
- every row in the journey inventory maps to at least one named automated scenario, with every listed alternate/loading/empty/failure family either captured or explicitly waived;
- every scenario starts from resettable, addressable fixtures and passes twice with identical image/state hashes;
- provider, feature-flag, clock, timezone, locale, persisted state, iframe mode, viewport, fonts, and images are declared inputs;
- captures include screenshots plus a machine-readable manifest and final API/application state; designated interaction journeys also retain trace/video;
- no undeclared external request occurs and no unexpected console/page error is present;
- the known legacy quirks (blank routes/statuses, perpetual skeleton, hard-coded walk-in data) have named positive cases rather than being silently normalized.

## Recommended implementation order

1. Repair the TypeScript 6 build and add a browser-test command/toolchain.
2. Refactor fixture time behind an injected clock; localize remote images.
3. Add scenario selection, run namespaces, reset, and state snapshot endpoints.
4. Implement the standard-booking spine and its capture manifest as a proving scenario.
5. Add scenario families journey by journey: reservation, waiting list, walk-in, gift card, group, then checkout/provider variants.
6. Add responsive/locale/iframe representatives after state fixtures are stable.
7. Run the full matrix twice from clean processes and publish the artifact index with hashes.

Until that work is complete, the truthful baseline label is: **development-bootable local happy path, incomplete and nondeterministic; not suitable as the reproducible authority for full legacy parity.**
