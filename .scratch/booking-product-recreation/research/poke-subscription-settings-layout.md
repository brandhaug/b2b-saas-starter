# Poke Subscription settings layout research

Date captured: 2026-07-27
Scope: signed-in Poke Subscription settings on desktop and a 390 px narrow
viewport, plus the minimum honest BeeSolo product mapping.
Method: visible UI clicks from Settings to Subscription, rendered DOM/computed
style measurements, and first-party BeeSolo source. No secondary sources were
used. The narrow capture did not expose a mobile user agent, so it is documented
as responsive-layout evidence rather than evidence of UA-specific behavior.

## Executive finding

Poke treats Subscription as content inside the same persistent Settings detail
surface used by the other settings routes. On desktop, Settings stays visible as
the left dialog and Subscription opens in the existing right dialog. On the
narrow viewport, the same Subscription route/component occupies a full-width
top-rounded sheet. The plan selector changes only the detail content and CTA
state; it does not close or remount the outer dialog.

The transferable pattern is the container and information hierarchy—not Poke's
`Pro`/`Ultra` commercial claims. BeeSolo already has a real persisted
`solo | team` Merchant plan, but it does not have an authoritative subscription,
usage meter, checkout, or billing-portal capability. Until those exist, the UI
must expose current Solo/Team product state and an explicit billing-unavailable
state instead of inventing paid status, usage, or an actionable upgrade.

## First-party Poke observations

The route was reached by clicking **Settings**, then **Subscription** in the
signed-in UI. The resulting first-party route was
[`https://poke.com/settings/subscription`](https://poke.com/settings/subscription).
The measurements below are from that rendered route.

The DOM observations were cross-checked against Poke's first-party production
bundle, [`main-CtGUTzKH.js`](https://poke.com/vc-ap-d2a57d/main-CtGUTzKH.js),
captured on 2026-07-26 with SHA-256
`21c25c88e7fad2fa4d3ec9da5df1dd1e5cac22b594a50b276d2369e133063d59`.
The associated first-party stylesheet was
[`main-DzG4LrTk.css`](https://poke.com/vc-ap-d2a57d/main-DzG4LrTk.css), SHA-256
`8d34ffa391d0c86a3e95e7bfc0134f4ca2acdd08c66b7bf75c5da6d627867f2b`.
Names such as `SettingsRouter`, `ICResponsiveDoubleModalLayout`,
`SettingsDetailView`, `IonRouterOutlet`, and `BlurScrollView` below refer to
components in that shipped asset.

### Persistent settings-route host

Poke's shipped `SettingsRouter` keeps one `ICResponsiveDoubleModalLayout`
mounted for all `/settings*` locations. Its right-open condition is equivalent
to:

```ts
pathname.startsWith('/settings/') && pathname !== '/settings'
```

The right surface contains one persistent `SettingsDetailView` and one
`IonRouterOutlet` with `animated={true}`. Subscription is not a new root modal:
`/settings/subscription`, `/settings/subscription/manage`, and the cancellation
route are children of this outlet. The route changes inner content while the
outer right dialog/sheet remains mounted.

Source: Poke production bundle linked above, `SettingsRouter` and
`SettingsDetailView`.

### Desktop container geometry

Viewport: `1280 × 720`.

Subscription opens in the persistent secondary Settings dialog:

| Property   |                                                       Measured value |
| ---------- | -------------------------------------------------------------------: |
| Bounds     |                           `x = 655`, `y = -16`, `w = 512`, `h = 752` |
| Background |                                                                white |
| Border     |                                             `1px rgb(228, 228, 231)` |
| Radius     |                                                               `24px` |
| Overflow   |                                                               hidden |
| Transform  |                                  `translateX(15px) translateY(-50%)` |
| Shadow     | `0 10px 15px -3px rgb(0 0 0 / .1)`, `0 4px 6px -4px rgb(0 0 0 / .1)` |

The primary Settings dialog remains visible to its left. This is the same paired
desktop geometry already documented in
[`poke-desktop-double-dialog-motion.md`](./poke-desktop-double-dialog-motion.md).
The shipped desktop breakpoint is `1024px`; both dialogs use `w-[95%] max-w-lg`
(`512px`) and `md:h-[750px]` with rounded-3xl, border, background, and shadow.

### Header and scroll ownership

The header is outside the scrolling content:

- outer spacing: `margin-top: 16px`, `margin-bottom: 4px`;
- header height: `48px`;
- horizontal padding: `24px`;
- back target: `32 × 32px`;
- centered title: `14px / 20px`, weight `500`.

The content scrollport begins at approximately `y = 61px`, is the full dialog
width, and has a `674px` client height. Its measured `scrollHeight` was `798px`,
confirming that the header remains fixed while the Subscription content itself
scrolls. The scrollbar is visually hidden. The inner content uses `32px`
horizontal padding, `8px` top padding, approximately `32px` between major groups,
and `24px` bottom padding. A `32px` bottom fade separates scrolling content from
the dialog edge.

The shipped `BlurScrollView` owns this behavior: an absolute scrollport with
`overflow-y: auto`, `overflow-x: hidden`, a hidden scrollbar, and 32px top/bottom
fade gradients that appear only while content continues beyond the respective
edge. Subscription passes a 24px bottom-padding value. The header therefore never
belongs to the scrolling content.

Source: Poke production bundle linked above, shared Settings header,
`BlurScrollView`, and Subscription route content.

### Narrow responsive container

Viewport: `390 × 844`. A real mobile UA was unavailable for this capture.

| Property                        |                                Measured value |
| ------------------------------- | --------------------------------------------: |
| Sheet bounds                    | `x = 0`, `y = 25.32`, `w = 390`, `h = 818.68` |
| Radius                          |                               `36px 36px 0 0` |
| Border                          |                                          none |
| Overflow                        |                                       clipped |
| Header bounds                   |                         `y = 41.32`, `h = 48` |
| Header horizontal padding       |                                        `16px` |
| Scrollport bounds               |                    `y = 101.32`, `h = 742.68` |
| Content horizontal padding      |                                        `16px` |
| Content top padding / group gap |                                `8px` / `32px` |
| Bottom fade                     |                                        `32px` |
| Full-width CTA                  |                      `358px` (`390 - 2 × 16`) |

The same component hierarchy and section rhythm are preserved. The responsive
change is mainly container chrome and horizontal padding: paired bordered dialog
on desktop, full-width top-rounded sheet on narrow screens.

The shipped narrow-screen path confirms the responsive intent: below `1024px`,
the double layout becomes one stacking sheet, the primary Settings content is
hidden while the detail is active, the height is calculated from `97dvh` minus
the safe-area top, and the sheet has 36px top corners and a handle 12px from the
top. This source evidence supports the measured geometry, but it does not turn
the narrow capture into a real-UA measurement.

## Content hierarchy and states

### 1. Current plan

The first group presents:

- plan name: **Pro**;
- price: **$5 / month**;
- a **Manage** action.

The plan card is `446px` wide and approximately `70px` tall on desktop. `446px`
is the 512 px dialog width minus the measured `32px` inner padding on each side
and border rounding allowance.

In the shipped component, this is a single rounded-2xl bordered gray-50 list
row with `16px` padding, a `20px` credit-card icon, `14px` medium plan name,
`12px` muted price/cancellation copy, and a white depth-styled Manage button with
`12px × 8px` padding and `14px` text.

The Manage control was deliberately not activated because it may open an
external billing portal or otherwise cause a billing-side effect. Its destination
and behavior are therefore not verified by this capture.

### 2. Usage

The Usage group shows:

- the plan label **Pro**;
- **0% used**;
- a `6px`-high progress bar;
- a reset timestamp.

The desktop Usage card is `446px` wide and approximately `131.5px` tall. The
capture verifies the presentation, not what Poke counts as usage or how the
percentage is computed.

The shipped Usage row uses `16px` horizontal and `24px` vertical padding, `14px`
medium heading, `14px` tabular muted values, the measured `6px` track, and a
`13px` reset legend with `20px` top margin. The progress color is blue, becoming
red when exhausted. Expanding usage detail animates height and opacity with a
zero-bounce 400ms spring. These facts describe presentation and state handling;
they still do not define an equivalent BeeSolo metric.

### 3. Upgrade comparison

An **Upgrade** label introduces a segmented comparison:

- outer control: `446 × 46px`, `4px` inner padding;
- two segments: approximately `216 × 36px` each;
- segment labels: `13px`;
- options: **Current** and **Ultra**.

The segmented control is local view state. Switching it leaves the route and
outer dialog unchanged.

| Selected segment | Visible state           | Primary CTA                                    |
| ---------------- | ----------------------- | ---------------------------------------------- |
| Current          | Current-plan detail     | `Current plan`, disabled                       |
| Ultra            | Ultra detail, `$199/mo` | `Upgrade to Ultra`, enabled, `446 × 40px` pill |

The primary CTA uses `14px` type at weight `500`. Below it is a secondary **See
all plans** action in gray `14px` type. Feature-list rows use an approximately
`8px` vertical gap, with supporting copy in the `13–14px` range. The measured
hierarchy is compact: one current-plan summary, one usage card, then the
comparison and CTA—rather than multiple large marketing plan cards.

Poke's selected segment thumb is white with a small shadow and moves with a
400/32 layout spring. Plan cards share one grid cell and crossfade in place over
150ms, so selecting a comparison never moves or re-enters the outer sheet. The
card itself has a 20px radius, border, 16px padding, and a 300px minimum height.
Inside it, shipped typography uses 18px for plan name, 13px for description,
18px semibold for price, 14px for `/mo`, and 13px for the billing line.

The complete shipped CTA state machine is broader than the captured Pro/Ultra
toggle:

| Relationship to selected plan     | CTA copy/state                                    |
| --------------------------------- | ------------------------------------------------- |
| Selected plan is current          | `Current plan`, disabled outline                  |
| Selected plan is higher           | `Upgrade to {plan}`, enabled with pending spinner |
| Selected plan is lower            | `Switch to`, enabled with pending spinner         |
| Current subscription is canceling | `Resume {plan}`                                   |

Supporting actions use `12px` “Change or cancel anytime” copy and `14px` gray
links for Billing details, Cancel subscription, and See all plans.

The generic plan catalog shipped in the inspected asset is Free `$0`, Basic
`$6.69/mo` (`$5.35` yearly monthly equivalent), Pro `$19` (`$16` yearly), and
Ultra `$199` (`$160` yearly). The signed-in account displayed Pro at `$5/month`,
so that live price must be treated as account-specific billing state rather than
a reusable catalog constant. Subscription's root comparison shows higher plans
among Pro/Ultra; Basic participates in the deeper Manage-plan selector when it is
the current plan. `SubscriptionView` fixes its displayed billing period to
monthly: the pills are **plan choices**, not a monthly/yearly cadence control.

Source: Poke production bundle linked above, Subscription plan row, usage view,
plan segmented control, plan cards, and CTA resolver.

Typography measurements not listed above were not captured as computed values;
their visual size should not be reverse-engineered from screenshots alone.

## Route and dialog persistence

The Subscription surface participates in Poke's persistent Settings dialog
architecture:

1. Settings remains mounted as the primary left dialog.
2. Subscription occupies the already-open secondary right dialog.
3. The Subscription route renders inside an animated router outlet.
4. Switching **Current ↔ Ultra** changes only local content/CTA state.
5. The secondary dialog's final bounds, transform, and open identity remain
   stable; root fade/scale is not replayed.

The shipped Manage-plan route uses the same 36px pill segmentation. Its inner
plan content uses `AnimatePresence` with `mode="popLayout"`: opacity 0 and y=8
to opacity 1 and y=0, with an opacity/y=8 exit over 200ms ease-out. Again, this
is an inner content transition; the right dialog remains mounted.

For a deeper settings route transition, Poke's shipped desktop/Material Ionic
animation moves the entering content from y=40 to y=0 and opacity .01 to 1 over
280ms with `cubic-bezier(.36,.66,.04,1)`. Back moves y=0 to y=40 and opacity 1
to 0 over 200ms with `cubic-bezier(.47,0,.745,.715)`. These timings belong to
the outlet page, never the outer dialog. Source: Poke's first-party
[`md.transition-CTYzSZgS.js`](https://poke.com/vc-ap-d2a57d/md.transition-CTYzSZgS.js),
SHA-256 `4280cf82f52588b439bccf8ba2b567c872b58f96e6a666cbfe795da0705336d1`.

Poke's billing controls are backed by first-party endpoints in the shipped
application: `GET /api/v1/subscription/status` and POST actions for
`/api/v1/subscription/change-plan`, `/auto-reload`, and `/buy-credits`. Its
Billing action opens a Stripe portal in a new tab. These are source observations;
the potentially consequential controls were not activated during the live pass.

During route transition, zero-size duplicate `ion-router-outlet` nodes were
briefly retained in the DOM. That is direct evidence of router transition
plumbing, but this pass did not frame-sample their transforms or opacity. Exact
inner animation timing is therefore not claimed here.

This is consistent with the first-party Integrations observation in
[`poke-desktop-integrations-dialog-routing.md`](./poke-desktop-integrations-dialog-routing.md):
Poke preserves the dialog host and changes only routed content.

## BeeSolo's authoritative state today

### Real plan state exists

BeeSolo's database has a persisted Merchant plan constrained to `solo | team`,
defaulting to `solo`:

- [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts) declares
  `merchantPlans = ['solo', 'team']` and the non-null `merchants.plan` column.
- [`merchant-context.ts`](../../../packages/capabilities/src/merchant-catalog/merchant-context.ts)
  resolves that plan through the authenticated Merchant Owner membership and
  exposes it as `MerchantIdentity.plan`.

This is product configuration used by real behavior—for example Solo uses the
default Provider and Team exposes Provider administration. It is not, by itself,
proof of a paid subscription or entitlement.

### Billing is deliberately unavailable

The current environment contract recognizes Stripe keys, but the billing module
is explicitly marked `runtimeWired: false` even when those keys are present:

- [`packages/env/src/server.ts`](../../../packages/env/src/server.ts),
  `moduleConfigStatus()`.

The product ADR says checkout and portal actions remain disabled or
configuration-gated until a billing provider is configured:

- [`docs/adr/0023-public-pricing-with-env-gated-billing.md`](../../../docs/adr/0023-public-pricing-with-env-gated-billing.md).

The public pricing page already follows that rule by disabling its CTA and
showing “Available once a billing provider is configured”:

- [`apps/web/src/routes/pricing.tsx`](../../../apps/web/src/routes/pricing.tsx).

There is no Merchant App subscription route/capability, billing-subscription
record, usage-ledger contract, checkout action, or billing-portal action in the
current source. Also, `MerchantViewer` exposes profile identity but not the
Merchant plan; a Subscription view should read the plan through an authorized
Merchant context/query rather than extend UI state with a guessed value.

## Honest BeeSolo implementation

### Reuse the structure

Use Poke's compact responsive hierarchy:

1. fixed sheet/dialog header;
2. independent scrollport with bottom fade;
3. **Current plan** card;
4. optional **Usage** card only when a real, defined metric exists;
5. **Compare plans** segmented control for Solo/Team;
6. state-aware primary CTA and a secondary link to full plan details.

On desktop, open Subscription in the existing persistent Settings secondary
dialog. On mobile, render the same route content in the existing full-width
top-rounded settings sheet. Segment changes must not remount either container.

### Map only real state

| Surface            | Current honest behavior                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Current plan       | Read and display persisted `MerchantIdentity.plan` (`Solo` or `Team`)                                                        |
| Price              | Omit until BeeSolo pricing is an owned product contract; do not copy Poke's `$5` or `$199`                                   |
| Manage billing     | Hide or disable with “Billing isn't configured”                                                                              |
| Usage              | Omit; do not show a percentage without a named, server-derived metric and reset period                                       |
| Solo/Team selector | Local comparison state only; selected segment changes details without mutating the Merchant                                  |
| Current-plan CTA   | Disabled, labelled `Current plan`                                                                                            |
| Other-plan CTA     | Disabled, labelled `Upgrade unavailable` or `Billing setup required` while billing is unwired                                |
| Plan change        | Add only after an authorized server capability defines eligibility, idempotency, provider state, audit, and failure recovery |

This preserves the useful Poke information architecture while accurately
representing BeeSolo's current system. A disabled control should explain the
missing capability; it should not imply that adding Stripe environment variables
alone creates a working upgrade flow.

## Acceptance criteria for a future implementation

1. The Subscription route is opened through Settings and uses the existing
   persistent dialog/sheet host.
2. Desktop and mobile share one content hierarchy, with the measured responsive
   padding and header/scroll split.
3. Current plan comes from authorized persisted Merchant context.
4. No price, usage percentage, renewal date, billing status, or portal link is
   rendered without an authoritative server source.
5. Solo/Team comparison changes local detail state without remounting the host.
6. Current-plan CTA is disabled; the other-plan CTA is disabled with an explicit
   provider-unavailable explanation until billing is wired.
7. Tests cover both persisted plan values and the no-billing-provider state.
8. When billing is eventually added, mutation authority and webhook reconciliation
   live in a capability boundary—not in the route component.

## Confidence and limits

Confidence is high for the measured Poke container geometry, scroll ownership,
section dimensions, control labels/states, and dialog persistence because they
were read from the signed-in rendered UI. Confidence is high for BeeSolo's plan
and billing state because it comes from first-party schema, capability, environment,
ADR, and UI source.

The narrow capture verifies Poke's responsive layout at 390 px but not a distinct
mobile-UA code path. The Manage destination, Poke's usage definition, exact
unmeasured content font sizes, and frame-level outlet animation were intentionally
left as unknowns rather than inferred.
